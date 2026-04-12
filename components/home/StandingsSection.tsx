import { supabase } from '@/lib/supabase';
import { Colors, cardShadow } from '@/constants/Colors';
import { queryKeys } from '@/constants/queryKeys';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useAppState } from '@/context/AppStateProvider';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { LogoSpinner } from '@/components/ui/LogoSpinner';
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
  home_score: number;
  away_score: number;
  home_category_wins?: number | null;
  away_category_wins?: number | null;
  week_number: number;
}

export type PlayoffStatus = 'clinched' | 'eliminated' | null;

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

  const winPct = (t: TeamStanding) => {
    const gp = t.wins + t.losses + t.ties;
    return gp === 0 ? 0 : (t.wins + t.ties * 0.5) / gp;
  };

  // Sort by win percentage DESC first
  const sorted = [...teams].sort((a, b) => winPct(b) - winPct(a));

  // Group teams by win percentage
  const groups: TeamStanding[][] = [];
  let currentGroup: TeamStanding[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    if (Math.abs(winPct(sorted[i]) - winPct(sorted[i - 1])) < 1e-9) {
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
 * Runs two simulations per team:
 * - Worst case: team loses all remaining, every other team wins all remaining.
 *   If team still finishes top N under current tiebreakers, they've clinched.
 * - Best case: team wins all remaining, every other team loses all remaining.
 *   If team still misses top N, they're eliminated.
 *
 * Sound but not tight — opponents can't all win/lose when they play each other,
 * so some late clinches may not light up until the math is unambiguous.
 */
export function computePlayoffStatuses(
  standings: (TeamStanding & { rank: number })[],
  remainingGames: Map<string, number>,
  playoffTeams: number,
  matchups: Matchup[],
  tiebreakerOrder: string[],
): Map<string, PlayoffStatus> {
  const statuses = new Map<string, PlayoffStatus>();
  const totalTeams = standings.length;
  if (playoffTeams <= 0 || playoffTeams >= totalTeams) return statuses;

  for (const team of standings) {
    const worstCase = standings.map(t => {
      const remaining = remainingGames.get(t.id) ?? 0;
      return t.id === team.id
        ? { ...t, losses: t.losses + remaining }
        : { ...t, wins: t.wins + remaining };
    });
    const worstRank = resolveStandings(worstCase, matchups, tiebreakerOrder)
      .find(t => t.id === team.id)?.rank ?? Infinity;
    if (worstRank <= playoffTeams) {
      statuses.set(team.id, 'clinched');
      continue;
    }

    const bestCase = standings.map(t => {
      const remaining = remainingGames.get(t.id) ?? 0;
      return t.id === team.id
        ? { ...t, wins: t.wins + remaining }
        : { ...t, losses: t.losses + remaining };
    });
    const bestRank = resolveStandings(bestCase, matchups, tiebreakerOrder)
      .find(t => t.id === team.id)?.rank ?? Infinity;
    if (bestRank > playoffTeams) {
      statuses.set(team.id, 'eliminated');
      continue;
    }

    statuses.set(team.id, null);
  }

  return statuses;
}

// Deterministic font size for team names. React Native's adjustsFontSizeToFit
// is unreliable across platforms, so we pick a size by character count.
function teamNameFontSize(name: string): number {
  const len = name.length;
  if (len <= 12) return ms(13);
  if (len <= 15) return ms(12);
  if (len <= 18) return ms(11);
  if (len <= 21) return ms(10);
  if (len <= 24) return ms(9);
  if (len <= 28) return ms(8);
  return ms(7);
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

  // Fetch finalized regular-season matchups (H2H tiebreaker + all-play cache for standings detail)
  const { data: matchups } = useQuery({
    queryKey: queryKeys.standingsH2h(leagueId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('league_matchups')
        .select('home_team_id, away_team_id, winner_team_id, home_score, away_score, home_category_wins, away_category_wins, category_results, week_number')
        .eq('league_id', leagueId)
        .eq('is_finalized', true)
        .is('playoff_round', null);

      if (error) throw error;
      return data as Matchup[];
    },
    enabled: !!leagueId,
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
        if (!m.away_team_id) continue;
        counts.set(m.home_team_id, (counts.get(m.home_team_id) ?? 0) + 1);
        counts.set(m.away_team_id, (counts.get(m.away_team_id) ?? 0) + 1);
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
    ? computePlayoffStatuses(allStandings, remainingGames, playoffTeams, matchups ?? [], tiebreakers)
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
        <ThemedText
          style={[styles.teamName, { fontSize: teamNameFontSize(team.name) }]}
          numberOfLines={1}
        >
          {team.name}
        </ThemedText>
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
    <View style={[styles.section, { backgroundColor: c.card, borderColor: c.border, ...cardShadow }]}>
      <TouchableOpacity
        style={styles.sectionHeader}
        onPress={() => router.push('/standings' as any)}
        activeOpacity={0.6}
        accessibilityRole="button"
        accessibilityLabel="View detailed standings"
      >
        <ThemedText type="defaultSemiBold" style={styles.sectionTitle}>Standings</ThemedText>
        <Ionicons name="chevron-forward" size={16} color={c.secondaryText} accessible={false} />
      </TouchableOpacity>
      <View style={styles.standings}>
        {isLoading ? (
          <View style={styles.loading}><LogoSpinner /></View>
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
        {!!playoffTeams && allStandings && (
          <ThemedText style={[styles.footnote, { color: c.secondaryText }]}>
            <ThemedText style={[styles.clinchBadge, { color: c.success }]}>x</ThemedText> = clinched{' · '}
            <ThemedText style={[styles.clinchBadge, { color: c.danger }]}>e</ThemedText> = eliminated
          </ThemedText>
        )}
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
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
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
  footnote: {
    fontSize: ms(10),
    fontStyle: 'italic',
    textAlign: 'center',
    paddingVertical: s(6),
  },
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
