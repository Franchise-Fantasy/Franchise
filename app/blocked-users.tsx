import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { Alert, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LogoSpinner } from '@/components/ui/LogoSpinner';
import { PageHeader } from '@/components/ui/PageHeader';
import { Section } from '@/components/ui/Section';
import { ThemedText } from '@/components/ui/ThemedText';
import { useSession } from '@/context/AuthProvider';
import { useConfirm } from '@/context/ConfirmProvider';
import { useColors } from '@/hooks/useColors';
import { supabase } from '@/lib/supabase';
import { logger } from '@/utils/logger';
import { ms, s } from '@/utils/scale';

interface BlockedUser {
  user_id: string;
  display: string;
  blocked_at: string;
}

const BLOCKED_USERS_KEY = ['user_blocks', 'list'] as const;

export default function BlockedUsersScreen() {
  const session = useSession();
  const c = useColors();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const userId = session?.user?.id;

  const { data: blocks, isLoading } = useQuery<BlockedUser[]>({
    queryKey: BLOCKED_USERS_KEY,
    enabled: !!userId,
    queryFn: async () => {
      const { data: rows, error } = await supabase
        .from('user_blocks')
        .select('blocked_id, created_at')
        .order('created_at', { ascending: false });
      if (error) throw error;
      const ids = (rows ?? []).map((r) => r.blocked_id);
      if (ids.length === 0) return [];

      // Resolve a display name. profiles.username preferred, then email,
      // then fall back to the most recent team name they had.
      const [{ data: profiles }, { data: teams }] = await Promise.all([
        supabase.from('profiles').select('id, username, email').in('id', ids),
        supabase
          .from('teams')
          .select('user_id, name, created_at')
          .in('user_id', ids)
          .order('created_at', { ascending: false }),
      ]);

      const profileById = new Map<string, { username: string | null; email: string }>();
      for (const p of profiles ?? []) {
        profileById.set(p.id, { username: p.username, email: p.email });
      }
      const teamByUser = new Map<string, string>();
      for (const t of teams ?? []) {
        if (!t.user_id || !t.name) continue;
        if (!teamByUser.has(t.user_id)) teamByUser.set(t.user_id, t.name);
      }

      return (rows ?? []).map((r) => {
        const profile = profileById.get(r.blocked_id);
        const display = profile?.username
          || teamByUser.get(r.blocked_id)
          || profile?.email
          || 'Unknown user';
        return {
          user_id: r.blocked_id,
          display,
          blocked_at: r.created_at,
        };
      });
    },
  });

  const unblockMutation = useMutation({
    mutationFn: async (blockedId: string) => {
      const { error } = await supabase
        .from('user_blocks')
        .delete()
        .eq('blocked_id', blockedId);
      if (error) throw error;
    },
    onMutate: async (blockedId) => {
      await queryClient.cancelQueries({ queryKey: BLOCKED_USERS_KEY });
      const prev = queryClient.getQueryData<BlockedUser[]>(BLOCKED_USERS_KEY);
      queryClient.setQueryData<BlockedUser[]>(
        BLOCKED_USERS_KEY,
        (old) => (old ?? []).filter((b) => b.user_id !== blockedId),
      );
      return { prev };
    },
    onError: (err, _id, ctx) => {
      logger.error('Unblock user failed', err);
      if (ctx?.prev) queryClient.setQueryData(BLOCKED_USERS_KEY, ctx.prev);
      Alert.alert('Could not unblock user', 'Please try again.');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: BLOCKED_USERS_KEY });
    },
  });

  function handleUnblock(b: BlockedUser) {
    confirm({
      title: 'Unblock user?',
      message: `${b.display}'s messages will be visible again in chats you share.`,
      action: { label: 'Unblock', onPress: () => unblockMutation.mutate(b.user_id) },
    });
  }

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: c.background }]}
      edges={['top']}
    >
      <PageHeader title="Blocked Users" />
      <ScrollView contentContainerStyle={styles.content}>
        <ThemedText style={[styles.intro, { color: c.secondaryText }]}>
          Blocked users can't message you in DMs, and their messages and reactions are hidden in any league chat you share. They aren't notified.
        </ThemedText>

        {isLoading && (
          <View style={styles.loadingRow}>
            <LogoSpinner size={24} />
          </View>
        )}

        {!isLoading && blocks && blocks.length === 0 && (
          <Section title="No one blocked">
            <View style={styles.emptyRow}>
              <Ionicons
                name="checkmark-circle-outline"
                size={ms(20)}
                color={c.secondaryText}
                accessible={false}
              />
              <ThemedText style={[styles.emptyText, { color: c.secondaryText }]}>
                You haven't blocked anyone yet.
              </ThemedText>
            </View>
          </Section>
        )}

        {!isLoading && blocks && blocks.length > 0 && (
          <Section title={`Blocked (${blocks.length})`}>
            {blocks.map((b) => (
              <View
                key={b.user_id}
                style={[styles.row, { borderBottomColor: c.border }]}
              >
                <View style={{ flex: 1 }}>
                  <ThemedText style={{ fontSize: ms(15), fontWeight: '600' }}>
                    {b.display}
                  </ThemedText>
                  <ThemedText style={[styles.metaText, { color: c.secondaryText }]}>
                    Blocked {new Date(b.blocked_at).toLocaleDateString()}
                  </ThemedText>
                </View>
                <TouchableOpacity
                  onPress={() => handleUnblock(b)}
                  disabled={unblockMutation.isPending}
                  accessibilityRole="button"
                  accessibilityLabel={`Unblock ${b.display}`}
                  style={[styles.unblockButton, { borderColor: c.border }]}
                >
                  <ThemedText style={{ fontSize: ms(13), fontWeight: '600', color: c.accent }}>
                    Unblock
                  </ThemedText>
                </TouchableOpacity>
              </View>
            ))}
          </Section>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingHorizontal: s(16),
    paddingBottom: s(40),
    gap: s(12),
  },
  intro: {
    fontSize: ms(13),
    lineHeight: ms(18),
    paddingHorizontal: s(4),
    marginVertical: s(8),
  },
  loadingRow: {
    alignItems: 'center',
    paddingVertical: s(40),
  },
  emptyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(10),
    paddingHorizontal: s(12),
    paddingVertical: s(16),
  },
  emptyText: {
    fontSize: ms(14),
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(12),
    paddingVertical: s(12),
    paddingHorizontal: s(12),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  metaText: {
    fontSize: ms(11),
    marginTop: s(2),
  },
  unblockButton: {
    paddingHorizontal: s(12),
    paddingVertical: s(6),
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
