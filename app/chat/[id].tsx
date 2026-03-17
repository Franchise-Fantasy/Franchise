import { ChatInput } from '@/components/chat/ChatInput';
import { CreatePollModal } from '@/components/chat/CreatePollModal';
import { MessageBubble } from '@/components/chat/MessageBubble';
import { ReactionPicker } from '@/components/chat/ReactionPicker';
import { ThemedText } from '@/components/ThemedText';
import { Colors } from '@/constants/Colors';
import { PageHeader } from '@/components/ui/PageHeader';
import { useAppState } from '@/context/AppStateProvider';
import {
  useMarkRead,
  useMessages,
  useReactions,
  useReadReceipts,
  useSendMessage,
  useToggleReaction,
} from '@/hooks/chat';
import { useColorScheme } from '@/hooks/useColorScheme';
import { supabase } from '@/lib/supabase';
import { ReadReceiptIndicator } from '@/components/chat/ReadReceiptIndicator';
import type { ChatMessage, ReactionGroup } from '@/types/chat';
import type { ReadReceipt } from '@/hooks/chat/useReadReceipts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useFocusEffect } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  type SharedValue,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

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

// ─── Pre-computed display metadata per message ────────────────

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

// ─── Memoized message item ────────────────────────────────────

interface ChatItemProps {
  item: ChatMessage;
  meta: MessageMeta;
  isOwn: boolean;
  isDM: boolean;
  isLeagueChat: boolean;
  isCommissioner: boolean;
  reactions: ReactionGroup[];
  readers: ReadReceipt[];
  isSelected: boolean;
  teamId: string | undefined;
  swipeReveal: SharedValue<number>;
  secondaryTextColor: string;
  onLongPress: (messageId: string) => void;
  onReactionPress: (messageId: string, emoji: string) => void;
}

const ChatItem = React.memo(function ChatItem({
  item,
  meta,
  isOwn,
  isDM,
  isLeagueChat,
  isCommissioner,
  reactions,
  readers,
  isSelected,
  teamId,
  swipeReveal,
  secondaryTextColor,
  onLongPress,
  onReactionPress,
}: ChatItemProps) {
  const handleLongPress = useCallback(() => {
    onLongPress(item.id);
  }, [onLongPress, item.id]);

  const handleReactionPress = useCallback(
    (emoji: string) => {
      onReactionPress(item.id, emoji);
    },
    [onReactionPress, item.id],
  );

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
        showSender={isLeagueChat && meta.showSender}
        isFirstInGroup={meta.isFirstInGroup}
        isLastInGroup={meta.isLastInGroup}
        reactions={reactions}
        onLongPress={handleLongPress}
        onReactionPress={handleReactionPress}
        teamId={teamId}
        isCommissioner={isCommissioner}
        swipeReveal={swipeReveal}
        showSwipeTime={meta.showSwipeTime}
        isSelected={isSelected}
      />
      {isOwn && item.type !== 'poll' && readers.length > 0 && (
        <ReadReceiptIndicator isDM={isDM} readers={readers} />
      )}
    </View>
  );
});

// ─── Main screen ──────────────────────────────────────────────

export default function ConversationScreen() {
  const { id: conversationId } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const { teamId, leagueId } = useAppState();

  // Fetch conversation metadata to show the right title
  const { data: convMeta } = useQuery({
    queryKey: ['conversationMeta', conversationId],
    queryFn: async () => {
      const { data: conv, error: convErr } = await supabase
        .from('chat_conversations')
        .select('id, type, league_id')
        .eq('id', conversationId!)
        .single();
      if (convErr) throw convErr;

      const { count: memberCount } = await supabase
        .from('chat_members')
        .select('id', { count: 'exact', head: true })
        .eq('conversation_id', conversationId!);

      if (conv.type === 'league') return { name: 'League Chat', type: conv.type, memberCount: memberCount ?? 0 };

      const { data: members } = await supabase
        .from('chat_members')
        .select('team_id, teams(name)')
        .eq('conversation_id', conversationId!)
        .neq('team_id', teamId!);

      const otherName = (members?.[0] as any)?.teams?.name ?? 'DM';
      return { name: otherName, type: conv.type, memberCount: memberCount ?? 0 };
    },
    enabled: !!conversationId && !!teamId,
  });

  const { data: myTeamInfo } = useQuery({
    queryKey: ['myTeamInfo', teamId],
    queryFn: async () => {
      const { data } = await supabase
        .from('teams')
        .select('name, tricode')
        .eq('id', teamId!)
        .single();
      return { name: data?.name ?? 'Me', tricode: data?.tricode ?? null };
    },
    enabled: !!teamId,
    staleTime: Infinity,
  });
  const myTeamName = myTeamInfo?.name ?? null;
  const myTricode = myTeamInfo?.tricode ?? null;

  const { data: isCommissioner } = useQuery({
    queryKey: ['isCommissioner', leagueId],
    queryFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return false;
      const { data: league } = await supabase
        .from('leagues')
        .select('created_by')
        .eq('id', leagueId!)
        .single();
      return league?.created_by === session.user.id;
    },
    enabled: !!leagueId,
    staleTime: Infinity,
  });

  const queryClient = useQueryClient();
  const [showCreatePoll, setShowCreatePoll] = useState(false);
  const [showPresenceList, setShowPresenceList] = useState(false);

  // Refresh messages when screen gains focus (catches messages missed by realtime)
  useFocusEffect(
    useCallback(() => {
      if (conversationId) {
        queryClient.invalidateQueries({ queryKey: ['messages', conversationId] });
      }
    }, [conversationId, queryClient]),
  );

  const {
    data: msgData,
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useMessages(conversationId ?? null);

  const messages = useMemo(
    () => msgData?.pages.flat() ?? [],
    [msgData],
  );

  // Pre-seed poll cache outside of render
  useEffect(() => {
    for (const msg of messages) {
      if (msg.type === 'poll' && msg.poll_question) {
        queryClient.setQueryData(['poll', msg.content], (prev: any) => {
          if (prev) return prev; // Don't overwrite if already cached
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

  // Pre-compute grouping/display metadata for all messages
  const messageMeta = useMemo(() => computeMessageMeta(messages), [messages]);

  const visibleMessageIds = useMemo(
    () => messages.filter((m) => !m.id.startsWith('temp-')).map((m) => m.id),
    [messages],
  );

  const { data: reactionsMap } = useReactions(
    conversationId ?? null,
    visibleMessageIds,
    teamId ?? null,
  );

  const sendMessage = useSendMessage(
    conversationId!,
    teamId!,
    myTeamName ?? 'Me',
    leagueId!,
  );

  const toggleReaction = useToggleReaction(conversationId!);

  const newestMessageId = messages.length > 0 ? messages[0].id : null;
  const { receipts: readReceipts, updateReadPosition } = useReadReceipts(
    conversationId ?? null,
    teamId ?? null,
    myTeamName,
    myTricode,
  );
  useMarkRead(conversationId ?? null, teamId ?? null, newestMessageId, updateReadPosition);

  const readReceiptsByMessageId = useMemo(() => {
    if (!teamId || messages.length === 0 || readReceipts.length === 0) return {};

    const idxById = new Map<string, number>();
    for (let i = 0; i < messages.length; i++) {
      idxById.set(messages[i].id, i);
    }

    const map: Record<string, typeof readReceipts> = {};
    for (const r of readReceipts) {
      if (!r.last_read_message_id) continue;
      const readIdx = idxById.get(r.last_read_message_id);
      if (readIdx === undefined) continue;

      for (let i = readIdx; i < messages.length; i++) {
        if (messages[i].team_id === teamId) {
          const msgId = messages[i].id;
          if (!map[msgId]) map[msgId] = [];
          map[msgId].push(r);
          break;
        }
      }
    }
    return map;
  }, [readReceipts, messages, teamId]);

  const [reactionTargetId, setReactionTargetId] = useState<string | null>(null);

  const handleSend = useCallback(
    (text: string) => {
      sendMessage.mutate(text);
    },
    [sendMessage],
  );

  // Stable callbacks — item component passes its own ID
  const handleLongPress = useCallback((messageId: string) => {
    setReactionTargetId(messageId);
  }, []);

  const handleReactionSelect = useCallback(
    (emoji: string) => {
      if (!reactionTargetId || !teamId) return;
      toggleReaction.mutate({
        messageId: reactionTargetId,
        teamId,
        emoji,
      });
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

  const isLeagueChat = convMeta?.type === 'league';
  const isDM = convMeta?.type === 'dm';

  // Shared swipe-to-reveal
  const swipeReveal = useSharedValue(0);
  const listPanGesture = Gesture.Pan()
    .activeOffsetX(-10)
    .failOffsetY([-5, 5])
    .onUpdate((e) => {
      swipeReveal.value = Math.max(-60, Math.min(0, e.translationX));
    })
    .onEnd(() => {
      swipeReveal.value = withSpring(0, { damping: 50, stiffness: 400, overshootClamping: true });
    });

  // Stable color ref so renderItem doesn't depend on `c` object identity
  const secondaryTextColor = c.secondaryText;

  const renderItem = useCallback(
    ({ item }: { item: ChatMessage }) => {
      const meta = messageMeta.get(item.id);
      if (!meta) return null;

      return (
        <ChatItem
          item={item}
          meta={meta}
          isOwn={item.team_id === teamId}
          isDM={isDM ?? false}
          isLeagueChat={isLeagueChat ?? false}
          isCommissioner={isCommissioner ?? false}
          reactions={reactionsMap?.[item.id] ?? emptyReactions}
          readers={readReceiptsByMessageId[item.id] ?? emptyReaders}
          isSelected={reactionTargetId === item.id}
          teamId={teamId ?? undefined}
          swipeReveal={swipeReveal}
          secondaryTextColor={secondaryTextColor}
          onLongPress={handleLongPress}
          onReactionPress={handleItemReactionPress}
        />
      );
    },
    [teamId, messageMeta, isDM, isLeagueChat, isCommissioner, reactionsMap, readReceiptsByMessageId, reactionTargetId, swipeReveal, secondaryTextColor, handleLongPress, handleItemReactionPress],
  );

  const keyExtractor = useCallback((item: ChatMessage) => item.id, []);

  // +1 for ourselves (we're always online when viewing)
  const onlineCount = readReceipts.filter((r) => r.online).length + 1;
  const onlineTeams = readReceipts.filter((r) => r.online);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.background }]}>
      <PageHeader
        title={convMeta?.name ?? 'Chat'}
        rightAction={
          convMeta?.type === 'dm' ? (
            readReceipts.some((r) => r.online) ? (
              <View style={styles.onlineDot} accessibilityLabel="Online" />
            ) : null
          ) : convMeta?.type === 'league' ? (
            <TouchableOpacity
              onPress={() => setShowPresenceList(true)}
              style={[styles.presencePill, { backgroundColor: c.cardAlt }]}
              accessibilityRole="button"
              accessibilityLabel={`${onlineCount} of ${convMeta.memberCount} teams online`}
            >
              <View style={styles.onlineDot} />
              <ThemedText style={[styles.presenceText, { color: c.text }]}>
                {onlineCount}/{convMeta.memberCount}
              </ThemedText>
            </TouchableOpacity>
          ) : null
        }
      />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        {isLoading ? (
          <View style={styles.empty}>
            <ActivityIndicator />
          </View>
        ) : messages.length === 0 ? (
          <View style={styles.empty}>
            <ThemedText style={{ color: c.secondaryText }}>
              No messages yet. Say something!
            </ThemedText>
          </View>
        ) : (
          <GestureDetector gesture={listPanGesture}>
            <Animated.View style={styles.flex}>
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
                    <ActivityIndicator style={styles.footerLoader} />
                  ) : null
                }
              />
            </Animated.View>
          </GestureDetector>
        )}

        <ChatInput
          onSend={handleSend}
          sending={sendMessage.isPending}
          isCommissioner={isCommissioner ?? false}
          isLeagueChat={isLeagueChat}
          onCreatePoll={() => setShowCreatePoll(true)}
        />
      </KeyboardAvoidingView>

      {reactionTargetId && (
        <ReactionPicker
          visible
          onSelect={handleReactionSelect}
          onClose={() => setReactionTargetId(null)}
          existingReactions={reactionsMap?.[reactionTargetId]}
        />
      )}

      {showCreatePoll && leagueId && conversationId && teamId && (
        <CreatePollModal
          visible={showCreatePoll}
          leagueId={leagueId}
          conversationId={conversationId}
          teamId={teamId}
          onClose={() => setShowCreatePoll(false)}
        />
      )}

      <Modal
        visible={showPresenceList}
        transparent
        animationType="fade"
        onRequestClose={() => setShowPresenceList(false)}
      >
        <Pressable style={styles.presenceOverlay} onPress={() => setShowPresenceList(false)}>
          <View style={[styles.presenceModal, { backgroundColor: c.card, borderColor: c.border }]}>
            <ThemedText type="defaultSemiBold" style={{ marginBottom: 8 }}>
              Online ({onlineCount}/{convMeta?.memberCount ?? '?'})
            </ThemedText>
            <FlatList
              data={[
                { team_id: teamId!, team_name: myTeamName ?? 'Me', tricode: myTricode ?? '', online: true },
                ...onlineTeams,
              ]}
              keyExtractor={(item) => item.team_id}
              renderItem={({ item, index }) => (
                <View style={[styles.presenceRow, { borderBottomColor: c.border }, index === onlineTeams.length && { borderBottomWidth: 0 }]}>
                  <View style={styles.onlineDot} />
                  <ThemedText accessibilityLabel={`${item.team_name} is online`}>
                    {item.team_name}
                  </ThemedText>
                </View>
              )}
            />
          </View>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

// Stable empty array references to avoid re-renders
const emptyReactions: ReactionGroup[] = [];
const emptyReaders: ReadReceipt[] = [];

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  list: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  footerLoader: {
    paddingVertical: 16,
  },
  dateHeader: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  dateHeaderText: {
    fontSize: 12,
    fontWeight: '500',
  },
  onlineDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#22c55e',
  },
  presencePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  presenceText: {
    fontSize: 12,
    fontWeight: '600',
  },
  presenceOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  presenceModal: {
    width: 250,
    maxHeight: 300,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
  },
  presenceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
