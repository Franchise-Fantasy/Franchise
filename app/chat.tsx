import { ConversationRow } from '@/components/chat/ConversationRow';
import { NewDMPicker } from '@/components/chat/NewDMPicker';
import { ThemedText } from '@/components/ThemedText';
import { Colors } from '@/constants/Colors';
import { useAppState } from '@/context/AppStateProvider';
import { useConversations, useCreateDM } from '@/hooks/useChat';
import { useColorScheme } from '@/hooks/useColorScheme';
import type { ConversationPreview } from '@/types/chat';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function ChatList() {
  const router = useRouter();
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const { leagueId, teamId } = useAppState();

  const { data: conversations, isLoading } = useConversations();
  const createDM = useCreateDM(leagueId!);
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
      <View style={[styles.header, { borderBottomColor: c.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn}>
          <Text style={[styles.backText, { color: c.accent }]}>&#8249; Back</Text>
        </TouchableOpacity>
        <ThemedText type="defaultSemiBold" style={styles.title}>
          Chat
        </ThemedText>
        <TouchableOpacity
          onPress={() => setDmPickerVisible(true)}
          style={styles.headerBtn}
          hitSlop={8}
        >
          <Ionicons name="create-outline" size={22} color={c.accent} />
        </TouchableOpacity>
      </View>

      {isLoading ? (
        <ActivityIndicator style={styles.loader} />
      ) : !conversations || conversations.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="chatbubbles-outline" size={40} color={c.secondaryText} />
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
    fontSize: 16,
    fontWeight: '500',
  },
  title: {
    fontSize: 16,
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
    fontSize: 15,
  },
  list: {
    padding: 16,
    gap: 10,
  },
});
