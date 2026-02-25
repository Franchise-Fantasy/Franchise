import { supabase } from '@/lib/supabase';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useAppState } from '@/context/AppStateProvider';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { ActivityIndicator, StyleSheet, TouchableOpacity, View } from 'react-native';
import { ThemedText } from '../ThemedText';

interface TeamStanding {
  id: string;
  name: string;
  wins: number;
  losses: number;
  ties: number;
  points_for: number;
  points_against: number;
  streak: string;
}

function streakColor(streak: string, c: any): string {
  if (streak.startsWith('W')) return '#2dc653';
  if (streak.startsWith('L')) return '#e03131';
  return c.secondaryText;
}

export function StandingsSection({ leagueId, playoffTeams }: { leagueId: string; playoffTeams?: number | null }) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const router = useRouter();
  const { teamId } = useAppState();

  const { data: standings, isLoading } = useQuery({
    queryKey: ['standings', leagueId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('teams')
        .select('id, name, wins, losses, ties, points_for, points_against, streak')
        .eq('league_id', leagueId)
        .order('wins', { ascending: false })
        .order('points_for', { ascending: false });

      if (error) throw error;
      return (data as TeamStanding[]).map((team, index) => ({
        ...team,
        rank: index + 1,
      }));
    },
    enabled: !!leagueId,
  });

  return (
    <View style={[styles.section, { backgroundColor: c.card, borderColor: c.border }]}>
      <ThemedText type="defaultSemiBold" style={styles.sectionTitle}>Standings</ThemedText>
      <View style={styles.standings}>
        {isLoading ? (
          <ActivityIndicator style={styles.loading} />
        ) : !standings?.length ? (
          <View style={styles.placeholder}>
            <ThemedText style={[styles.placeholderText, { color: c.secondaryText }]}>
              No standings available yet
            </ThemedText>
          </View>
        ) : (
          <>
            {/* Header row */}
            <View style={styles.headerRow}>
              <ThemedText style={[styles.rank, styles.headerText, { color: c.secondaryText }]}>#</ThemedText>
              <ThemedText style={[styles.teamName, styles.headerText, { color: c.secondaryText }]}>Team</ThemedText>
              <ThemedText style={[styles.record, styles.headerText, { color: c.secondaryText }]}>W-L-T</ThemedText>
              <ThemedText style={[styles.pf, styles.headerText, { color: c.secondaryText }]}>PF</ThemedText>
              <ThemedText style={[styles.pa, styles.headerText, { color: c.secondaryText }]}>PA</ThemedText>
              <ThemedText style={[styles.streakCol, styles.headerText, { color: c.secondaryText }]}>STK</ThemedText>
            </View>
            {standings.map((team) => (
              <View key={team.id}>
                {playoffTeams && team.rank === playoffTeams + 1 && (
                  <View style={styles.playoffCutoff}>
                    <View style={[styles.cutoffLine, { backgroundColor: c.secondaryText }]} />
                    <ThemedText style={[styles.cutoffLabel, { color: c.secondaryText }]}>
                      Playoff cutoff
                    </ThemedText>
                    <View style={[styles.cutoffLine, { backgroundColor: c.secondaryText }]} />
                  </View>
                )}
                <TouchableOpacity
                  style={[styles.standingRow, { borderBottomColor: c.border }]}
                  onPress={() => team.id === teamId ? router.push('/(tabs)/roster') : router.push(`/team-roster/${team.id}` as any)}
                  activeOpacity={0.6}
                >
                  <ThemedText style={[styles.rank, { color: c.secondaryText }]}>{team.rank}</ThemedText>
                  <ThemedText style={styles.teamName} numberOfLines={1}>{team.name}</ThemedText>
                  <ThemedText style={[styles.record, { color: c.secondaryText }]}>
                    {team.wins}-{team.losses}-{team.ties}
                  </ThemedText>
                  <ThemedText style={[styles.pf, { color: c.secondaryText }]}>
                    {Number(team.points_for).toFixed(1)}
                  </ThemedText>
                  <ThemedText style={[styles.pa, { color: c.secondaryText }]}>
                    {Number(team.points_against).toFixed(1)}
                  </ThemedText>
                  <ThemedText style={[styles.streakCol, { color: streakColor(team.streak, c) }]}>
                    {team.streak || '—'}
                  </ThemedText>
                </TouchableOpacity>
              </View>
            ))}
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 2,
    marginBottom: 16,
  },
  sectionTitle: {
    marginBottom: 8,
  },
  standings: { marginTop: 4 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(128,128,128,0.3)',
  },
  headerText: { fontSize: 10, fontWeight: '600' },
  standingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rank: { width: 24, fontSize: 12 },
  teamName: { flex: 1, fontSize: 13 },
  record: { width: 48, textAlign: 'center', fontSize: 12 },
  pf: { width: 44, textAlign: 'right', fontSize: 11 },
  pa: { width: 44, textAlign: 'right', fontSize: 11 },
  streakCol: { width: 30, textAlign: 'right', fontSize: 11, fontWeight: '600' },
  playoffCutoff: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    gap: 8,
  },
  cutoffLine: {
    flex: 1,
    height: 1,
    opacity: 0.4,
  },
  cutoffLabel: {
    fontSize: 9,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  placeholder: { padding: 20, alignItems: 'center' },
  placeholderText: { fontSize: 14 },
  loading: { marginTop: 16 },
});
