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
  useSendMessage,
  useToggleReaction,
} from '@/hooks/chat';
import { useColorScheme } from '@/hooks/useColorScheme';
import { supabase } from '@/lib/supabase';
import type { ChatMessage, ReactionGroup } from '@/types/chat';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

// "Today 12:30 PM", "Yesterday 3:45 PM", "Monday 2:15 PM", "Mar 10, 1:00 PM"
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

      if (conv.type === 'league') return { name: 'League Chat', type: conv.type };

      // DM: get the other team's name
      const { data: members } = await supabase
        .from('chat_members')
        .select('team_id, teams(name)')
        .eq('conversation_id', conversationId!)
        .neq('team_id', teamId!);

      const otherName = (members?.[0] as any)?.teams?.name ?? 'DM';
      return { name: otherName, type: conv.type };
    },
    enabled: !!conversationId && !!teamId,
  });

  // Get my team name for optimistic updates
  const { data: myTeamName } = useQuery({
    queryKey: ['myTeamName', teamId],
    queryFn: async () => {
      const { data } = await supabase
        .from('teams')
        .select('name')
        .eq('id', teamId!)
        .single();
      return data?.name ?? 'Me';
    },
    enabled: !!teamId,
    staleTime: Infinity,
  });

  // Check if current user is commissioner
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
    leagueId,
  );

  const toggleReaction = useToggleReaction(conversationId!);

  useMarkRead(conversationId ?? null, teamId ?? null);

  // Reaction picker state
  const [reactionTargetId, setReactionTargetId] = useState<string | null>(null);

  const handleSend = useCallback(
    (text: string) => {
      sendMessage.mutate(text);
    },
    [sendMessage],
  );

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

  const handleReactionPress = useCallback(
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

  // Check if two timestamps are within the same minute
  const sameMinute = useCallback((a: string, b: string) => {
    return a.slice(0, 16) === b.slice(0, 16);
  }, []);

  // Shared swipe-to-reveal: drag the whole list left to show per-message times
  const swipeReveal = useSharedValue(0);
  const listPanGesture = Gesture.Pan()
    .activeOffsetX([-10, 10])
    .failOffsetY([-5, 5])
    .onUpdate((e) => {
      swipeReveal.value = Math.max(-60, Math.min(0, e.translationX));
    })
    .onEnd(() => {
      swipeReveal.value = withSpring(0, { damping: 50, stiffness: 400, overshootClamping: true });
    });

  const renderItem = useCallback(
    ({ item, index }: { item: ChatMessage; index: number }) => {
      // Pre-seed poll cache so PollBubble renders instantly without a loading state
      if (item.type === 'poll' && item.poll_question) {
        queryClient.setQueryData(['poll', item.content], {
          id: item.content,
          question: item.poll_question,
          options: item.poll_options,
          poll_type: item.poll_type,
          closes_at: item.poll_closes_at,
          is_anonymous: item.poll_is_anonymous,
          show_live_results: item.poll_show_live_results,
        });
      }

      const isOwn = item.team_id === teamId;
      const reactions: ReactionGroup[] = reactionsMap?.[item.id] ?? [];

      // Inverted list: index 0 = newest. "prev" = next index (older), "next" = prev index (newer).
      const newerMsg = index > 0 ? messages[index - 1] : null;
      const olderMsg = index < messages.length - 1 ? messages[index + 1] : null;

      const sameSenderAsNewer =
        newerMsg !== null &&
        newerMsg.team_id === item.team_id &&
        sameMinute(newerMsg.created_at, item.created_at);

      const sameSenderAsOlder =
        olderMsg !== null &&
        olderMsg.team_id === item.team_id &&
        sameMinute(olderMsg.created_at, item.created_at);

      // First in group = no older message from same sender (top of visual group)
      // Last in group = no newer message from same sender (bottom of visual group)
      const isFirstInGroup = !sameSenderAsOlder;
      const isLastInGroup = !sameSenderAsNewer;

      // Time header: show when there's a 1+ hour gap between this message
      // and the older one (visually above in inverted list).
      const GAP_MS = 60 * 60 * 1000; // 1 hour
      const itemTime = new Date(item.created_at).getTime();
      const olderTime = olderMsg ? new Date(olderMsg.created_at).getTime() : 0;
      const showTimeHeader = !olderMsg || (itemTime - olderTime) >= GAP_MS;

      // Show swipe-reveal time only on last message in group (avoids clutter)
      const showSwipeTime = isLastInGroup;

      return (
        <>
          <MessageBubble
            message={item}
            isOwnMessage={isOwn}
            showSender={isLeagueChat}
            isFirstInGroup={isFirstInGroup}
            isLastInGroup={isLastInGroup}
            reactions={reactions}
            onLongPress={() => handleLongPress(item.id)}
            onReactionPress={(emoji) => handleReactionPress(item.id, emoji)}
            teamId={teamId ?? undefined}
            isCommissioner={isCommissioner ?? false}
            swipeReveal={swipeReveal}
            showSwipeTime={showSwipeTime}
          />
          {showTimeHeader && (
            <View style={styles.dateHeader}>
              <ThemedText style={[styles.dateHeaderText, { color: c.secondaryText }]}>
                {formatTimeHeader(item.created_at)}
              </ThemedText>
            </View>
          )}
        </>
      );
    },
    [teamId, reactionsMap, myTeamName, messages, isLeagueChat, isCommissioner, sameMinute, handleLongPress, handleReactionPress, queryClient, c, swipeReveal],
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.background }]}>
      <PageHeader title={convMeta?.name ?? 'Chat'} />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        {isLoading ? (
          <ActivityIndicator style={styles.loader} />
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
                keyExtractor={(item) => item.id}
                renderItem={renderItem}
                inverted
                contentContainerStyle={styles.list}
                onEndReached={onEndReached}
                onEndReachedThreshold={0.5}
                removeClippedSubviews
                maxToRenderPerBatch={15}
                windowSize={11}
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
    </SafeAreaView>
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
    paddingHorizontal: 8,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerBtn: {
    width: 70,
    paddingHorizontal: 8,
  },
  backText: {
    fontSize: 16,
    fontWeight: '500',
  },
  title: {
    fontSize: 16,
    textAlign: 'center',
    flex: 1,
  },
  loader: {
    marginTop: 40,
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
});
