import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSharedValue } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ChatInput } from '@/components/chat/ChatInput';
import { MessageActionMenu } from '@/components/chat/MessageActionMenu';
import { MessageBubble } from '@/components/chat/MessageBubble';
import { LogoSpinner } from '@/components/ui/LogoSpinner';
import { ThemedText } from '@/components/ui/ThemedText';
import { Colors } from '@/constants/Colors';
import { queryKeys } from '@/constants/queryKeys';
import {
  useChatSubscription,
  useMarkRead,
  useMessages,
  useReactions,
  useReadReceipts,
  useSendMessage,
  useToggleReaction,
} from '@/hooks/chat';
import { useColorScheme } from '@/hooks/useColorScheme';
import { supabase } from '@/lib/supabase';
import type { ChatMessage, ReactionGroup } from '@/types/chat';
import { ms, s } from '@/utils/scale';


// ─── Helpers ──────────────────────────────────────────────────

function formatTimeHeader(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dayDiff = Math.floor((startOfToday.getTime() - startOfDay.getTime()) / 86400000);

  if (dayDiff === 0) return `Today ${time}`;
  if (dayDiff === 1) return `Yesterday ${time}`;
  if (dayDiff < 7) {
    const dayName = d.toLocaleDateString('en-US', { weekday: 'long' });
    return `${dayName} ${time}`;
  }
  const dateLabel = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${dateLabel}, ${time}`;
}

interface MessageMeta {
  isFirstInGroup: boolean;
  isLastInGroup: boolean;
  showSender: boolean;
  showTimeHeader: boolean;
  showSwipeTime: boolean;
  timeHeader: string;
}

function computeMessageMeta(messages: ChatMessage[]): Map<string, MessageMeta> {
  const GAP_MS = 60 * 60 * 1000;
  const map = new Map<string, MessageMeta>();

  for (let index = 0; index < messages.length; index++) {
    const item = messages[index];
    const newerMsg = index > 0 ? messages[index - 1] : null;
    const olderMsg = index < messages.length - 1 ? messages[index + 1] : null;

    const sameMinuteAsNewer =
      newerMsg !== null &&
      newerMsg.team_id === item.team_id &&
      newerMsg.created_at.slice(0, 16) === item.created_at.slice(0, 16);

    const sameMinuteAsOlder =
      olderMsg !== null &&
      olderMsg.team_id === item.team_id &&
      olderMsg.created_at.slice(0, 16) === item.created_at.slice(0, 16);

    const isFirstInGroup = !sameMinuteAsOlder;
    const isLastInGroup = !sameMinuteAsNewer;

    const senderChanged = !olderMsg || olderMsg.team_id !== item.team_id;

    const itemTime = new Date(item.created_at).getTime();
    const olderTime = olderMsg ? new Date(olderMsg.created_at).getTime() : 0;
    const showTimeHeader = !olderMsg || (itemTime - olderTime) >= GAP_MS;

    map.set(item.id, {
      isFirstInGroup,
      isLastInGroup,
      showSender: senderChanged,
      showTimeHeader,
      showSwipeTime: isLastInGroup,
      timeHeader: showTimeHeader ? formatTimeHeader(item.created_at) : '',
    });
  }
  return map;
}

// ─── Props ────────────────────────────────────────────────────

interface DraftChatModalProps {
  visible: boolean;
  leagueId: string;
  teamId: string;
  teamName: string;
  isCommissioner: boolean;
  onClose: () => void;
}

// Stable empty arrays
const emptyReactions: ReactionGroup[] = [];

// ─── Component ────────────────────────────────────────────────

export function DraftChatModal({
  visible,
  leagueId,
  teamId,
  teamName,
  isCommissioner,
  onClose,
}: DraftChatModalProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const queryClient = useQueryClient();

  // Look up the league conversation
  const { data: conversationId } = useQuery({
    queryKey: queryKeys.leagueConversationId(leagueId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('chat_conversations')
        .select('id')
        .eq('league_id', leagueId)
        .eq('type', 'league')
        .single();
      if (error) throw error;
      return data.id as string;
    },
    enabled: visible && !!leagueId,
    staleTime: Infinity,
  });

  // Team logo map for message avatars
  const { data: teamLogoMap } = useQuery<Record<string, string | null>>({
    queryKey: queryKeys.teamLogos(leagueId),
    queryFn: async () => {
      const { data } = await supabase
        .from('teams')
        .select('id, logo_key')
        .eq('league_id', leagueId);
      const map: Record<string, string | null> = {};
      for (const t of data ?? []) map[t.id] = t.logo_key;
      return map;
    },
    enabled: !!leagueId,
    staleTime: 1000 * 60 * 10,
  });

  // Single realtime channel for both messages + reactions
  useChatSubscription(visible ? conversationId ?? null : null);

  const {
    data: msgData,
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useMessages(visible ? conversationId ?? null : null);

  const messages = useMemo(() => msgData?.pages.flat() ?? [], [msgData]);

  // Pre-seed poll cache
  useEffect(() => {
    for (const msg of messages) {
      if (msg.type === 'poll' && msg.poll_question) {
        queryClient.setQueryData(queryKeys.poll(msg.content), (prev: any) => {
          if (prev) return prev;
          return {
            id: msg.content,
            question: msg.poll_question,
            options: msg.poll_options,
            poll_type: msg.poll_type,
            closes_at: msg.poll_closes_at,
            is_anonymous: msg.poll_is_anonymous,
            show_live_results: msg.poll_show_live_results,
          };
        });
      }
    }
  }, [messages, queryClient]);

  const messageMeta = useMemo(() => computeMessageMeta(messages), [messages]);

  const visibleMessageIds = useMemo(
    () => messages.filter((m) => !m.id.startsWith('temp-')).map((m) => m.id),
    [messages],
  );

  const { data: reactionsMap } = useReactions(
    visible ? conversationId ?? null : null,
    visibleMessageIds,
    teamId,
  );

  const sendMessage = useSendMessage(
    conversationId ?? '',
    teamId,
    teamName,
    leagueId,
  );

  const toggleReaction = useToggleReaction(conversationId ?? '');

  const newestMessage = messages.length > 0 ? messages[0] : null;
  const newestMessageId = newestMessage?.id ?? null;
  const newestMessageCreatedAt = newestMessage?.created_at ?? null;
  const { updateReadPosition } = useReadReceipts(
    visible ? conversationId ?? null : null,
    teamId,
    teamName,
    null,
  );
  useMarkRead(
    visible ? conversationId ?? null : null,
    teamId,
    newestMessageId,
    newestMessageCreatedAt,
    updateReadPosition,
  );

  const [reactionTargetId, setReactionTargetId] = useState<string | null>(null);
  const swipeReveal = useSharedValue(0);

  const handleSend = useCallback(
    (text: string) => sendMessage.mutate({ content: text }),
    [sendMessage],
  );

  const handleLongPress = useCallback((messageId: string) => {
    setReactionTargetId(messageId);
  }, []);

  const handleReactionSelect = useCallback(
    (emoji: string) => {
      if (!reactionTargetId || !teamId) return;
      toggleReaction.mutate({ messageId: reactionTargetId, teamId, emoji });
      setReactionTargetId(null);
    },
    [reactionTargetId, teamId, toggleReaction],
  );

  const handleItemReactionPress = useCallback(
    (messageId: string, emoji: string) => {
      if (!teamId) return;
      toggleReaction.mutate({ messageId, teamId, emoji });
    },
    [teamId, toggleReaction],
  );

  const onEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const secondaryTextColor = c.secondaryText;

  const renderItem = useCallback(
    ({ item }: { item: ChatMessage }) => {
      const meta = messageMeta.get(item.id);
      if (!meta) return null;

      const isOwn = item.team_id === teamId;

      return (
        <View>
          {meta.showTimeHeader && (
            <View style={styles.dateHeader}>
              <ThemedText style={[styles.dateHeaderText, { color: secondaryTextColor }]}>
                {meta.timeHeader}
              </ThemedText>
            </View>
          )}
          <MessageBubble
            message={item}
            isOwnMessage={isOwn}
            showSender={meta.showSender}
            isFirstInGroup={meta.isFirstInGroup}
            isLastInGroup={meta.isLastInGroup}
            reactions={reactionsMap?.[item.id] ?? emptyReactions}
            onLongPress={() => handleLongPress(item.id)}
            onReactionPress={(emoji: string) => handleItemReactionPress(item.id, emoji)}
            teamId={teamId}
            teamLogoKey={teamLogoMap?.[item.team_id] ?? null}
            isCommissioner={isCommissioner}
            swipeReveal={swipeReveal}
            showSwipeTime={meta.showSwipeTime}
            isSelected={reactionTargetId === item.id}
          />
        </View>
      );
    },
    [teamId, teamLogoMap, messageMeta, isCommissioner, reactionsMap, reactionTargetId, swipeReveal, secondaryTextColor, handleLongPress, handleItemReactionPress],
  );

  const keyExtractor = useCallback((item: ChatMessage) => item.id, []);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView style={[styles.container, { backgroundColor: c.background }]}>
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: c.border }]}>
          <View style={styles.headerSpacer} />
          <ThemedText type="defaultSemiBold" style={styles.headerTitle} accessibilityRole="header">
            League Chat
          </ThemedText>
          <TouchableOpacity
            onPress={onClose}
            style={styles.closeButton}
            accessibilityRole="button"
            accessibilityLabel="Close chat"
          >
            <Ionicons name="close" size={24} color={c.text} />
          </TouchableOpacity>
        </View>

        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={0}
        >
          {isLoading || !conversationId ? (
            <View style={styles.empty}>
              <LogoSpinner />
            </View>
          ) : messages.length === 0 ? (
            <View style={styles.empty}>
              <ThemedText style={{ color: c.secondaryText }}>
                No messages yet. Say something!
              </ThemedText>
            </View>
          ) : (
            <FlatList
              data={messages}
              keyExtractor={keyExtractor}
              renderItem={renderItem}
              inverted
              contentContainerStyle={styles.list}
              onEndReached={onEndReached}
              onEndReachedThreshold={0.5}
              removeClippedSubviews
              initialNumToRender={15}
              maxToRenderPerBatch={10}
              windowSize={7}
              ListFooterComponent={
                isFetchingNextPage ? (
                  <View style={styles.footerLoader}><LogoSpinner size={18} /></View>
                ) : null
              }
            />
          )}

          {conversationId && (
            <ChatInput
              conversationId={conversationId}
              onSend={handleSend}
              sending={sendMessage.isPending}
              isCommissioner={isCommissioner}
              isLeagueChat
            />
          )}
        </KeyboardAvoidingView>

        {reactionTargetId && (
          <MessageActionMenu
            visible
            onReactionSelect={handleReactionSelect}
            onClose={() => setReactionTargetId(null)}
            actions={[]}
            existingReactions={reactionsMap?.[reactionTargetId]}
          />
        )}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: s(16),
    paddingVertical: s(12),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerSpacer: {
    width: s(36),
  },
  headerTitle: {
    fontSize: ms(17),
    textAlign: 'center',
    flex: 1,
  },
  closeButton: {
    width: s(36),
    alignItems: 'center',
  },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  list: {
    paddingHorizontal: s(12),
    paddingVertical: s(8),
  },
  footerLoader: {
    paddingVertical: s(16),
  },
  dateHeader: {
    alignItems: 'center',
    paddingVertical: s(12),
  },
  dateHeaderText: {
    fontSize: ms(12),
    fontWeight: '500',
  },
});
