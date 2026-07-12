import { useQueryClient, useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { useSharedValue } from 'react-native-reanimated';

import { ChatInput } from '@/components/chat/ChatInput';
import { GifPicker } from '@/components/chat/GifPicker';
import { MessageActionMenu } from '@/components/chat/MessageActionMenu';
import { MessageBubble } from '@/components/chat/MessageBubble';
import { LogoSpinner } from '@/components/ui/LogoSpinner';
import { ThemedText } from '@/components/ui/ThemedText';
import { queryKeys } from '@/constants/queryKeys';
import {
  useChatSubscription,
  useMarkRead,
  useMessages,
  useReactions,
  useReadReceipts,
  useSendGif,
  useSendImage,
  useSendMessage,
  useToggleReaction,
} from '@/hooks/chat';
import { useColors } from '@/hooks/useColors';
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

// Stable empty array — a fresh [] each render would re-trigger MessageBubble memo.
const emptyReactions: ReactionGroup[] = [];

interface LeagueChatPanelProps {
  leagueId: string;
  teamId: string;
  teamName: string;
  isCommissioner: boolean;
  /**
   * Gates the conversation query, the realtime subscription, and read receipts.
   * A modal passes its `visible` flag so a closed sheet holds no subscription;
   * an always-on rail passes `true`.
   */
  active?: boolean;
}

/**
 * The league chat surface with no chrome of its own — message list, composer,
 * reaction menu, GIF picker. Fills its parent.
 *
 * Split out of `DraftChatModal` so the same conversation can be a full-screen
 * modal on the phone and a permanent right-hand rail in the desktop draft room,
 * where a draft is a running conversation and hiding it behind a button means
 * missing it. The modal keeps the pieces that only make sense for a sheet:
 * the SafeAreaProvider re-seed, the keyboard-driven lift, and the DialogHost.
 */
export function LeagueChatPanel({
  leagueId,
  teamId,
  teamName,
  isCommissioner,
  active = true,
}: LeagueChatPanelProps) {
  const c = useColors();
  const queryClient = useQueryClient();

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
    enabled: active && !!leagueId,
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
  useChatSubscription(active ? conversationId ?? null : null);

  const {
    data: msgData,
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useMessages(active ? conversationId ?? null : null);

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
    active ? conversationId ?? null : null,
    visibleMessageIds,
    teamId,
  );

  const sendMessage = useSendMessage(conversationId ?? '', teamId, teamName, leagueId);
  const toggleReaction = useToggleReaction(conversationId ?? '');

  const { pickAndSend: pickImage, isUploading } = useSendImage(
    conversationId ?? '',
    teamId,
    teamName,
    leagueId,
  );
  const { sendGif } = useSendGif(conversationId ?? '', teamId, teamName, leagueId);
  const [showGifPicker, setShowGifPicker] = useState(false);
  const handleGifSelect = useCallback(
    (gifUrl: string) => {
      sendGif(gifUrl);
      setShowGifPicker(false);
    },
    [sendGif],
  );

  const newestMessage = messages.length > 0 ? messages[0] : null;
  const newestMessageId = newestMessage?.id ?? null;
  const newestMessageCreatedAt = newestMessage?.created_at ?? null;
  // Presence avatars are intentionally not rendered here — the draft room's
  // header already shows them, so duplicating them in the chat would be noise.
  const { updateReadPosition } = useReadReceipts(
    active ? conversationId ?? null : null,
    teamId,
    teamName,
    null,
  );
  useMarkRead(
    active ? conversationId ?? null : null,
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
    <View style={styles.flex}>
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
          onPickImage={pickImage}
          onOpenGifPicker={() => setShowGifPicker(true)}
          isUploading={isUploading}
        />
      )}

      {reactionTargetId && (
        <MessageActionMenu
          visible
          onReactionSelect={handleReactionSelect}
          onClose={() => setReactionTargetId(null)}
          actions={[]}
          existingReactions={reactionsMap?.[reactionTargetId]}
        />
      )}

      <GifPicker
        visible={showGifPicker}
        onSelect={handleGifSelect}
        onClose={() => setShowGifPicker(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
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
