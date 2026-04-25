import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, StyleSheet, TouchableOpacity, View } from 'react-native';

import { ThemedText } from '@/components/ui/ThemedText';
import { Colors, cardShadow } from '@/constants/Colors';
import { queryKeys } from '@/constants/queryKeys';
import { useColorScheme } from '@/hooks/useColorScheme';
import { capture } from '@/lib/posthog';
import { supabase } from '@/lib/supabase';
import { ms, s } from '@/utils/scale';

interface DeclareKeepersProps {
  leagueId: string;
  teamId: string;
  season: string;
  keeperCount: number;
  isCommissioner: boolean;
}

export function DeclareKeepers({ leagueId, teamId, season, keeperCount, isCommissioner }: DeclareKeepersProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const queryClient = useQueryClient();

  // Fetch my roster
  const { data: roster } = useQuery({
    queryKey: queryKeys.keeperRoster(leagueId, teamId),
    queryFn: async () => {
      const { data } = await supabase
        .from('league_players')
        .select('player_id, players(id, name, position)')
        .eq('league_id', leagueId)
        .eq('team_id', teamId);
      return (data ?? []).map((lp: any) => ({
        playerId: lp.player_id,
        name: lp.players?.name ?? '',
        position: lp.players?.position ?? '',
      }));
    },
  });

  // Fetch my declarations
  const { data: myDeclarations } = useQuery({
    queryKey: queryKeys.keeperDeclarations(leagueId, teamId, season as unknown as number),
    queryFn: async () => {
      const { data } = await supabase
        .from('keeper_declarations')
        .select('player_id')
        .eq('league_id', leagueId)
        .eq('team_id', teamId)
        .eq('season', season);
      return new Set((data ?? []).map((d: any) => d.player_id));
    },
  });

  // Commissioner: fetch all teams' declaration counts
  const { data: teamStatuses } = useQuery({
    queryKey: queryKeys.keeperDeclarations(leagueId, 'all', season as unknown as number),
    queryFn: async () => {
      const { data: teams } = await supabase
        .from('teams')
        .select('id, name')
        .eq('league_id', leagueId)
        .order('name');

      if (!teams) return [];

      const results: { name: string; count: number }[] = [];
      for (const team of teams) {
        const { count } = await supabase
          .from('keeper_declarations')
          .select('id', { count: 'exact', head: true })
          .eq('league_id', leagueId)
          .eq('team_id', team.id)
          .eq('season', season);
        results.push({ name: team.name, count: count ?? 0 });
      }
      return results;
    },
    enabled: isCommissioner,
  });

  const declaredSet = myDeclarations ?? new Set<string>();
  const declaredCount = declaredSet.size;

  // Toggle keeper declaration
  const toggleKeeper = useMutation({
    mutationFn: async (playerId: string) => {
      if (declaredSet.has(playerId)) {
        // Remove
        await supabase
          .from('keeper_declarations')
          .delete()
          .eq('league_id', leagueId)
          .eq('team_id', teamId)
          .eq('season', season)
          .eq('player_id', playerId);
      } else {
        if (declaredCount >= keeperCount) {
          throw new Error(`You can only keep ${keeperCount} players`);
        }
        // Add
        await supabase
          .from('keeper_declarations')
          .insert({ league_id: leagueId, team_id: teamId, season, player_id: playerId });
      }
    },
    onSuccess: (_data, playerId) => {
      queryClient.invalidateQueries({ queryKey: ['keeperDeclarations', leagueId] });
      capture('keeper_toggled', { action: declaredSet.has(playerId) ? 'removed' : 'declared' });
    },
    onError: (err: any) => {
      Alert.alert('Error', err.message ?? 'Failed to update keeper');
    },
  });

  return (
    <View style={styles.wrapper}>
      {/* My keeper selections */}
      <ThemedText accessibilityRole="header" type="defaultSemiBold" style={styles.sectionTitle}>
        Declare Keepers ({declaredCount}/{keeperCount})
      </ThemedText>

      {roster?.map((player) => {
        const isKept = declaredSet.has(player.playerId);
        return (
          <TouchableOpacity
            key={player.playerId}
            accessibilityRole="checkbox"
            accessibilityLabel={`${player.name}, ${player.position}`}
            accessibilityState={{ checked: isKept }}
            style={[styles.playerRow, { borderColor: c.border }, isKept && { backgroundColor: c.accent + '15' }]}
            onPress={() => toggleKeeper.mutate(player.playerId)}
          >
            <View style={styles.playerInfo}>
              <ThemedText style={styles.playerName}>{player.name}</ThemedText>
              <ThemedText style={[styles.playerPos, { color: c.secondaryText }]}>{player.position}</ThemedText>
            </View>
            <Ionicons
              name={isKept ? 'checkmark-circle' : 'ellipse-outline'}
              size={22}
              color={isKept ? c.accent : c.secondaryText}
            />
          </TouchableOpacity>
        );
      })}

      {(!roster || roster.length === 0) && (
        <ThemedText style={[styles.emptyText, { color: c.secondaryText }]}>No players on roster.</ThemedText>
      )}

      {/* Commissioner: team declaration status */}
      {isCommissioner && teamStatuses && (
        <View style={styles.commSection}>
          <ThemedText accessibilityRole="header" type="defaultSemiBold" style={styles.sectionTitle}>
            Team Status
          </ThemedText>
          {teamStatuses.map((t) => {
            const isDone = t.count >= keeperCount;
            return (
              <View key={t.name} style={styles.teamStatusRow}>
                <ThemedText style={{ fontSize: ms(13) }}>{t.name}</ThemedText>
                <ThemedText style={[styles.teamStatusCount, { color: isDone ? c.success : c.secondaryText }]}>
                  {t.count}/{keeperCount} {isDone ? '✓' : ''}
                </ThemedText>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    marginBottom: s(12),
    borderRadius: 12,
    ...cardShadow,
  },
  sectionTitle: {
    fontSize: ms(14),
    marginBottom: s(8),
  },
  playerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: s(10),
    paddingHorizontal: s(12),
    borderBottomWidth: 1,
    borderRadius: 6,
    marginBottom: s(2),
  },
  playerInfo: {
    flex: 1,
  },
  playerName: {
    fontSize: ms(14),
    fontWeight: '500',
  },
  playerPos: {
    fontSize: ms(12),
    marginTop: 1,
  },
  emptyText: {
    fontSize: ms(13),
    textAlign: 'center',
    paddingVertical: s(12),
  },
  commSection: {
    marginTop: s(16),
  },
  teamStatusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: s(4),
  },
  teamStatusCount: {
    fontSize: ms(13),
    fontWeight: '600',
  },
});
