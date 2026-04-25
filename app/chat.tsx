import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ConversationRow } from '@/components/chat/ConversationRow';
import { NewDMPicker } from '@/components/chat/NewDMPicker';
import { LogoSpinner } from '@/components/ui/LogoSpinner';
import { PageHeader } from '@/components/ui/PageHeader';
import { ThemedText } from '@/components/ui/ThemedText';
import { Colors } from '@/constants/Colors';
import { queryKeys } from '@/constants/queryKeys';
import { useAppState } from '@/context/AppStateProvider';
import { useConversations, useCreateDM } from '@/hooks/chat';
import { readReceiptSeedKey, fetchReadReceiptSeed } from '@/hooks/chat/useReadReceipts';
import { useColorScheme } from '@/hooks/useColorScheme';
import { supabase } from '@/lib/supabase';
import type { ChatMessage, ConversationPreview } from '@/types/chat';
import { ms, s } from "@/utils/scale";

export default function ChatList() {
  const router = useRouter();
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const { leagueId, teamId } = useAppState();

  const queryClient = useQueryClient();
  const { data: conversations, isLoading } = useConversations();
  const createDM = useCreateDM(leagueId!);

  // Pre-load league chat messages so the FlatList doesn't jump on navigate
  useEffect(() => {
    if (!conversations) return;
    const leagueChat = conversations.find((c) => c.type === 'league');
    if (!leagueChat) return;

    queryClient.prefetchInfiniteQuery({
      queryKey: queryKeys.messages(leagueChat.id),
      queryFn: async () => {
        const { data } = await supabase.rpc('get_messages_page', {
          p_conversation_id: leagueChat.id,
          p_cursor: undefined,
          p_cursor_id: undefined,
          p_limit: 30,
        });
        return (data ?? []) as unknown as ChatMessage[];
      },
      initialPageParam: { cursor: null, cursorId: null },
    });
  }, [conversations, queryClient]);

  // Prefetch team logos so presence avatars don't pop in when entering a chat
  useEffect(() => {
    if (!leagueId) return;
    queryClient.prefetchQuery({
      queryKey: queryKeys.teamLogos(leagueId),
      queryFn: async () => {
        const { data } = await supabase
          .from('teams')
          .select('id, logo_key')
          .eq('league_id', leagueId);
        const map: Record<string, string | null> = {};
        for (const t of data ?? []) {
          map[t.id] = t.logo_key;
          // Warm the image cache so logos render instantly
          if (t.logo_key?.startsWith('http')) Image.prefetch(t.logo_key);
        }
        return map;
      },
      staleTime: 1000 * 60 * 10,
    });
  }, [leagueId, queryClient]);

  // Prefetch read receipts for each conversation so they don't pop in
  useEffect(() => {
    if (!conversations || !teamId) return;
    for (const conv of conversations) {
      queryClient.prefetchQuery({
        queryKey: readReceiptSeedKey(conv.id, teamId),
        queryFn: () => fetchReadReceiptSeed(conv.id, teamId),
        staleTime: 1000 * 60 * 5,
      });
    }
  }, [conversations, teamId, queryClient]);
  const [dmPickerVisible, setDmPickerVisible] = useState(false);

  const handleConversationPress = useCallback(
    (conv: ConversationPreview) => {
      router.push(`/chat/${conv.id}`);
    },
    [router],
  );

  const handleNewDM = useCallback(
    async (otherTeamId: string) => {
      setDmPickerVisible(false);
      try {
        const conversationId = await createDM.mutateAsync({
          myTeamId: teamId!,
          otherTeamId,
        });
        router.push(`/chat/${conversationId}`);
      } catch (err) {
        console.error('Failed to create DM:', err);
      }
    },
    [createDM, teamId, router],
  );

  const renderItem = useCallback(
    ({ item }: { item: ConversationPreview }) => (
      <ConversationRow
        conversation={item}
        onPress={() => handleConversationPress(item)}
      />
    ),
    [handleConversationPress],
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.cardAlt }]}>
      <PageHeader
        title="Chat"
        rightAction={
          <TouchableOpacity
            onPress={() => setDmPickerVisible(true)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="New conversation"
          >
            <Ionicons name="create-outline" size={22} color={c.accent} accessible={false} />
          </TouchableOpacity>
        }
      />

      {isLoading ? (
        <View style={styles.loader}><LogoSpinner /></View>
      ) : !conversations || conversations.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="chatbubbles-outline" size={40} color={c.secondaryText} accessible={false} />
          <ThemedText style={[styles.emptyText, { color: c.secondaryText }]}>
            No conversations yet
          </ThemedText>
        </View>
      ) : (
        <FlatList
          data={conversations}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
        />
      )}

      {teamId && (
        <NewDMPicker
          visible={dmPickerVisible}
          currentTeamId={teamId}
          onSelect={handleNewDM}
          onClose={() => setDmPickerVisible(false)}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
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
    fontSize: ms(16),
    fontWeight: '500',
  },
  title: {
    fontSize: ms(16),
    textAlign: 'center',
  },
  loader: {
    marginTop: 40,
  },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  emptyText: {
    fontSize: ms(15),
  },
  list: {
    paddingVertical: s(8),
  },
});
