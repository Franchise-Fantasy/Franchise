import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  Platform,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  FadeIn,
  FadeOut,
  type SharedValue,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ChatFilterStrip, type ChatFilter } from '@/components/chat/ChatFilterStrip';
import { ChatInput } from '@/components/chat/ChatInput';
import { ContentDraftsSheet } from '@/components/chat/ContentDraftsSheet';
import { CreatePollModal } from '@/components/chat/CreatePollModal';
import { CreateSurveyModal } from '@/components/chat/CreateSurveyModal';
import { GifPicker } from '@/components/chat/GifPicker';
import {
  MessageActionMenu,
  type FocusedMessage,
  type MessageAction,
} from '@/components/chat/MessageActionMenu';
import { MessageBubble } from '@/components/chat/MessageBubble';
import { PinnedMessagesSheet } from '@/components/chat/PinnedMessagesSheet';
import { PresenceAvatars } from '@/components/chat/PresenceAvatars';
import { PresenceListSheet } from '@/components/chat/PresenceListSheet';
import { ReadReceiptIndicator } from '@/components/chat/ReadReceiptIndicator';
import { ReportReasonSheet, type ReportReason } from '@/components/chat/ReportReasonSheet';
import { LogoSpinner } from '@/components/ui/LogoSpinner';
import { PageHeader } from '@/components/ui/PageHeader';
import { ThemedText } from '@/components/ui/ThemedText';
import { Brand, Fonts } from '@/constants/Colors';
import { queryKeys } from '@/constants/queryKeys';
import { useAppState } from '@/context/AppStateProvider';
import { useConfirm } from '@/context/ConfirmProvider';
import {
  useChatSubscription,
  useContentDrafts,
  useDeleteContentDraft,
  useMarkRead,
  useMessages,
  usePinnedMessages,
  useReactions,
  useReadReceipts,
  useSendGif,
  useSendImage,
  useSendMessage,
  useTogglePin,
  useToggleReaction,
  useUnsendMessage,
} from '@/hooks/chat';
import type { ReadReceipt } from '@/hooks/chat/useReadReceipts';
import { useColors } from '@/hooks/useColors';
import { supabase } from '@/lib/supabase';
import type { ChatMessage, ReactionGroup } from '@/types/chat';
import type { CommissionerContentDraft } from '@/utils/chat/contentDraftBody';
import { isSystemAuthored } from '@/utils/chat/messageTypes';
import { KeyboardAvoidingView } from '@/utils/keyboardController';
import { logger } from '@/utils/logger';
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
  isPinned: boolean;
  reactions: ReactionGroup[];
  readers: ReadReceipt[];
  isSelected: boolean;
  teamId: string | undefined;
  teamLogoKey: string | null;
  teamTricode: string | null;
  swipeReveal: SharedValue<number>;
  secondaryTextColor: string;
  onLongPress: (messageId: string, focused: FocusedMessage | null) => void;
  onReactionPress: (messageId: string, emoji: string) => void;
}

const ChatItem = React.memo(function ChatItem({
  item,
  meta,
  isOwn,
  isDM,
  isLeagueChat,
  isCommissioner,
  isPinned,
  reactions,
  readers,
  isSelected,
  teamId,
  teamLogoKey,
  teamTricode,
  swipeReveal,
  secondaryTextColor,
  onLongPress,
  onReactionPress,
}: ChatItemProps) {
  const bubbleRef = useRef<View>(null);

  const handleReactionPress = useCallback(
    (emoji: string) => {
      onReactionPress(item.id, emoji);
    },
    [onReactionPress, item.id],
  );

  // The action menu draws a copy of this bubble above its scrim so the message
  // you pressed stays visible and in place. `renderBubble` is the single source
  // for both the list row and that copy — the copy passes `selected: false`
  // because the menu applies the lift itself.
  const renderBubble = (selected: boolean) => (
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
      teamLogoKey={teamLogoKey}
      teamTricode={teamTricode}
      isCommissioner={isCommissioner}
      swipeReveal={swipeReveal}
      showSwipeTime={meta.showSwipeTime}
      isSelected={selected}
      isPinned={isPinned}
    />
  );

  // Measure where the bubble actually sits on screen so the menu can hold it
  // in place. Falls back to a centred menu if the measurement doesn't land.
  const handleLongPress = () => {
    const node = bubbleRef.current;
    if (!node) {
      onLongPress(item.id, null);
      return;
    }
    node.measureInWindow((x, y, width, height) => {
      onLongPress(
        item.id,
        Number.isFinite(x) && width > 0 && height > 0
          ? { rect: { x, y, width, height }, isOwn, render: () => renderBubble(false) }
          : null,
      );
    });
  };

  return (
    <View>
      {meta.showTimeHeader && (
        <View style={styles.dateHeader}>
          <View style={[styles.dateRule, { backgroundColor: secondaryTextColor, opacity: 0.25 }]} />
          <ThemedText
            type="varsitySmall"
            style={[styles.dateHeaderText, { color: secondaryTextColor }]}
          >
            {meta.timeHeader.toUpperCase()}
          </ThemedText>
          <View style={[styles.dateRule, { backgroundColor: secondaryTextColor, opacity: 0.25 }]} />
        </View>
      )}
      {/* collapsable={false} keeps this a real native view on Android so
          measureInWindow has something to measure. */}
      <View ref={bubbleRef} collapsable={false}>
        {renderBubble(isSelected)}
      </View>
      {isOwn && item.type !== 'poll' && readers.length > 0 && (
        <ReadReceiptIndicator isDM={isDM} readers={readers} />
      )}
    </View>
  );
});

// ─── Main screen ──────────────────────────────────────────────

export default function ConversationScreen() {
  const { id: conversationId, messageId } = useLocalSearchParams<{ id: string; messageId?: string }>();
  const c = useColors();
  const { teamId, leagueId } = useAppState();
  const confirm = useConfirm();

  // Fetch conversation metadata to show the right title
  const { data: convMeta, isError: isConvError } = useQuery({
    queryKey: queryKeys.conversationMeta(conversationId!),
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

      if (conv.type === 'trade') {
        const otherNames = (members ?? []).map((m: any) => m.teams?.name).filter(Boolean).join(', ');
        return { name: `Trade: ${otherNames || 'Trade'}`, type: conv.type, memberCount: memberCount ?? 0 };
      }

      const otherName = (members?.[0] as any)?.teams?.name ?? 'DM';
      return { name: otherName, type: conv.type, memberCount: memberCount ?? 0 };
    },
    enabled: !!conversationId && !!teamId,
  });

  const { data: myTeamInfo } = useQuery({
    queryKey: queryKeys.myTeamInfo(teamId!),
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
    queryKey: queryKeys.isCommissioner(leagueId!),
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

  // Map team_id → logo_key for chat avatars
  const { data: teamLogoMap } = useQuery<Record<string, string | null>>({
    queryKey: queryKeys.teamLogos(leagueId!),
    queryFn: async () => {
      const { data } = await supabase
        .from('teams')
        .select('id, logo_key')
        .eq('league_id', leagueId!);
      const map: Record<string, string | null> = {};
      for (const t of data ?? []) map[t.id] = t.logo_key;
      return map;
    },
    enabled: !!leagueId,
    staleTime: 1000 * 60 * 10,
  });

  // team_id → tricode for message-avatar initials. Kept separate from
  // teamLogoMap so that map's plain logo-key shape (shared by presence
  // avatars + draft chat) stays untouched.
  const { data: teamTricodeMap } = useQuery<Record<string, string | null>>({
    queryKey: queryKeys.teamTricodes(leagueId!),
    queryFn: async () => {
      const { data } = await supabase
        .from('teams')
        .select('id, tricode')
        .eq('league_id', leagueId!);
      const map: Record<string, string | null> = {};
      for (const t of data ?? []) map[t.id] = t.tricode;
      return map;
    },
    enabled: !!leagueId,
    staleTime: 1000 * 60 * 10,
  });

  const queryClient = useQueryClient();
  const flatListRef = useRef<FlatList<ChatMessage>>(null);
  const [showCreatePoll, setShowCreatePoll] = useState(false);
  const [showCreateSurvey, setShowCreateSurvey] = useState(false);
  const [showDrafts, setShowDrafts] = useState(false);
  // The saved draft the open composer is editing — null when composing fresh.
  const [activeDraft, setActiveDraft] = useState<CommissionerContentDraft | null>(null);
  const [showPresenceList, setShowPresenceList] = useState(false);
  const [showGifPicker, setShowGifPicker] = useState(false);
  const [activeFilter, setActiveFilter] = useState<ChatFilter>('all');
  const [filterExpanded, setFilterExpanded] = useState(false);
  const [reportingMessageId, setReportingMessageId] = useState<string | null>(null);

  // Refresh messages when screen gains focus (catches messages missed by realtime)
  useFocusEffect(
    useCallback(() => {
      if (conversationId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.messages(conversationId!) });
      }
    }, [conversationId, queryClient]),
  );

  // Single realtime channel for both messages + reactions (saves one connection per conversation)
  useChatSubscription(conversationId ?? null);

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

  // Counts per filter category — drives chip visibility and badges
  const filterCounts = useMemo(() => {
    const counts: Record<ChatFilter, number> = {
      all: 0,
      chat: 0,
      trade: 0,
      rumor: 0,
      poll: 0,
      survey: 0,
    };
    for (const m of messages) {
      counts.all += 1;
      if (m.type === 'text' || m.type === 'image' || m.type === 'gif' || m.type === 'announcement') counts.chat += 1;
      else if (m.type === 'trade' || m.type === 'trade_update') counts.trade += 1;
      else if (m.type === 'rumor') counts.rumor += 1;
      else if (m.type === 'poll') counts.poll += 1;
      else if (m.type === 'survey') counts.survey += 1;
    }
    return counts;
  }, [messages]);

  const visibleMessages = useMemo(() => {
    if (activeFilter === 'all') return messages;
    return messages.filter((m) => {
      switch (activeFilter) {
        case 'chat':
          return m.type === 'text' || m.type === 'image' || m.type === 'gif' || m.type === 'announcement';
        case 'trade':
          return m.type === 'trade' || m.type === 'trade_update';
        case 'rumor':
          return m.type === 'rumor';
        case 'poll':
          return m.type === 'poll';
        case 'survey':
          return m.type === 'survey';
        default:
          return true;
      }
    });
  }, [messages, activeFilter]);

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

  // Pre-compute grouping/display metadata for visible (filtered) messages
  const messageMeta = useMemo(() => computeMessageMeta(visibleMessages), [visibleMessages]);

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

  const { pickAndSend: pickImage, isUploading } = useSendImage(
    conversationId!,
    teamId!,
    myTeamName ?? 'Me',
    leagueId!,
  );

  const { sendGif } = useSendGif(
    conversationId!,
    teamId!,
    myTeamName ?? 'Me',
    leagueId!,
  );

  const handleGifSelect = useCallback(
    (gifUrl: string) => {
      sendGif(gifUrl);
      setShowGifPicker(false);
    },
    [sendGif],
  );

  const toggleReaction = useToggleReaction(conversationId!);
  const unsendMessage = useUnsendMessage(conversationId!, leagueId!);
  const togglePin = useTogglePin(conversationId ?? null);
  const { data: pinnedMessages } = usePinnedMessages(conversationId ?? null);
  const pinnedIds = useMemo(() => new Set(pinnedMessages?.map((m) => m.id) ?? []), [pinnedMessages]);
  const [showPinnedSheet, setShowPinnedSheet] = useState(false);

  const newestMessage = messages.length > 0 ? messages[0] : null;
  const newestMessageId = newestMessage?.id ?? null;
  const newestMessageCreatedAt = newestMessage?.created_at ?? null;
  const { receipts: readReceipts, updateReadPosition } = useReadReceipts(
    conversationId ?? null,
    teamId ?? null,
    myTeamName,
    myTricode,
  );
  useMarkRead(
    conversationId ?? null,
    teamId ?? null,
    newestMessageId,
    newestMessageCreatedAt,
    updateReadPosition,
  );

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
  // Where the pressed bubble sits on screen, so the menu can hold it in focus.
  const [focusedMessage, setFocusedMessage] = useState<FocusedMessage | null>(null);

  const handleSend = useCallback(
    (text: string) => {
      sendMessage.mutate({ content: text });
      setActiveFilter('all');
      setFilterExpanded(false);
    },
    [sendMessage],
  );

  // Stable callbacks — item component passes its own ID and measured frame
  const handleLongPress = useCallback((messageId: string, focused: FocusedMessage | null) => {
    setFocusedMessage(focused);
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

  const scrollToMessage = useCallback((messageId: string) => {
    // Clear filter so the target is guaranteed to be in the list
    setActiveFilter('all');
    setFilterExpanded(false);
    const index = messages.findIndex((m) => m.id === messageId);
    if (index >= 0 && flatListRef.current) {
      flatListRef.current.scrollToIndex({ index, animated: true, viewPosition: 0.5 });
    }
  }, [messages]);

  const handleScrollToIndexFailed = useCallback((info: { index: number }) => {
    // If the item isn't rendered yet, scroll to the end and retry
    flatListRef.current?.scrollToOffset({ offset: info.index * 80, animated: false });
    setTimeout(() => {
      flatListRef.current?.scrollToIndex({ index: info.index, animated: true, viewPosition: 0.5 });
    }, 200);
  }, []);

  // Jump to a specific message when deep-linked (e.g. a reported-message
  // notification opening for the commissioner). Runs once the target loads.
  const scrolledToTargetRef = useRef(false);
  useEffect(() => {
    if (!messageId || scrolledToTargetRef.current || messages.length === 0) return;
    if (messages.some((m) => m.id === messageId)) {
      scrolledToTargetRef.current = true;
      scrollToMessage(messageId);
    }
  }, [messageId, messages, scrollToMessage]);

  const handleTogglePin = useCallback(() => {
    if (!reactionTargetId || !teamId) return;
    togglePin.mutate({
      messageId: reactionTargetId,
      teamId,
      isPinned: pinnedIds.has(reactionTargetId),
    });
    setReactionTargetId(null);
  }, [reactionTargetId, teamId, togglePin, pinnedIds]);

  const handleUnsend = useCallback(() => {
    if (!reactionTargetId) return;
    unsendMessage.mutate(reactionTargetId);
    setReactionTargetId(null);
  }, [reactionTargetId, unsendMessage]);

  // Open the reason sheet for the currently-selected message.
  const handleReport = useCallback(() => {
    if (!reactionTargetId) return;
    setReportingMessageId(reactionTargetId);
    setReactionTargetId(null);
  }, [reactionTargetId]);

  const handleSubmitReport = useCallback(
    async (reason: ReportReason) => {
      const messageId = reportingMessageId;
      setReportingMessageId(null);
      if (!messageId) return;
      try {
        const { data, error } = await supabase.functions.invoke('report-message', {
          body: { message_id: messageId, reason },
        });
        if (error) throw error;
        // Reports against the commissioner's own messages aren't pushed to the
        // commissioner (circular) — they're recorded for review instead.
        Alert.alert(
          'Thanks for reporting',
          data?.notified_commissioner
            ? 'Your league commissioner has been notified.'
            : 'Your report has been recorded for review.',
        );
      } catch (err: any) {
        logger.error('report-message invoke failed', err);
        Alert.alert(
          'Could not submit report',
          err?.message ?? 'Please try again in a moment.',
        );
      }
    },
    [reportingMessageId],
  );

  // Block the user behind a message's team_id. Resolves user_id, inserts into
  // user_blocks, then invalidates the messages query so the chat re-renders
  // without the now-blocked sender's posts. The sender is resolved BEFORE the
  // confirm so blocking the commissioner can warn about what stays visible.
  const handleBlock = useCallback(async () => {
    if (!reactionTargetId) return;
    const target = messages.find((m) => m.id === reactionTargetId);
    setReactionTargetId(null);
    if (!target?.team_id || target.team_id === teamId) return;

    let blockedUserId: string;
    let blockerUserId: string;
    let targetIsCommissioner = false;
    try {
      const { data: team, error: teamErr } = await supabase
        .from('teams')
        .select('user_id')
        .eq('id', target.team_id)
        .single();
      if (teamErr || !team?.user_id) throw teamErr ?? new Error('Team not found');

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not signed in');
      if (team.user_id === user.id) return;

      blockedUserId = team.user_id;
      blockerUserId = user.id;
      if (leagueId) {
        const { data: league } = await supabase
          .from('leagues')
          .select('created_by')
          .eq('id', leagueId)
          .single();
        targetIsCommissioner = !!league?.created_by && league.created_by === team.user_id;
      }
    } catch (err: any) {
      logger.error('Block user failed', err);
      Alert.alert('Could not block user', err?.message ?? 'Please try again.');
      return;
    }

    confirm({
      title: targetIsCommissioner ? 'Block your commissioner?' : 'Block user?',
      message: targetIsCommissioner
        ? "This is your league's commissioner. Their regular messages will be hidden, but official league content — polls, surveys, trade updates, and announcements — will still appear so you don't miss league business. You can unblock them from your profile."
        : 'You will no longer see their messages or reactions in any league chat or DM. You can unblock them from your profile.',
      action: {
        label: 'Block',
        destructive: true,
        onPress: async () => {
          try {
            const { error: insertErr } = await supabase
              .from('user_blocks')
              .insert({ blocker_id: blockerUserId, blocked_id: blockedUserId });
            if (insertErr && insertErr.code !== '23505') throw insertErr;

            await queryClient.invalidateQueries({ queryKey: queryKeys.messages(conversationId!) });
            // Also refresh the conversation list + unread counts so the
            // blocked sender's last message and unread badge clear immediately.
            queryClient.invalidateQueries({ queryKey: ['conversations'] });
            queryClient.invalidateQueries({ queryKey: ['chatUnread'] });
          } catch (err: any) {
            logger.error('Block user failed', err);
            Alert.alert('Could not block user', err?.message ?? 'Please try again.');
          }
        },
      },
    });
  }, [reactionTargetId, messages, teamId, leagueId, queryClient, conversationId, confirm]);

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
  const isTradeChat = convMeta?.type === 'trade';
  const isDM = convMeta?.type === 'dm';

  // Saved poll/survey composer state. RLS already limits the table to the
  // caller's own drafts; the enabled flag just avoids the request for the ~all
  // of chat that isn't a commissioner in league chat.
  const { data: contentDrafts } = useContentDrafts(
    conversationId ?? null,
    !!isCommissioner && isLeagueChat,
  );
  const deleteContentDraft = useDeleteContentDraft();

  const openDraft = useCallback((draft: CommissionerContentDraft) => {
    setShowDrafts(false);
    setActiveDraft(draft);
    if (draft.kind === 'poll') setShowCreatePoll(true);
    else setShowCreateSurvey(true);
  }, []);
  // Trade chats show sender names like league chat (multiple participants)
  const showSenders = isLeagueChat || isTradeChat;

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
          isLeagueChat={showSenders ?? false}
          isCommissioner={isCommissioner ?? false}
          isPinned={pinnedIds.has(item.id)}
          reactions={reactionsMap?.[item.id] ?? emptyReactions}
          readers={readReceiptsByMessageId[item.id] ?? emptyReaders}
          isSelected={reactionTargetId === item.id}
          teamId={teamId ?? undefined}
          teamLogoKey={teamLogoMap?.[item.team_id] ?? null}
          teamTricode={teamTricodeMap?.[item.team_id] ?? null}
          swipeReveal={swipeReveal}
          secondaryTextColor={secondaryTextColor}
          onLongPress={handleLongPress}
          onReactionPress={handleItemReactionPress}
        />
      );
    },
    [teamId, teamLogoMap, teamTricodeMap, messageMeta, isDM, showSenders, isCommissioner, pinnedIds, reactionsMap, readReceiptsByMessageId, reactionTargetId, swipeReveal, secondaryTextColor, handleLongPress, handleItemReactionPress],
  );

  const keyExtractor = useCallback((item: ChatMessage) => item.id, []);

  const onlineTeams = readReceipts.filter((r) => r.online);

  // Only render the error fallback on a real fetch error — checking only
  // `!convMeta` raced with the initial query and flashed "Conversation not
  // found" for a frame on every chat open.
  if (isConvError && conversationId && teamId) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: c.background }]}>
        <PageHeader title="Chat" />
        <ThemedText style={{ textAlign: 'center', marginTop: 40, fontSize: ms(15), color: c.secondaryText }}>
          Conversation not found
        </ThemedText>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.background }]}>
      <PageHeader
        title={convMeta?.name ?? 'Chat'}
        clipContent
        rightAction={
          convMeta?.type === 'dm' ? (
            readReceipts.some((r) => r.online) ? (
              <View style={[styles.onlineDot, { backgroundColor: c.success }]} accessibilityLabel="Online" />
            ) : null
          ) : convMeta?.type === 'league' ? (
            <PresenceAvatars
              onlineTeams={onlineTeams}
              teamLogoMap={teamLogoMap}
              myTeamId={teamId!}
              myTeamName={myTeamName ?? 'Me'}
              myLogoKey={teamLogoMap?.[teamId!]}
              myTricode={myTricode}
              onPress={() => setShowPresenceList(true)}
            />
          ) : null
        }
      />

      {/* Floating pin pill (left) + filter icon (right). Strip expands leftward from the icon */}
      {isLeagueChat && ((pinnedMessages?.length ?? 0) > 0 || filterCounts.all > 0) && (
        <View style={styles.utilityRow}>
          {pinnedMessages && pinnedMessages.length > 0 && (
            <Animated.View
              entering={FadeIn.duration(150)}
              exiting={FadeOut.duration(120)}
            >
              <TouchableOpacity
                style={[styles.pinnedPill, { backgroundColor: c.gold }]}
                onPress={() => setShowPinnedSheet(true)}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={`${pinnedMessages.length} pinned message${pinnedMessages.length !== 1 ? 's' : ''}, tap to view`}
              >
                <Ionicons name="pin" size={ms(12)} color={Brand.ink} accessible={false} />
                <ThemedText style={[styles.pinnedPillCount, { color: Brand.ink }]}>
                  {pinnedMessages.length}
                </ThemedText>
              </TouchableOpacity>
            </Animated.View>
          )}
          <View style={styles.utilitySpacer}>
            <ChatFilterStrip
              activeFilter={activeFilter}
              onFilterChange={setActiveFilter}
              counts={filterCounts}
              visible={filterExpanded}
            />
          </View>
          <TouchableOpacity
            style={[
              styles.filterIconButton,
              {
                backgroundColor: filterExpanded || activeFilter !== 'all' ? c.gold : c.card,
                borderColor: filterExpanded || activeFilter !== 'all' ? c.gold : c.border,
              },
            ]}
            onPress={() => setFilterExpanded((prev) => !prev)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityState={{ expanded: filterExpanded }}
            accessibilityLabel={filterExpanded ? 'Close filter options' : 'Filter messages'}
          >
            <Ionicons
              name={filterExpanded ? 'close' : 'funnel-outline'}
              size={ms(12)}
              color={filterExpanded || activeFilter !== 'all' ? Brand.ink : c.secondaryText}
              accessible={false}
            />
          </TouchableOpacity>
        </View>
      )}

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        {isLoading ? (
          <View style={styles.empty}>
            <LogoSpinner />
          </View>
        ) : messages.length === 0 ? (
          <View style={styles.empty}>
            <ThemedText style={{ color: c.secondaryText }}>
              No messages yet. Say something!
            </ThemedText>
          </View>
        ) : visibleMessages.length === 0 ? (
          <View style={styles.empty}>
            <ThemedText style={{ color: c.secondaryText, textAlign: 'center', paddingHorizontal: s(24) }}>
              No messages match this filter yet.
            </ThemedText>
          </View>
        ) : (
          <GestureDetector gesture={listPanGesture}>
            <Animated.View style={styles.flex}>
              <FlatList
                ref={flatListRef}
                data={visibleMessages}
                keyExtractor={keyExtractor}
                renderItem={renderItem}
                inverted
                contentContainerStyle={styles.list}
                keyboardDismissMode="interactive"
                keyboardShouldPersistTaps="handled"
                onEndReached={onEndReached}
                onScrollToIndexFailed={handleScrollToIndexFailed}
                onEndReachedThreshold={0.5}
                removeClippedSubviews
                initialNumToRender={10}
                maxToRenderPerBatch={6}
                windowSize={5}
                ListFooterComponent={
                  isFetchingNextPage ? (
                    <View style={styles.footerLoader}><LogoSpinner size={18} /></View>
                  ) : null
                }
              />
            </Animated.View>
          </GestureDetector>
        )}

        <ChatInput
          conversationId={conversationId!}
          onSend={handleSend}
          sending={sendMessage.isPending}
          isCommissioner={isCommissioner ?? false}
          isLeagueChat={isLeagueChat}
          onCreatePoll={() => {
            setActiveDraft(null);
            setShowCreatePoll(true);
          }}
          onCreateSurvey={() => {
            setActiveDraft(null);
            setShowCreateSurvey(true);
          }}
          savedDraftCount={contentDrafts?.length ?? 0}
          onOpenDrafts={() => setShowDrafts(true)}
          onPickImage={pickImage}
          onOpenGifPicker={() => setShowGifPicker(true)}
          isUploading={isUploading}
        />
      </KeyboardAvoidingView>

      {reactionTargetId && (() => {
        const targetMessage = messages.find((m) => m.id === reactionTargetId);
        const isOwnTarget = targetMessage?.team_id === teamId;
        const isPinnedTarget = pinnedIds.has(reactionTargetId);
        // Trade announcements, trade-update events, and rumors are
        // system-authored even though they carry a team_id — they shouldn't
        // be unsendable since deleting them would erase auditable league
        // history (and the rumor mill is anonymized fiction anyway).
        const isUnsendable =
          targetMessage?.type !== 'trade' &&
          targetMessage?.type !== 'trade_update' &&
          targetMessage?.type !== 'rumor';
        // System-authored types carry a team_id but aren't personal speech, so
        // they get no Report/Block. See utils/chat/messageTypes.ts.
        const isOfficialTarget = isSystemAuthored(targetMessage?.type);

        const actions: MessageAction[] = [];
        if (isCommissioner && isLeagueChat) {
          actions.push({
            id: 'pin',
            label: isPinnedTarget ? 'Unpin' : 'Pin',
            icon: isPinnedTarget ? 'pin-outline' : 'pin',
            onPress: handleTogglePin,
          });
        }
        if (isOwnTarget && isUnsendable) {
          actions.push({
            id: 'unsend',
            label: 'Unsend',
            icon: 'trash-outline',
            onPress: handleUnsend,
            destructive: true,
          });
        }
        if (!isOwnTarget && targetMessage?.team_id != null && !isOfficialTarget) {
          actions.push({
            id: 'report',
            label: 'Report',
            icon: 'flag-outline',
            onPress: handleReport,
          });
          actions.push({
            id: 'block',
            label: 'Block User',
            icon: 'ban-outline',
            onPress: handleBlock,
            destructive: true,
          });
        }

        return (
          <MessageActionMenu
            visible
            onClose={() => {
              setReactionTargetId(null);
              setFocusedMessage(null);
            }}
            onReactionSelect={handleReactionSelect}
            actions={actions}
            existingReactions={reactionsMap?.[reactionTargetId]}
            focused={focusedMessage}
          />
        );
      })()}

      <ReportReasonSheet
        visible={!!reportingMessageId}
        onClose={() => setReportingMessageId(null)}
        onSubmit={handleSubmitReport}
      />


      {/* Both composers seed from `draft` on mount, so they stay conditionally
          mounted rather than living behind a `visible` toggle. */}
      {showCreatePoll && leagueId && conversationId && teamId && (
        <CreatePollModal
          visible={showCreatePoll}
          leagueId={leagueId}
          conversationId={conversationId}
          teamId={teamId}
          draft={activeDraft?.kind === 'poll' ? activeDraft : null}
          onClose={() => {
            setShowCreatePoll(false);
            setActiveDraft(null);
          }}
        />
      )}

      {showCreateSurvey && leagueId && conversationId && teamId && (
        <CreateSurveyModal
          visible={showCreateSurvey}
          leagueId={leagueId}
          conversationId={conversationId}
          teamId={teamId}
          draft={activeDraft?.kind === 'survey' ? activeDraft : null}
          onClose={() => {
            setShowCreateSurvey(false);
            setActiveDraft(null);
          }}
        />
      )}

      {showDrafts && conversationId && (
        <ContentDraftsSheet
          visible={showDrafts}
          drafts={contentDrafts ?? []}
          onSelect={openDraft}
          onDelete={(draft) =>
            deleteContentDraft.mutate(
              { id: draft.id, conversationId },
              {
                onError: (err: any) =>
                  Alert.alert('Error', err.message ?? 'Failed to delete draft'),
              },
            )
          }
          onClose={() => setShowDrafts(false)}
        />
      )}

      <GifPicker
        visible={showGifPicker}
        onSelect={handleGifSelect}
        onClose={() => setShowGifPicker(false)}
      />


      <PresenceListSheet
        visible={showPresenceList}
        onClose={() => setShowPresenceList(false)}
        readReceipts={readReceipts}
        myTeamId={teamId!}
        myTeamName={myTeamName ?? 'Me'}
        myTricode={myTricode}
        teamLogoMap={teamLogoMap}
        memberCount={convMeta?.memberCount}
      />

      <PinnedMessagesSheet
        visible={showPinnedSheet}
        onClose={() => setShowPinnedSheet(false)}
        messages={pinnedMessages ?? []}
        isCommissioner={!!isCommissioner}
        onSelect={(id) => {
          setShowPinnedSheet(false);
          scrollToMessage(id);
        }}
        onUnpin={(id) => togglePin.mutate({ messageId: id, teamId: teamId!, isPinned: true })}
      />
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
    paddingHorizontal: s(12),
    paddingVertical: s(8),
  },
  footerLoader: {
    paddingVertical: s(16),
  },
  dateHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(10),
    paddingVertical: s(12),
    paddingHorizontal: s(20),
  },
  dateRule: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
  },
  dateHeaderText: {
    fontFamily: Fonts.varsityBold,
    fontSize: ms(10),
    letterSpacing: 1.2,
  },
  onlineDot: {
    width: s(8),
    height: s(8),
    borderRadius: 4,
  },
  utilityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(8),
    paddingHorizontal: s(12),
    paddingTop: s(8),
    paddingBottom: s(4),
  },
  utilitySpacer: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  pinnedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(4),
    height: s(26),
    paddingHorizontal: s(10),
    borderRadius: s(13),
  },
  pinnedPillCount: {
    fontFamily: Fonts.varsityBold,
    fontSize: ms(10),
    letterSpacing: 0.5,
  },
  filterIconButton: {
    width: s(26),
    height: s(26),
    borderRadius: s(13),
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
});
