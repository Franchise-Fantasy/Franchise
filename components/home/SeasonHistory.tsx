import { ThemedText } from '@/components/ui/ThemedText';
import { Colors } from '@/constants/Colors';
import { queryKeys } from '@/constants/queryKeys';
import { useColorScheme } from '@/hooks/useColorScheme';
import { supabase } from '@/lib/supabase';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { StyleSheet, View } from 'react-native';
import { ms, s } from '@/utils/scale';

interface SeasonHistoryProps {
  leagueId: string;
}

interface TeamSeason {
  id: string;
  team_id: string;
  season: string;
  wins: number;
  losses: number;
  ties: number;
  points_for: number;
  final_standing: number;
  playoff_result: string;
  team: { name: string };
}

const RESULT_LABELS: Record<string, string> = {
  champion: 'Champion',
  runner_up: 'Runner-Up',
  missed_playoffs: 'Missed Playoffs',
  playoff_participant: 'Playoffs',
};

function resultLabel(result: string): string {
  if (RESULT_LABELS[result]) return RESULT_LABELS[result];
  if (result.startsWith('eliminated_round_')) {
    const round = result.replace('eliminated_round_', '');
    return `Elim. Rd ${round}`;
  }
  return result;
}

export function SeasonHistory({ leagueId }: SeasonHistoryProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  const { data: history } = useQuery({
    queryKey: queryKeys.seasonHistory(leagueId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('team_seasons')
        .select('id, team_id, season, wins, losses, ties, points_for, final_standing, playoff_result, team:teams!team_seasons_team_id_fkey(name)')
        .eq('league_id', leagueId)
        .order('season', { ascending: false })
        .order('final_standing', { ascending: true });
      if (error) throw error;
      return data as unknown as TeamSeason[];
    },
    enabled: !!leagueId,
  });

  if (!history || history.length === 0) return null;

  // Group by season
  const seasons = new Map<string, TeamSeason[]>();
  for (const row of history) {
    if (!seasons.has(row.season)) seasons.set(row.season, []);
    seasons.get(row.season)!.push(row);
  }

  return (
    <View style={[styles.container, { backgroundColor: c.card, borderColor: c.border }]}>
      <ThemedText type="defaultSemiBold" style={styles.title}>Season History</ThemedText>

      {[...seasons.entries()].map(([season, teams]) => {
        const champ = teams.find(t => t.playoff_result === 'champion');
        return (
          <View key={season} style={[styles.seasonBlock, { borderTopColor: c.border }]}>
            <View style={styles.seasonHeader}>
              <ThemedText type="defaultSemiBold" style={{ fontSize: ms(14) }}>{season}</ThemedText>
              {champ && (
                <View style={styles.champRow}>
                  <Ionicons name="trophy" size={14} color={c.gold} />
                  <ThemedText style={[styles.champText, { color: c.secondaryText }]}>
                    {champ.team?.name}
                  </ThemedText>
                </View>
              )}
            </View>
            {teams.map((t, idx) => (
              <View key={t.id} style={[styles.teamRow, idx < teams.length - 1 && { borderBottomColor: c.border, borderBottomWidth: StyleSheet.hairlineWidth }]}>
                <ThemedText style={[styles.standing, { color: c.secondaryText }]}>
                  {t.final_standing}.
                </ThemedText>
                <ThemedText style={styles.teamName} numberOfLines={1}>
                  {t.team?.name}
                </ThemedText>
                <ThemedText style={[styles.record, { color: c.secondaryText }]}>
                  {t.wins}-{t.losses}{t.ties > 0 ? `-${t.ties}` : ''}
                </ThemedText>
                <View style={[
                  styles.resultBadge,
                  t.playoff_result === 'champion' && { backgroundColor: c.goldMuted },
                  t.playoff_result === 'runner_up' && { backgroundColor: c.activeCard },
                ]}>
                  <ThemedText style={[styles.resultText, { color: c.secondaryText }]}>
                    {resultLabel(t.playoff_result)}
                  </ThemedText>
                </View>
              </View>
            ))}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 12,
    borderWidth: 1,
    padding: s(16),
    marginBottom: s(16),
  },
  title: {
    fontSize: ms(16),
    marginBottom: s(8),
  },
  seasonBlock: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: s(10),
    marginTop: s(8),
  },
  seasonHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: s(8),
  },
  champRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(4),
  },
  champText: {
    fontSize: ms(12),
  },
  teamRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: s(6),
    gap: s(8),
  },
  standing: {
    width: s(20),
    fontSize: ms(12),
    textAlign: 'right',
  },
  teamName: {
    flex: 1,
    fontSize: ms(13),
  },
  record: {
    fontSize: ms(12),
    width: s(50),
    textAlign: 'right',
  },
  resultBadge: {
    paddingHorizontal: s(6),
    paddingVertical: s(2),
    borderRadius: 4,
    minWidth: s(60),
    alignItems: 'center',
  },
  resultText: {
    fontSize: ms(10),
    fontWeight: '600',
  },
});
