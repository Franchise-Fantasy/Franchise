import { supabase } from '@/lib/supabase';
import { Colors } from '@/constants/Colors';
import { queryKeys } from '@/constants/queryKeys';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useAppState } from '@/context/AppStateProvider';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { ActivityIndicator, StyleSheet, TouchableOpacity, View } from 'react-native';
import { ms, s } from '@/utils/scale';
import { ThemedText } from '../ui/ThemedText';
import { TeamLogo } from '../team/TeamLogo';

interface TeamStanding {
  id: string;
  name: string;
  tricode: string | null;
  logo_key: string | null;
  wins: number;
  losses: number;
  ties: number;
  points_for: number;
  points_against: number;
  streak: string;
  division: number | null;
}

interface Matchup {
  home_team_id: string;
  away_team_id: string | null;
  winner_team_id: string | null;
}

type PlayoffStatus = 'clinched' | 'eliminated' | null;

/**
 * Resolve standings order using configurable tiebreaker rules.
 *
 * Primary sort is always wins DESC. When teams are tied on wins,
 * tiebreakers are applied in the order specified by tiebreakerOrder.
 */
function resolveStandings(
  teams: TeamStanding[],
  matchups: Matchup[],
  tiebreakerOrder: string[],
): (TeamStanding & { rank: number })[] {
  if (teams.length === 0) return [];

  // Sort by wins DESC first
  const sorted = [...teams].sort((a, b) => b.wins - a.wins);

  // Group teams by win count
  const groups: TeamStanding[][] = [];
  let currentGroup: TeamStanding[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].wins === sorted[i - 1].wins) {
      currentGroup.push(sorted[i]);
    } else {
      groups.push(currentGroup);
      currentGroup = [sorted[i]];
    }
  }
  groups.push(currentGroup);

  // Build H2H lookup: for each pair of team IDs, count wins
  const h2hWins = new Map<string, number>();
  const h2hKey = (a: string, b: string) => `${a}:${b}`;

  for (const m of matchups) {
    if (!m.away_team_id || !m.winner_team_id) continue;
    // Track wins for home vs away and away vs home
    h2hWins.set(h2hKey(m.winner_team_id, m.home_team_id === m.winner_team_id ? m.away_team_id : m.home_team_id),
      (h2hWins.get(h2hKey(m.winner_team_id, m.home_team_id === m.winner_team_id ? m.away_team_id : m.home_team_id)) ?? 0) + 1);
  }

  function getH2HWinsInGroup(teamId: string, group: TeamStanding[]): number {
    const groupIds = new Set(group.map(t => t.id));
    let wins = 0;
    for (const otherId of groupIds) {
      if (otherId === teamId) continue;
      wins += h2hWins.get(h2hKey(teamId, otherId)) ?? 0;
    }
    return wins;
  }

  function compareTiebreaker(a: TeamStanding, b: TeamStanding, group: TeamStanding[], method: string): number {
    switch (method) {
      case 'head_to_head':
        return getH2HWinsInGroup(b.id, group) - getH2HWinsInGroup(a.id, group);
      case 'points_for':
        return b.points_for - a.points_for;
      default:
        return 0;
    }
  }

  // Sort each tied group using tiebreakers
  const result: TeamStanding[] = [];
  for (const group of groups) {
    if (group.length === 1) {
      result.push(group[0]);
      continue;
    }

    group.sort((a, b) => {
      for (const method of tiebreakerOrder) {
        const cmp = compareTiebreaker(a, b, group, method);
        if (cmp !== 0) return cmp;
      }
      return 0;
    });
    result.push(...group);
  }

  return result.map((team, index) => ({ ...team, rank: index + 1 }));
}

/**
 * Compute playoff clinch/elimination status for each team.
 *
 * Clinched: even if team loses all remaining, not enough other teams can
 *   reach team's current win total → team must finish top N.
 * Eliminated: even if team wins all remaining, N or more teams are already
 *   guaranteed to finish above team → team cannot finish top N.
 */
function computePlayoffStatuses(
  standings: (TeamStanding & { rank: number })[],
  remainingGames: Map<string, number>,
  playoffTeams: number,
): Map<string, PlayoffStatus> {
  const statuses = new Map<string, PlayoffStatus>();
  const totalTeams = standings.length;
  if (playoffTeams <= 0 || playoffTeams >= totalTeams) return statuses;

  const maxWins = standings.map(t => t.wins + (remainingGames.get(t.id) ?? 0));

  for (let i = 0; i < standings.length; i++) {
    const team = standings[i];
    const teamMaxWins = maxWins[i];
    const teamCurrentWins = team.wins;

    // Clinched: count teams that are guaranteed to finish below this team.
    // A team is guaranteed below if its max possible wins < this team's current wins.
    const guaranteedBelow = standings.filter(
      (_, j) => j !== i && maxWins[j] < teamCurrentWins,
    ).length;
    if (guaranteedBelow >= totalTeams - playoffTeams) {
      statuses.set(team.id, 'clinched');
      continue;
    }

    // Eliminated: count teams guaranteed to finish above this team.
    // A team is guaranteed above if its current wins > this team's max possible wins.
    const guaranteedAbove = standings.filter(
      (other, j) => j !== i && other.wins > teamMaxWins,
    ).length;
    if (guaranteedAbove >= playoffTeams) {
      statuses.set(team.id, 'eliminated');
      continue;
    }

    statuses.set(team.id, null);
  }

  return statuses;
}

function streakColor(streak: string, c: any): string {
  if (streak.startsWith('W')) return c.success;
  if (streak.startsWith('L')) return c.danger;
  return c.secondaryText;
}

const DEFAULT_TIEBREAKER = ['head_to_head', 'points_for'];

interface StandingsProps {
  leagueId: string;
  playoffTeams?: number | null;
  scoringType?: string;
  tiebreakerOrder?: string[] | null;
  divisionCount?: number;
  division1Name?: string;
  division2Name?: string;
}

export function StandingsSection({ leagueId, playoffTeams, scoringType, tiebreakerOrder, divisionCount, division1Name, division2Name }: StandingsProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const router = useRouter();
  const { teamId } = useAppState();

  const tiebreakers = tiebreakerOrder ?? DEFAULT_TIEBREAKER;
  const needsH2H = tiebreakers.includes('head_to_head');
  const hasDivisions = divisionCount === 2;

  const { data: rawTeams, isLoading } = useQuery({
    queryKey: queryKeys.standings(leagueId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('teams')
        .select('id, name, tricode, logo_key, wins, losses, ties, points_for, points_against, streak, division')
        .eq('league_id', leagueId)
        .order('wins', { ascending: false })
        .order('points_for', { ascending: false });

      if (error) throw error;
      return data as unknown as TeamStanding[];
    },
    enabled: !!leagueId,
  });

  // Fetch finalized regular-season matchups for H2H tiebreaker
  const { data: matchups } = useQuery({
    queryKey: queryKeys.standingsH2h(leagueId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('league_matchups')
        .select('home_team_id, away_team_id, winner_team_id')
        .eq('league_id', leagueId)
        .eq('is_finalized', true)
        .is('playoff_round', null);

      if (error) throw error;
      return data as Matchup[];
    },
    enabled: !!leagueId && needsH2H,
  });

  // Fetch remaining regular-season matchups per team for clinch/elimination
  const { data: remainingGames } = useQuery({
    queryKey: queryKeys.remainingGames(leagueId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('league_matchups')
        .select('home_team_id, away_team_id')
        .eq('league_id', leagueId)
        .eq('is_finalized', false)
        .is('playoff_round', null);

      if (error) throw error;

      const counts = new Map<string, number>();
      for (const m of data) {
        counts.set(m.home_team_id, (counts.get(m.home_team_id) ?? 0) + 1);
        if (m.away_team_id) {
          counts.set(m.away_team_id, (counts.get(m.away_team_id) ?? 0) + 1);
        }
      }
      return counts;
    },
    enabled: !!leagueId && !!playoffTeams,
  });

  // Build standings — either split by division or league-wide
  const allStandings = rawTeams
    ? resolveStandings(rawTeams, matchups ?? [], tiebreakers)
    : undefined;

  const playoffStatuses = allStandings && remainingGames && playoffTeams
    ? computePlayoffStatuses(allStandings, remainingGames, playoffTeams)
    : null;

  const renderHeader = () => (
    <View style={styles.headerRow}>
      <ThemedText style={[styles.rank, styles.headerText, { color: c.secondaryText }]}>#</ThemedText>
      <View style={{ width: s(28) }} />
      <ThemedText style={[styles.teamNameCol, styles.headerText, { color: c.secondaryText }]}>Team</ThemedText>
      <ThemedText style={[styles.record, styles.headerText, { color: c.secondaryText }]}>W-L-T</ThemedText>
      <ThemedText style={[styles.pf, styles.headerText, { color: c.secondaryText }]}>{scoringType === 'h2h_categories' ? 'CW' : 'PF'}</ThemedText>
      <ThemedText style={[styles.pa, styles.headerText, { color: c.secondaryText }]}>{scoringType === 'h2h_categories' ? 'CL' : 'PA'}</ThemedText>
      <ThemedText style={[styles.streakCol, styles.headerText, { color: c.secondaryText }]}>STK</ThemedText>
    </View>
  );

  const renderTeamRow = (team: TeamStanding & { rank: number }, idx: number, total: number) => (
    <TouchableOpacity
      key={team.id}
      style={[styles.standingRow, { borderBottomColor: c.border }, idx === total - 1 && { borderBottomWidth: 0 }]}
      onPress={() => team.id === teamId ? router.push('/(tabs)/roster') : router.push(`/team-roster/${team.id}` as any)}
      activeOpacity={0.6}
      accessibilityLabel={`${team.name}, rank ${team.rank}, record ${team.wins}-${team.losses}-${team.ties}`}
    >
      <ThemedText style={[styles.rank, { color: c.secondaryText }]}>{team.rank}</ThemedText>
      <TeamLogo logoKey={team.logo_key} teamName={team.name} tricode={team.tricode ?? undefined} size="small" />
      <View style={styles.teamNameCol}>
        <ThemedText style={styles.teamName} numberOfLines={1}>{team.name}</ThemedText>
        {playoffStatuses?.get(team.id) === 'clinched' && (
          <ThemedText style={[styles.clinchBadge, { color: c.success }]} accessibilityLabel="Clinched playoff spot">x</ThemedText>
        )}
        {playoffStatuses?.get(team.id) === 'eliminated' && (
          <ThemedText style={[styles.clinchBadge, { color: c.danger }]} accessibilityLabel="Eliminated from playoffs">e</ThemedText>
        )}
      </View>
      <ThemedText style={[styles.record, { color: c.secondaryText }]}>
        {team.wins}-{team.losses}-{team.ties}
      </ThemedText>
      <ThemedText style={[styles.pf, { color: c.secondaryText }]}>
        {scoringType === 'h2h_categories' ? Math.round(Number(team.points_for)) : Number(team.points_for).toFixed(1)}
      </ThemedText>
      <ThemedText style={[styles.pa, { color: c.secondaryText }]}>
        {scoringType === 'h2h_categories' ? Math.round(Number(team.points_against)) : Number(team.points_against).toFixed(1)}
      </ThemedText>
      <ThemedText style={[styles.streakCol, { color: streakColor(team.streak, c) }]}>
        {team.streak || '—'}
      </ThemedText>
    </TouchableOpacity>
  );

  const renderDivisionBlock = (divisionTeams: TeamStanding[], divisionName: string) => {
    const divStandings = resolveStandings(divisionTeams, matchups ?? [], tiebreakers);
    return (
      <View key={divisionName} style={styles.divisionBlock}>
        <ThemedText style={[styles.divisionHeader, { color: c.secondaryText }]} accessibilityRole="header">
          {divisionName}
        </ThemedText>
        {renderHeader()}
        {divStandings.map((team, idx) => renderTeamRow(team, idx, divStandings.length))}
      </View>
    );
  };

  // Split teams by division
  const div1Teams = rawTeams?.filter(t => t.division === 1) ?? [];
  const div2Teams = rawTeams?.filter(t => t.division === 2) ?? [];

  return (
    <View style={[styles.section, { backgroundColor: c.card, borderColor: c.border }]}>
      <ThemedText type="defaultSemiBold" style={styles.sectionTitle}>Standings</ThemedText>
      <View style={styles.standings}>
        {isLoading ? (
          <ActivityIndicator style={styles.loading} />
        ) : !rawTeams?.length ? (
          <View style={styles.placeholder}>
            <ThemedText style={[styles.placeholderText, { color: c.secondaryText }]}>
              No standings available yet
            </ThemedText>
          </View>
        ) : hasDivisions && div1Teams.length > 0 && div2Teams.length > 0 ? (
          <>
            {renderDivisionBlock(div1Teams, division1Name ?? 'Division 1')}
            {renderDivisionBlock(div2Teams, division2Name ?? 'Division 2')}
          </>
        ) : allStandings ? (
          <>
            {renderHeader()}
            {allStandings.map((team, idx) => (
              <View key={team.id}>
                {!!playoffTeams && team.rank === playoffTeams + 1 && (
                  <View style={styles.playoffCutoff}>
                    <View style={[styles.cutoffLine, { backgroundColor: c.secondaryText }]} />
                    <ThemedText style={[styles.cutoffLabel, { color: c.secondaryText }]}>
                      Playoff cutoff
                    </ThemedText>
                    <View style={[styles.cutoffLine, { backgroundColor: c.secondaryText }]} />
                  </View>
                )}
                {renderTeamRow(team, idx, allStandings.length)}
              </View>
            ))}
          </>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: s(16),
    paddingTop: s(14),
    paddingBottom: s(2),
    marginBottom: s(16),
  },
  sectionTitle: {
    marginBottom: s(8),
  },
  standings: { marginTop: s(4) },
  divisionBlock: {
    marginBottom: s(12),
  },
  divisionHeader: {
    fontSize: ms(12),
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: s(4),
    marginTop: s(4),
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: s(4),
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(128,128,128,0.3)',
  },
  headerText: { fontSize: ms(10), fontWeight: '600' },
  standingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: s(8),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rank: { width: s(24), fontSize: ms(12) },
  teamNameCol: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: s(6), marginLeft: s(8) },
  teamName: { flexShrink: 1, fontSize: ms(13) },
  clinchBadge: { fontSize: ms(10), fontWeight: '700', fontStyle: 'italic' },
  record: { width: s(48), textAlign: 'center', fontSize: ms(12) },
  pf: { width: s(44), textAlign: 'right', fontSize: ms(11) },
  pa: { width: s(44), textAlign: 'right', fontSize: ms(11) },
  streakCol: { width: s(30), textAlign: 'right', fontSize: ms(11), fontWeight: '600' },
  playoffCutoff: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: s(6),
    gap: s(8),
  },
  cutoffLine: {
    flex: 1,
    height: 1,
    opacity: 0.4,
  },
  cutoffLabel: {
    fontSize: ms(9),
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  placeholder: { padding: s(20), alignItems: 'center' },
  placeholderText: { fontSize: ms(14) },
  loading: { marginTop: s(16) },
});
