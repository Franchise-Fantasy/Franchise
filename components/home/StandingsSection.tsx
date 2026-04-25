import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { StyleSheet, TouchableOpacity, View } from 'react-native';

import { LogoSpinner } from '@/components/ui/LogoSpinner';
import { Colors, cardShadow } from '@/constants/Colors';
import { queryKeys } from '@/constants/queryKeys';
import { useAppState } from '@/context/AppStateProvider';
import { useColorScheme } from '@/hooks/useColorScheme';
import { supabase } from '@/lib/supabase';
import { ms, s } from '@/utils/scale';

import { TeamLogo } from '../team/TeamLogo';
import { ThemedText } from '../ui/ThemedText';

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

  // Only show the T column when at least one team has tied — most leagues
  // never do, and "W-L-T" takes 20% more horizontal space than "W-L".
  const anyTies = (rawTeams ?? []).some((t) => (t.ties ?? 0) > 0);
  const isCategories = scoringType === 'h2h_categories';

  const renderHeader = () => (
    <View style={[styles.headerRow, { borderBottomColor: c.border }]}>
      <ThemedText type="varsitySmall" style={[styles.rank, { color: c.secondaryText }]}>#</ThemedText>
      <View style={{ width: s(26) }} />
      <ThemedText type="varsitySmall" style={[styles.teamNameCol, { color: c.secondaryText }]}>
        Team
      </ThemedText>
      <ThemedText
        type="varsitySmall"
        style={[styles.recordHeader, { color: c.secondaryText }]}
      >
        {anyTies ? 'W-L-T' : 'W-L'}
      </ThemedText>
      <ThemedText type="varsitySmall" style={[styles.pf, { color: c.secondaryText }]}>
        {isCategories ? 'CW' : 'PF'}
      </ThemedText>
      <ThemedText type="varsitySmall" style={[styles.pa, { color: c.secondaryText }]}>
        {isCategories ? 'CL' : 'PA'}
      </ThemedText>
    </View>
  );

  const renderTeamRow = (team: TeamStanding & { rank: number }, idx: number, total: number) => {
    const isMe = team.id === teamId;
    const status = playoffStatuses?.get(team.id);
    const hasStreak = !!team.streak && team.streak !== 'W0' && team.streak !== 'L0';
    const streakDir = team.streak?.[0]; // 'W' | 'L' | undefined
    // Streaks of 5+ get a full colored ring on top of the tint, making
    // hot/cold runs pop visually without adding a dedicated column.
    const streakLen = hasStreak ? Number(team.streak.slice(1)) || 0 : 0;
    const isBigStreak = streakLen >= 5;
    const record = anyTies
      ? `${team.wins}-${team.losses}-${team.ties}`
      : `${team.wins}-${team.losses}`;
    return (
      <TouchableOpacity
        key={team.id}
        style={[
          styles.standingRow,
          { borderBottomColor: c.border },
          idx === total - 1 && { borderBottomWidth: 0 },
          isMe && { backgroundColor: c.activeCard },
        ]}
        onPress={() => isMe ? router.push('/(tabs)/roster') : router.push(`/team-roster/${team.id}` as any)}
        activeOpacity={0.6}
        accessibilityLabel={`${team.name}, rank ${team.rank}, record ${team.wins}-${team.losses}-${team.ties}, streak ${team.streak || 'none'}`}
      >
        <ThemedText type="mono" style={[styles.rank, { color: c.secondaryText }]}>{team.rank}</ThemedText>
        <TeamLogo logoKey={team.logo_key} teamName={team.name} tricode={team.tricode ?? undefined} size="small" />
        <View style={styles.teamNameCol}>
          <ThemedText
            style={[styles.teamName, { color: c.text }]}
            numberOfLines={1}
            ellipsizeMode="tail"
          >
            {team.name}
          </ThemedText>
          {status === 'clinched' && (
            <ThemedText type="varsitySmall" style={[styles.clinchBadge, { color: c.success }]} accessibilityLabel="Clinched playoff spot">x</ThemedText>
          )}
          {status === 'eliminated' && (
            <ThemedText type="varsitySmall" style={[styles.clinchBadge, { color: c.danger }]} accessibilityLabel="Eliminated from playoffs">e</ThemedText>
          )}
        </View>
        {/* Record cell with a subtle background tint that encodes current
            streak direction. Winning → success-muted, losing → danger-muted,
            neutral → none. Streaks of 5+ earn a full-color ring on top
            of the tint so the hot/cold stretches stand out from the
            normal W-streaks. Tint + border tokens flip sensibly in
            light/dark themes. */}
        <View
          style={[
            styles.recordCell,
            hasStreak && streakDir === 'W' && { backgroundColor: c.successMuted },
            hasStreak && streakDir === 'L' && { backgroundColor: c.dangerMuted },
            isBigStreak && streakDir === 'W' && { borderColor: c.success },
            isBigStreak && streakDir === 'L' && { borderColor: c.danger },
          ]}
        >
          <ThemedText type="mono" style={[styles.record, { color: c.text }]}>
            {record}
          </ThemedText>
        </View>
        <ThemedText type="mono" style={[styles.pf, { color: c.secondaryText }]}>
          {Math.round(Number(team.points_for))}
        </ThemedText>
        <ThemedText type="mono" style={[styles.pa, { color: c.secondaryText }]}>
          {Math.round(Number(team.points_against))}
        </ThemedText>
      </TouchableOpacity>
    );
  };

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
    <View style={styles.wrap}>
      <View style={styles.labelRow}>
        <View style={[styles.labelRule, { backgroundColor: c.gold }]} />
        <ThemedText type="sectionLabel" style={[styles.labelText, { color: c.text }]}>
          Standings
        </ThemedText>
      </View>
      <View style={[styles.section, { backgroundColor: c.card, borderColor: c.border, ...cardShadow }]}>
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
                      <View style={[styles.cutoffLine, { backgroundColor: c.border }]} />
                      <ThemedText
                        type="varsitySmall"
                        style={[styles.cutoffLabel, { color: c.secondaryText }]}
                      >
                        Playoff Cutoff
                      </ThemedText>
                      <View style={[styles.cutoffLine, { backgroundColor: c.border }]} />
                    </View>
                  )}
                  {renderTeamRow(team, idx, allStandings.length)}
                </View>
              ))}
            </>
          ) : null}
        </View>

        {!!rawTeams?.length && (
          <View style={[styles.footer, { borderTopColor: c.border }]}>
            {!!playoffTeams && allStandings ? (
              <ThemedText type="varsitySmall" style={[styles.footnote, { color: c.secondaryText }]}>
                <ThemedText type="varsitySmall" style={{ color: c.success }}>x</ThemedText>
                {' '}Clinched · <ThemedText type="varsitySmall" style={{ color: c.danger }}>e</ThemedText>
                {' '}Eliminated
              </ThemedText>
            ) : (
              <View />
            )}
            <TouchableOpacity
              style={styles.seeAll}
              onPress={() => router.push('/standings' as any)}
              accessibilityRole="button"
              accessibilityLabel="View detailed standings"
              hitSlop={8}
            >
              <ThemedText type="varsitySmall" style={[styles.seeAllText, { color: c.secondaryText }]}>
                See All
              </ThemedText>
              <Ionicons name="chevron-forward" size={12} color={c.secondaryText} accessible={false} />
            </TouchableOpacity>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginBottom: s(4),
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: s(10),
    gap: s(10),
  },
  labelRule: {
    height: 2,
    width: s(18),
  },
  labelText: {},
  // Card drops its horizontal padding so the isMe row background wraps
  // all the way to the card's left/right borders. Header/row/footer
  // each supply their own s(14) internal padding to keep content inset.
  section: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 0,
    paddingTop: s(10),
    paddingBottom: s(0),
    marginBottom: s(16),
    overflow: 'hidden',
  },
  standings: {},
  divisionBlock: {
    marginBottom: s(8),
  },
  divisionHeader: {
    fontSize: ms(10),
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    fontWeight: '700',
    marginTop: s(8),
    marginBottom: s(2),
    paddingHorizontal: s(14),
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: s(6),
    paddingHorizontal: s(14),
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(128,128,128,0.22)',
  },
  // Row spans full card width since the card has no horizontal padding.
  // Internal s(14) padding keeps column content inset so it aligns with
  // the header, while the isMe background reaches the card's edges.
  standingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: s(9),
    paddingHorizontal: s(14),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  // Left: rank (mono), logo sits via TeamLogo w/ natural width, then name col.
  // Left-aligned so the digit hugs the card's left padding, mirroring how
  // PA right-aligns against the card's right padding — balanced margins.
  rank: {
    width: s(18),
    fontSize: ms(12),
    textAlign: 'left',
  },
  // Team name owns all remaining width — flex: 1 + ellipsis, no more
  // variable-size-by-length hacks.
  teamNameCol: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(6),
    marginLeft: s(8),
    minWidth: 0, // lets flex children shrink inside a row in RN
  },
  teamName: {
    flexShrink: 1,
    fontSize: ms(13),
    fontWeight: '500',
  },
  clinchBadge: {
    fontSize: ms(9),
  },
  // Record cell — a single-line pill that picks up a streak-colored tint
  // behind the W-L number. Transparent border reserved so a streak >= 5
  // ring can flip colored without shifting pill size (keeps rows aligned
  // whether one team has a 5-game streak or every team's record is flat).
  recordCell: {
    width: s(46),
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: s(3),
    borderRadius: 4,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  recordHeader: {
    width: s(46),
    textAlign: 'center',
  },
  record: {
    fontSize: ms(12),
  },
  // PF / PA — whole-number rounded. A full dynasty season can accumulate
  // 5-digit totals (e.g. 12456), so columns need to fit that without
  // clipping on small phones. s(40) at mono ms(11) covers 5 chars cleanly.
  pf: {
    width: s(40),
    textAlign: 'right',
    fontSize: ms(11),
  },
  pa: {
    width: s(40),
    textAlign: 'right',
    fontSize: ms(11),
  },
  playoffCutoff: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: s(5),
    paddingHorizontal: s(14),
    gap: s(8),
  },
  cutoffLine: {
    flex: 1,
    height: 1,
  },
  cutoffLabel: {
    fontSize: ms(9),
  },
  // Footer holds the clinched/eliminated legend + See All tap target.
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: s(14),
    paddingVertical: s(10),
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: s(4),
  },
  footnote: {
    fontSize: ms(10),
  },
  seeAll: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(3),
  },
  seeAllText: {
    fontSize: ms(10),
  },
  placeholder: { padding: s(20), alignItems: 'center' },
  placeholderText: { fontSize: ms(14) },
  loading: { marginVertical: s(16) },
});
