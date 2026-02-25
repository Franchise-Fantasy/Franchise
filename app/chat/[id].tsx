import { ChatInput } from '@/components/chat/ChatInput';
import { MessageBubble } from '@/components/chat/MessageBubble';
import { ReactionPicker } from '@/components/chat/ReactionPicker';
import { ThemedText } from '@/components/ThemedText';
import { Colors } from '@/constants/Colors';
import { useAppState } from '@/context/AppStateProvider';
import {
  useMarkRead,
  useMessages,
  useReactions,
  useSendMessage,
  useToggleReaction,
} from '@/hooks/useChat';
import { useColorScheme } from '@/hooks/useColorScheme';
import { supabase } from '@/lib/supabase';
import type { ChatMessage, ReactionGroup } from '@/types/chat';
import { useQuery } from '@tanstack/react-query';
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
  );

  const sendMessage = useSendMessage(
    conversationId!,
    teamId!,
    myTeamName ?? 'Me',
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

  const renderItem = useCallback(
    ({ item }: { item: ChatMessage }) => {
      const isOwn = item.team_id === teamId;
      const reactions: ReactionGroup[] = (reactionsMap?.[item.id] ?? []).map(
        (r) => ({
          ...r,
          reacted_by_me: r.team_names.includes(myTeamName ?? ''),
        }),
      );

      return (
        <MessageBubble
          message={item}
          isOwnMessage={isOwn}
          showSender={isLeagueChat}
          reactions={reactions}
          onLongPress={() => handleLongPress(item.id)}
          onReactionPress={(emoji) => handleReactionPress(item.id, emoji)}
        />
      );
    },
    [teamId, reactionsMap, myTeamName, isLeagueChat, handleLongPress, handleReactionPress],
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.background }]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: c.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn}>
          <Text style={[styles.backText, { color: c.accent }]}>&#8249; Back</Text>
        </TouchableOpacity>
        <ThemedText type="defaultSemiBold" style={styles.title} numberOfLines={1}>
          {convMeta?.name ?? 'Chat'}
        </ThemedText>
        <View style={styles.headerBtn} />
      </View>

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
          <FlatList
            data={messages}
            keyExtractor={(item) => item.id}
            renderItem={renderItem}
            inverted
            contentContainerStyle={styles.list}
            onEndReached={onEndReached}
            onEndReachedThreshold={0.5}
            ListFooterComponent={
              isFetchingNextPage ? (
                <ActivityIndicator style={styles.footerLoader} />
              ) : null
            }
          />
        )}

        <ChatInput onSend={handleSend} sending={sendMessage.isPending} />
      </KeyboardAvoidingView>

      {reactionTargetId && (
        <ReactionPicker
          visible
          onSelect={handleReactionSelect}
          onClose={() => setReactionTargetId(null)}
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
});
