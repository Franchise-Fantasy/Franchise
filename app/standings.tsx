import { TeamLogo } from '@/components/team/TeamLogo';
import { LogoSpinner } from '@/components/ui/LogoSpinner';
import { PageHeader } from '@/components/ui/PageHeader';
import { ThemedText } from '@/components/ui/ThemedText';
import { Colors, cardShadow } from '@/constants/Colors';
import { queryKeys } from '@/constants/queryKeys';
import { useAppState } from '@/context/AppStateProvider';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useLeague } from '@/hooks/useLeague';
import { useLeagueRosterStats } from '@/hooks/useLeagueRosterStats';
import { useLeagueScoring } from '@/hooks/useLeagueScoring';
import { supabase } from '@/lib/supabase';
import { ms, s } from '@/utils/scale';
import {
  computeAllPlayRecords,
  type AllPlayResult,
  type MatchupRow,
  type ScoringCategory,
} from '@/utils/allPlayRecord';
import { computeDependencyRisk, computeDependencyThresholds, type DependencyResult } from '@/utils/dependencyRisk';
import { computePlayoffStatuses } from '@/components/home/StandingsSection';
import { computeStrengthOfSchedule, type SoSResult } from '@/utils/strengthOfSchedule';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

// ─── Types ───────────────────────────────────────────────────────────────────

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

// Deterministic font size for the team name column. React Native's
// `adjustsFontSizeToFit` is unreliable across platforms and produces
// inconsistent sizing between rows, so we pick a size by character count.
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

// ─── Standings resolution (shared with StandingsSection) ─────────────────────

function resolveStandings(
  teams: TeamStanding[],
  matchups: MatchupRow[],
  tiebreakerOrder: string[],
): (TeamStanding & { rank: number })[] {
  if (teams.length === 0) return [];

  const winPct = (t: TeamStanding) => {
    const gp = t.wins + t.losses + t.ties;
    return gp === 0 ? 0 : (t.wins + t.ties * 0.5) / gp;
  };

  const sorted = [...teams].sort((a, b) => winPct(b) - winPct(a));

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

  // H2H lookup
  const h2hWins = new Map<string, number>();
  const h2hKey = (a: string, b: string) => `${a}:${b}`;

  for (const m of matchups) {
    if (!m.away_team_id || !m.winner_team_id) continue;
    const loserId = m.home_team_id === m.winner_team_id ? m.away_team_id : m.home_team_id;
    h2hWins.set(
      h2hKey(m.winner_team_id, loserId),
      (h2hWins.get(h2hKey(m.winner_team_id, loserId)) ?? 0) + 1,
    );
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

// ─── Component ───────────────────────────────────────────────────────────────

const DEFAULT_TIEBREAKER = ['head_to_head', 'points_for'];

export default function StandingsScreen() {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const isDark = scheme === 'dark';
  const router = useRouter();
  const { leagueId, teamId } = useAppState();

  const { data: league } = useLeague();
  const scoringType = league?.scoring_type;
  const isCategories = scoringType === 'h2h_categories';
  const playoffTeams = league?.playoff_teams;
  const tiebreakers = league?.tiebreaker_order ?? DEFAULT_TIEBREAKER;
  const hasDivisions = league?.division_count === 2;

  // ─── Data fetching ───────────────────────────────────────────────────

  const { data: rawTeams, isLoading: loadingTeams } = useQuery({
    queryKey: queryKeys.standings(leagueId!),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('teams')
        .select('id, name, tricode, logo_key, wins, losses, ties, points_for, points_against, streak, division')
        .eq('league_id', leagueId!)
        .order('wins', { ascending: false })
        .order('points_for', { ascending: false });
      if (error) throw error;
      return data as unknown as TeamStanding[];
    },
    enabled: !!leagueId,
  });

  const { data: matchups, isLoading: loadingMatchups } = useQuery({
    queryKey: queryKeys.standingsH2h(leagueId!),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('league_matchups')
        .select('home_team_id, away_team_id, winner_team_id, home_score, away_score, home_category_wins, away_category_wins, category_results, week_number')
        .eq('league_id', leagueId!)
        .eq('is_finalized', true)
        .is('playoff_round', null);
      if (error) throw error;
      return data as MatchupRow[];
    },
    enabled: !!leagueId,
  });

  // Unfinalized regular-season matchups for future SoS
  const { data: futureMatchups } = useQuery({
    queryKey: queryKeys.futureMatchups(leagueId!),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('league_matchups')
        .select('home_team_id, away_team_id')
        .eq('league_id', leagueId!)
        .eq('is_finalized', false)
        .is('playoff_round', null);
      if (error) throw error;
      return data as { home_team_id: string; away_team_id: string | null }[];
    },
    enabled: !!leagueId,
  });

  // Compute remaining games per team from futureMatchups (for clinch/elimination)
  const remainingGames = useMemo(() => {
    if (!futureMatchups) return undefined;
    const counts = new Map<string, number>();
    for (const m of futureMatchups) {
      if (!m.away_team_id) continue;
      counts.set(m.home_team_id, (counts.get(m.home_team_id) ?? 0) + 1);
      counts.set(m.away_team_id, (counts.get(m.away_team_id) ?? 0) + 1);
    }
    return counts;
  }, [futureMatchups]);

  // Roster stats + scoring weights for dependency risk
  const { data: allPlayers } = useLeagueRosterStats(leagueId!);
  const { data: scoringWeights } = useLeagueScoring(leagueId!);

  // ─── Computed data ───────────────────────────────────────────────────

  const allStandings = useMemo(
    () => rawTeams ? resolveStandings(rawTeams, matchups ?? [], tiebreakers) : undefined,
    [rawTeams, matchups, tiebreakers],
  );

  const playoffStatuses = useMemo(() => {
    if (!allStandings || !remainingGames || !playoffTeams) return null;
    return computePlayoffStatuses(allStandings, remainingGames, playoffTeams, matchups ?? [], tiebreakers);
  }, [allStandings, remainingGames, playoffTeams, matchups, tiebreakers]);

  // Build scoring categories for all-play category simulation
  const scoringCategories: ScoringCategory[] | undefined = useMemo(() => {
    if (!isCategories || !scoringWeights?.length) return undefined;
    return scoringWeights.map((w) => ({ stat_name: w.stat_name, inverse: w.inverse }));
  }, [isCategories, scoringWeights]);

  const allPlayResults = useMemo(() => {
    if (!matchups?.length || !rawTeams?.length) return null;
    return computeAllPlayRecords(matchups, rawTeams, scoringType, scoringCategories);
  }, [matchups, rawTeams, scoringType, scoringCategories]);

  const allPlayMap = useMemo(() => {
    if (!allPlayResults) return new Map<string, AllPlayResult>();
    const map = new Map<string, AllPlayResult>();
    for (const r of allPlayResults) map.set(r.teamId, r);
    return map;
  }, [allPlayResults]);

  // All-play sorted by win% for the "true power ranking"
  const allPlayRanked = useMemo(
    () => allPlayResults ? [...allPlayResults].sort((a, b) => b.allPlayWinPct - a.allPlayWinPct) : [],
    [allPlayResults],
  );

  // Luck sorted for the overview bar chart
  const luckSorted = useMemo(
    () => allPlayResults ? [...allPlayResults].sort((a, b) => b.luckIndex - a.luckIndex) : [],
    [allPlayResults],
  );

  const maxAbsLuck = useMemo(
    () => luckSorted.length ? Math.max(...luckSorted.map(r => Math.abs(r.luckIndex)), 1) : 1,
    [luckSorted],
  );

  // Dependency Risk
  const depResults = useMemo(() => {
    if (!allPlayers?.length || !scoringWeights?.length) return [];
    return computeDependencyRisk(allPlayers, scoringWeights, scoringType);
  }, [allPlayers, scoringWeights, scoringType]);

  const depSorted = useMemo(
    () => [...depResults].sort((a, b) => b.topThreePct - a.topThreePct),
    [depResults],
  );

  const depThresholds = useMemo(
    () => computeDependencyThresholds(depResults),
    [depResults],
  );

  const depMap = useMemo(() => {
    const map = new Map<string, DependencyResult>();
    for (const r of depResults) map.set(r.teamId, r);
    return map;
  }, [depResults]);

  // Strength of Schedule
  const sosResults = useMemo(() => {
    if (!rawTeams?.length) return [];
    return computeStrengthOfSchedule(
      matchups ?? [],
      futureMatchups ?? [],
      rawTeams,
    );
  }, [matchups, futureMatchups, rawTeams]);

  const sosSorted = useMemo(
    () => [...sosResults].sort((a, b) => b.pastSoS - a.pastSoS),
    [sosResults],
  );

  const leagueAvgSoS = useMemo(() => {
    if (!sosResults.length) return 0;
    const sum = sosResults.reduce((acc, r) => acc + r.pastSoS, 0);
    return sum / sosResults.length;
  }, [sosResults]);

  const hasFutureSoS = sosResults.some(r => r.futureSoS !== null);

  const sosMap = useMemo(() => {
    const map = new Map<string, SoSResult>();
    for (const r of sosResults) map.set(r.teamId, r);
    return map;
  }, [sosResults]);

  // UI state
  const [expandedWeek, setExpandedWeek] = useState<number | null>(null);
  const [expandedSection, setExpandedSection] = useState<string | null>(null);
  const [infoModal, setInfoModal] = useState<'luck' | 'allplay' | 'dependency' | 'sos' | null>(null);
  const myAllPlay = teamId ? allPlayMap.get(teamId) : null;
  const myDep = teamId ? depMap.get(teamId) : null;
  const mySoS = teamId ? sosMap.get(teamId) : null;

  // Team name lookup
  const teamNameMap = useMemo(() => {
    const map = new Map<string, TeamStanding>();
    for (const t of rawTeams ?? []) map.set(t.id, t);
    return map;
  }, [rawTeams]);

  const isLoading = loadingTeams || loadingMatchups;

  // ─── Render helpers ──────────────────────────────────────────────────

  function streakColor(streak: string): string {
    if (streak.startsWith('W')) return c.success;
    if (streak.startsWith('L')) return c.danger;
    return c.secondaryText;
  }

  const handleTeamPress = (id: string) => {
    if (id === teamId) router.push('/(tabs)/roster');
    else router.push(`/team-roster/${id}` as any);
  };

  const renderTeamRow = (
    team: TeamStanding & { rank: number },
    isLast: boolean,
    leader?: TeamStanding,
  ) => {
    const isMe = team.id === teamId;
    const gb = leader
      ? ((leader.wins - team.wins) + (team.losses - leader.losses)) / 2
      : 0;
    return (
      <TouchableOpacity
        key={team.id}
        style={[
          styles.standingRow,
          { borderBottomColor: c.border },
          isLast && { borderBottomWidth: 0 },
          isMe && { backgroundColor: isDark ? 'rgba(96,165,250,0.06)' : 'rgba(96,165,250,0.04)' },
        ]}
        onPress={() => handleTeamPress(team.id)}
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
        <ThemedText style={[styles.stat, { color: c.secondaryText }]}>
          {isCategories ? Math.round(Number(team.points_for)) : Number(team.points_for).toFixed(1)}
        </ThemedText>
        <ThemedText style={[styles.stat, { color: c.secondaryText }]}>
          {isCategories ? Math.round(Number(team.points_against)) : Number(team.points_against).toFixed(1)}
        </ThemedText>
        <ThemedText style={[styles.gb, { color: c.secondaryText }]}>
          {gb === 0 ? '—' : gb % 1 === 0 ? gb.toFixed(0) : gb.toFixed(1)}
        </ThemedText>
        <ThemedText style={[styles.streakCol, { color: streakColor(team.streak) }]}>
          {team.streak || '—'}
        </ThemedText>
      </TouchableOpacity>
    );
  };

  const renderStandingsHeader = () => (
    <View style={[styles.standingRow, styles.tableHeaderRow]}>
      <ThemedText style={[styles.rank, styles.headerText, { color: c.secondaryText }]}>#</ThemedText>
      <View style={{ width: s(28) }} />
      <ThemedText style={[styles.teamNameCol, styles.headerText, { color: c.secondaryText }]}>Team</ThemedText>
      <ThemedText style={[styles.record, styles.headerText, { color: c.secondaryText }]}>W-L-T</ThemedText>
      <ThemedText style={[styles.stat, styles.headerText, { color: c.secondaryText }]}>{isCategories ? 'CW' : 'PF'}</ThemedText>
      <ThemedText style={[styles.stat, styles.headerText, { color: c.secondaryText }]}>{isCategories ? 'CL' : 'PA'}</ThemedText>
      <ThemedText style={[styles.gb, styles.headerText, { color: c.secondaryText }]}>GB</ThemedText>
      <ThemedText style={[styles.streakCol, styles.headerText, { color: c.secondaryText }]}>STK</ThemedText>
    </View>
  );

  const renderStandingsBlock = (teams: (TeamStanding & { rank: number })[]) => {
    const leader = teams[0];
    const cutoff = playoffTeams ?? 0;
    const hasCutoff = cutoff > 0 && cutoff < teams.length;
    return (
      <View>
        {renderStandingsHeader()}
        {teams.map((team, idx) => (
          <View key={team.id}>
            {hasCutoff && team.rank === cutoff + 1 && (
              <View style={styles.playoffCutoff}>
                <View style={[styles.cutoffLine, { backgroundColor: c.secondaryText }]} />
                <ThemedText style={[styles.cutoffLabel, { color: c.secondaryText }]}>
                  Playoff cutoff — top {cutoff} qualify
                </ThemedText>
                <View style={[styles.cutoffLine, { backgroundColor: c.secondaryText }]} />
              </View>
            )}
            {renderTeamRow(team, idx === teams.length - 1, leader)}
          </View>
        ))}
      </View>
    );
  };

  const renderDivisionBlock = (divisionTeams: TeamStanding[], divisionName: string) => {
    const divStandings = resolveStandings(divisionTeams, matchups ?? [], tiebreakers);
    return (
      <View key={divisionName} style={styles.divisionBlock}>
        <ThemedText
          style={[styles.divisionHeader, styles.standingsCardBody, { color: c.secondaryText }]}
          accessibilityRole="header"
        >
          {divisionName}
        </ThemedText>
        {renderStandingsBlock(divStandings)}
      </View>
    );
  };

  const div1Teams = rawTeams?.filter(t => t.division === 1) ?? [];
  const div2Teams = rawTeams?.filter(t => t.division === 2) ?? [];

  // ─── Helpers ─────────────────────────────────────────────────────────

  function depColor(pct: number): string {
    if (pct >= depThresholds.high) return isDark ? '#FCA5A5' : '#DC2626';
    if (pct >= depThresholds.moderate) return isDark ? '#FCD34D' : '#D97706';
    return isDark ? '#6EE7B7' : '#059669';
  }

  function depLabel(pct: number): string {
    if (pct >= depThresholds.high) return 'High';
    if (pct >= depThresholds.moderate) return 'Moderate';
    return 'Deep';
  }

  const toggleSection = (key: string) =>
    setExpandedSection(prev => prev === key ? null : key);

  // ─── Render ──────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={['top']}>
      <PageHeader title="Standings" />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {isLoading ? (
          <View style={styles.loading}><LogoSpinner /></View>
        ) : (
          <>
            {/* ── Standings Table ── */}
            <View style={[styles.card, styles.standingsCard, { backgroundColor: c.card, borderColor: c.border, ...cardShadow }]}>
              <ThemedText
                type="defaultSemiBold"
                style={[styles.sectionTitle, styles.standingsCardBody]}
                accessibilityRole="header"
              >
                League Standings
              </ThemedText>

              {!rawTeams?.length ? (
                <ThemedText style={[styles.placeholder, styles.standingsCardBody, { color: c.secondaryText }]}>
                  No standings available yet
                </ThemedText>
              ) : hasDivisions && div1Teams.length > 0 && div2Teams.length > 0 ? (
                <>
                  {renderDivisionBlock(div1Teams, league?.division_1_name ?? 'Division 1')}
                  {renderDivisionBlock(div2Teams, league?.division_2_name ?? 'Division 2')}
                </>
              ) : allStandings ? (
                renderStandingsBlock(allStandings)
              ) : null}
              {!!playoffTeams && (
                <ThemedText style={[styles.footnote, styles.standingsCardBody, { color: c.secondaryText }]}>
                  <ThemedText style={[styles.clinchBadge, { color: c.success }]}>x</ThemedText> = clinched playoff spot{' · '}
                  <ThemedText style={[styles.clinchBadge, { color: c.danger }]}>e</ThemedText> = eliminated{' · '}
                  GB = games behind leader
                </ThemedText>
              )}
            </View>

            {/* ── Your Team Insights ── */}
            {teamId && (myAllPlay || myDep || mySoS) && (
              <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border, ...cardShadow }]}>
                <ThemedText type="defaultSemiBold" style={styles.sectionTitle} accessibilityRole="header">
                  Your Team Insights
                </ThemedText>

                <View style={styles.insightGrid}>
                  {/* Luck Index */}
                  {myAllPlay && (() => {
                    const isPositive = myAllPlay.luckIndex >= 0;
                    const luckColor = isPositive
                      ? (isDark ? '#6EE7B7' : '#059669')
                      : (isDark ? '#FCA5A5' : '#DC2626');
                    return (
                      <TouchableOpacity
                        style={[styles.insightTile, { borderColor: c.border }]}
                        onPress={() => setInfoModal('luck')}
                        activeOpacity={0.6}
                        accessibilityLabel={`Luck Index ${isPositive ? 'plus' : 'minus'} ${Math.abs(myAllPlay.luckIndex).toFixed(1)}`}
                      >
                        <Text style={[styles.insightLabel, { color: c.secondaryText }]}>Luck Index</Text>
                        <Text style={[styles.insightValue, { color: luckColor }]}>
                          {isPositive ? '+' : ''}{myAllPlay.luckIndex.toFixed(1)}
                        </Text>
                        <Text style={[styles.insightSub, { color: c.secondaryText }]}>
                          {isPositive ? 'Lucky' : 'Unlucky'}
                        </Text>
                      </TouchableOpacity>
                    );
                  })()}

                  {/* All-Play Record */}
                  {myAllPlay && (
                    <TouchableOpacity
                      style={[styles.insightTile, { borderColor: c.border }]}
                      onPress={() => setInfoModal('allplay')}
                      activeOpacity={0.6}
                      accessibilityLabel={`All-play record ${myAllPlay.allPlayWins}-${myAllPlay.allPlayLosses}`}
                    >
                      <Text style={[styles.insightLabel, { color: c.secondaryText }]}>All-Play</Text>
                      <ThemedText style={styles.insightValue}>
                        {myAllPlay.allPlayWins}-{myAllPlay.allPlayLosses}
                      </ThemedText>
                      <Text style={[styles.insightSub, { color: c.secondaryText }]}>
                        {(myAllPlay.allPlayWinPct * 100).toFixed(0)}% win rate
                      </Text>
                    </TouchableOpacity>
                  )}

                  {/* Schedule Strength */}
                  {mySoS && mySoS.pastOpponents > 0 && (
                    <TouchableOpacity
                      style={[styles.insightTile, { borderColor: c.border }]}
                      onPress={() => setInfoModal('sos')}
                      activeOpacity={0.6}
                      accessibilityLabel={`Schedule strength ${(mySoS.pastSoS * 100).toFixed(0)}%`}
                    >
                      <Text style={[styles.insightLabel, { color: c.secondaryText }]}>Schedule</Text>
                      <ThemedText style={styles.insightValue}>
                        .{(mySoS.pastSoS * 1000).toFixed(0).padStart(3, '0')}
                      </ThemedText>
                      <Text style={[styles.insightSub, { color: c.secondaryText }]}>
                        {mySoS.pastSoS > leagueAvgSoS + 0.02 ? 'Tough' : mySoS.pastSoS < leagueAvgSoS - 0.02 ? 'Easy' : 'Average'}
                      </Text>
                    </TouchableOpacity>
                  )}

                  {/* Dependency Risk */}
                  {myDep && (
                    <TouchableOpacity
                      style={[styles.insightTile, { borderColor: c.border }]}
                      onPress={() => setInfoModal('dependency')}
                      activeOpacity={0.6}
                      accessibilityLabel={`Dependency risk ${Math.round(myDep.topThreePct * 100)}%`}
                    >
                      <Text style={[styles.insightLabel, { color: c.secondaryText }]}>Dependency</Text>
                      <Text style={[styles.insightValue, { color: depColor(myDep.topThreePct) }]}>
                        {Math.round(myDep.topThreePct * 100)}%
                      </Text>
                      <Text style={[styles.insightSub, { color: c.secondaryText }]}>
                        {depLabel(myDep.topThreePct)}
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            )}

            {/* ── Expandable League-Wide Sections ── */}

            {/* Luck Index */}
            {luckSorted.length > 0 && (
              <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border, ...cardShadow }]}>
                <TouchableOpacity
                  style={styles.expandHeader}
                  onPress={() => toggleSection('luck')}
                  activeOpacity={0.6}
                  accessibilityRole="button"
                  accessibilityLabel="Luck Index league comparison"
                >
                  <View style={styles.expandHeaderLeft}>
                    <ThemedText type="defaultSemiBold" style={styles.expandTitle}>Luck Index</ThemedText>
                    <TouchableOpacity hitSlop={12} onPress={() => setInfoModal('luck')} accessibilityLabel="What is Luck Index?">
                      <Ionicons name="information-circle-outline" size={16} color={c.secondaryText} />
                    </TouchableOpacity>
                  </View>
                  <Ionicons name={expandedSection === 'luck' ? 'chevron-up' : 'chevron-down'} size={18} color={c.secondaryText} />
                </TouchableOpacity>

                {expandedSection === 'luck' && (
                  <View style={styles.expandBody}>
                    {luckSorted.map((r) => {
                      const team = teamNameMap.get(r.teamId);
                      if (!team) return null;
                      const isMe = r.teamId === teamId;
                      const isPositive = r.luckIndex >= 0;
                      const barWidth = Math.abs(r.luckIndex) / maxAbsLuck;
                      const barColor = isPositive ? (isDark ? '#6EE7B7' : '#059669') : (isDark ? '#FCA5A5' : '#DC2626');

                      return (
                        <View key={r.teamId} style={[styles.luckRow, isMe && { backgroundColor: isDark ? 'rgba(96,165,250,0.06)' : 'rgba(96,165,250,0.04)' }]}
                          accessibilityLabel={`${team.name}, luck ${r.luckIndex >= 0 ? 'plus' : 'minus'} ${Math.abs(r.luckIndex).toFixed(1)}`}>
                          <ThemedText style={[styles.luckTeamName, isMe && styles.luckTeamNameBold]} numberOfLines={1}>
                            {team.tricode ?? team.name.slice(0, 10)}
                          </ThemedText>
                          <View style={styles.luckBarContainer}>
                            <View style={[styles.luckCenter, { backgroundColor: c.border }]} />
                            <View style={[styles.luckBar, { backgroundColor: barColor, width: `${barWidth * 45}%`, ...(isPositive ? { left: '50%' } : { right: '50%' }) }]} />
                          </View>
                          <Text style={[styles.luckValue, { color: barColor }]}>{isPositive ? '+' : ''}{r.luckIndex.toFixed(1)}</Text>
                        </View>
                      );
                    })}
                  </View>
                )}
              </View>
            )}

            {/* All-Play Standings */}
            {allPlayRanked.length > 0 && (
              <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border, ...cardShadow }]}>
                <TouchableOpacity
                  style={styles.expandHeader}
                  onPress={() => toggleSection('allplay')}
                  activeOpacity={0.6}
                  accessibilityRole="button"
                  accessibilityLabel="All-Play Standings"
                >
                  <View style={styles.expandHeaderLeft}>
                    <ThemedText type="defaultSemiBold" style={styles.expandTitle}>All-Play Standings</ThemedText>
                    <TouchableOpacity hitSlop={12} onPress={() => setInfoModal('allplay')} accessibilityLabel="What is All-Play?">
                      <Ionicons name="information-circle-outline" size={16} color={c.secondaryText} />
                    </TouchableOpacity>
                  </View>
                  <Ionicons name={expandedSection === 'allplay' ? 'chevron-up' : 'chevron-down'} size={18} color={c.secondaryText} />
                </TouchableOpacity>

                {expandedSection === 'allplay' && (
                  <View style={styles.expandBody}>
                    <View style={styles.apHeaderRow}>
                      <ThemedText style={[styles.apRank, styles.headerText, { color: c.secondaryText }]}>#</ThemedText>
                      <ThemedText style={[styles.apTeam, styles.headerText, { color: c.secondaryText }]}>Team</ThemedText>
                      <ThemedText style={[styles.apRecord, styles.headerText, { color: c.secondaryText }]}>Record</ThemedText>
                      <ThemedText style={[styles.apPct, styles.headerText, { color: c.secondaryText }]}>Win%</ThemedText>
                      <ThemedText style={[styles.apExpW, styles.headerText, { color: c.secondaryText }]}>Exp W</ThemedText>
                      <ThemedText style={[styles.apLuck, styles.headerText, { color: c.secondaryText }]}>Luck</ThemedText>
                    </View>
                    {allPlayRanked.map((r, idx) => {
                      const team = teamNameMap.get(r.teamId);
                      if (!team) return null;
                      const isMe = r.teamId === teamId;
                      const luckColor = r.luckIndex >= 0.5 ? (isDark ? '#6EE7B7' : '#059669') : r.luckIndex <= -0.5 ? (isDark ? '#FCA5A5' : '#DC2626') : c.secondaryText;
                      return (
                        <View key={r.teamId} style={[styles.apRow, { borderBottomColor: c.border }, idx === allPlayRanked.length - 1 && { borderBottomWidth: 0 }, isMe && { backgroundColor: isDark ? 'rgba(96,165,250,0.06)' : 'rgba(96,165,250,0.04)' }]}
                          accessibilityLabel={`Rank ${idx + 1}, ${team.name}, all-play ${r.allPlayWins}-${r.allPlayLosses}-${r.allPlayTies}`}>
                          <ThemedText style={[styles.apRank, { color: c.secondaryText }]}>{idx + 1}</ThemedText>
                          <ThemedText style={[styles.apTeam, isMe && { fontWeight: '700' }]} numberOfLines={1}>{team.tricode ?? team.name.slice(0, 10)}</ThemedText>
                          <ThemedText style={[styles.apRecord, { color: c.secondaryText }]}>{r.allPlayWins}-{r.allPlayLosses}-{r.allPlayTies}</ThemedText>
                          <ThemedText style={[styles.apPct, { color: c.secondaryText }]}>{(r.allPlayWinPct * 100).toFixed(1)}</ThemedText>
                          <ThemedText style={[styles.apExpW, { color: c.secondaryText }]}>{r.expectedWins.toFixed(1)}</ThemedText>
                          <Text style={[styles.apLuck, { color: luckColor, fontWeight: '700' }]}>{r.luckIndex >= 0 ? '+' : ''}{r.luckIndex.toFixed(1)}</Text>
                        </View>
                      );
                    })}
                  </View>
                )}
              </View>
            )}

            {/* Dependency Risk */}
            {depSorted.length > 0 && (
              <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border, ...cardShadow }]}>
                <TouchableOpacity
                  style={styles.expandHeader}
                  onPress={() => toggleSection('dependency')}
                  activeOpacity={0.6}
                  accessibilityRole="button"
                  accessibilityLabel="Dependency Risk league comparison"
                >
                  <View style={styles.expandHeaderLeft}>
                    <ThemedText type="defaultSemiBold" style={styles.expandTitle}>Dependency Risk</ThemedText>
                    <TouchableOpacity hitSlop={12} onPress={() => setInfoModal('dependency')} accessibilityLabel="What is Dependency Risk?">
                      <Ionicons name="information-circle-outline" size={16} color={c.secondaryText} />
                    </TouchableOpacity>
                  </View>
                  <Ionicons name={expandedSection === 'dependency' ? 'chevron-up' : 'chevron-down'} size={18} color={c.secondaryText} />
                </TouchableOpacity>

                {expandedSection === 'dependency' && (
                  <View style={styles.expandBody}>
                    {depSorted.map((r) => {
                      const team = teamNameMap.get(r.teamId);
                      if (!team) return null;
                      const isMe = r.teamId === teamId;
                      const pct = Math.round(r.topThreePct * 100);
                      const color = depColor(r.topThreePct);
                      return (
                        <View key={r.teamId} style={[styles.depRow, isMe && { backgroundColor: isDark ? 'rgba(96,165,250,0.06)' : 'rgba(96,165,250,0.04)' }]}
                          accessibilityLabel={`${team.name}, ${pct}% from top 3: ${r.topThreePlayers.join(', ')}`}>
                          <ThemedText style={[styles.depTeamName, isMe && { fontWeight: '700' }]} numberOfLines={1}>{team.tricode ?? team.name.slice(0, 10)}</ThemedText>
                          <View style={styles.depBarOuter}>
                            <View style={[styles.depBarInner, { width: `${pct}%`, backgroundColor: color }]} />
                          </View>
                          <Text style={[styles.depPct, { color }]}>{pct}%</Text>
                        </View>
                      );
                    })}
                  </View>
                )}
              </View>
            )}

            {/* Strength of Schedule */}
            {sosSorted.length > 0 && (
              <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border, ...cardShadow }]}>
                <TouchableOpacity
                  style={styles.expandHeader}
                  onPress={() => toggleSection('sos')}
                  activeOpacity={0.6}
                  accessibilityRole="button"
                  accessibilityLabel="Strength of Schedule"
                >
                  <View style={styles.expandHeaderLeft}>
                    <ThemedText type="defaultSemiBold" style={styles.expandTitle}>Strength of Schedule</ThemedText>
                    <TouchableOpacity hitSlop={12} onPress={() => setInfoModal('sos')} accessibilityLabel="What is Strength of Schedule?">
                      <Ionicons name="information-circle-outline" size={16} color={c.secondaryText} />
                    </TouchableOpacity>
                  </View>
                  <Ionicons name={expandedSection === 'sos' ? 'chevron-up' : 'chevron-down'} size={18} color={c.secondaryText} />
                </TouchableOpacity>

                {expandedSection === 'sos' && (
                  <View style={styles.expandBody}>
                    <View style={styles.sosHeaderRow}>
                      <ThemedText style={[styles.sosTeam, styles.headerText, { color: c.secondaryText }]}>Team</ThemedText>
                      <ThemedText style={[styles.sosStat, styles.headerText, { color: c.secondaryText }]}>Past</ThemedText>
                      {hasFutureSoS && <ThemedText style={[styles.sosStat, styles.headerText, { color: c.secondaryText }]}>Future</ThemedText>}
                      <ThemedText style={[styles.sosStat, styles.headerText, { color: c.secondaryText }]}>Overall</ThemedText>
                    </View>
                    {sosSorted.map((r, idx) => {
                      const team = teamNameMap.get(r.teamId);
                      if (!team) return null;
                      const isMe = r.teamId === teamId;
                      const pastColor = r.pastSoS > leagueAvgSoS + 0.02 ? (isDark ? '#FCA5A5' : '#DC2626') : r.pastSoS < leagueAvgSoS - 0.02 ? (isDark ? '#6EE7B7' : '#059669') : c.secondaryText;
                      return (
                        <View key={r.teamId} style={[styles.sosRow, { borderBottomColor: c.border }, idx === sosSorted.length - 1 && { borderBottomWidth: 0 }, isMe && { backgroundColor: isDark ? 'rgba(96,165,250,0.06)' : 'rgba(96,165,250,0.04)' }]}
                          accessibilityLabel={`${team.name}, past SoS ${(r.pastSoS * 100).toFixed(0)}%`}>
                          <ThemedText style={[styles.sosTeam, isMe && { fontWeight: '700' }]} numberOfLines={1}>{team.tricode ?? team.name.slice(0, 10)}</ThemedText>
                          <Text style={[styles.sosStat, { color: pastColor, fontWeight: '600' }]}>{r.pastOpponents > 0 ? (r.pastSoS * 100).toFixed(1) : '—'}</Text>
                          {hasFutureSoS && <ThemedText style={[styles.sosStat, { color: c.secondaryText }]}>{r.futureSoS !== null ? (r.futureSoS * 100).toFixed(1) : '—'}</ThemedText>}
                          <ThemedText style={[styles.sosStat, { color: c.secondaryText }]}>{(r.overallSoS * 100).toFixed(1)}</ThemedText>
                        </View>
                      );
                    })}
                    {!hasFutureSoS && (
                      <ThemedText style={[styles.sosEmptyNote, { color: c.secondaryText }]}>No remaining regular season games — future SoS unavailable.</ThemedText>
                    )}
                  </View>
                )}
              </View>
            )}

            {/* Weekly Breakdown */}
            {myAllPlay && myAllPlay.weeklyBreakdown.length > 0 && (
              <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border, ...cardShadow }]}>
                <TouchableOpacity
                  style={styles.expandHeader}
                  onPress={() => toggleSection('weekly')}
                  activeOpacity={0.6}
                  accessibilityRole="button"
                  accessibilityLabel="Your Weekly Breakdown"
                >
                  <ThemedText type="defaultSemiBold" style={styles.expandTitle}>Your Weekly Breakdown</ThemedText>
                  <Ionicons name={expandedSection === 'weekly' ? 'chevron-up' : 'chevron-down'} size={18} color={c.secondaryText} />
                </TouchableOpacity>

                {expandedSection === 'weekly' && (
                  <View style={styles.expandBody}>
                    {myAllPlay.weeklyBreakdown.map((week) => {
                      const totalTeams = rawTeams?.length ?? 1;
                      const isExpanded = expandedWeek === week.weekNumber;
                      const beatMost = week.wins >= (totalTeams - 1) * 0.5;
                      const wasUnlucky = beatMost && week.actualResult === 'L';
                      const wasLucky = !beatMost && week.actualResult === 'W';
                      return (
                        <TouchableOpacity key={week.weekNumber} style={[styles.weekRow, { borderBottomColor: c.border }]}
                          onPress={() => setExpandedWeek(isExpanded ? null : week.weekNumber)} activeOpacity={0.6}
                          accessibilityRole="button" accessibilityLabel={`Week ${week.weekNumber}, beat ${week.wins} of ${totalTeams - 1} teams`}>
                          <View style={styles.weekHeader}>
                            <ThemedText style={styles.weekLabel}>Wk {week.weekNumber}</ThemedText>
                            <View style={styles.weekMeta}>
                              <Text style={[styles.weekResult, { color: week.actualResult === 'W' ? c.success : week.actualResult === 'L' ? c.danger : c.secondaryText }]}>
                                {week.actualResult}
                              </Text>
                              <ThemedText style={[styles.weekAp, { color: c.secondaryText }]}>AP: {week.wins}-{week.losses}{week.ties > 0 ? `-${week.ties}` : ''}</ThemedText>
                              <ThemedText style={[styles.weekRankText, { color: c.secondaryText }]}>#{week.rankAmongAll}</ThemedText>
                              {wasUnlucky && (
                                <View style={[styles.weekBadge, { backgroundColor: isDark ? 'rgba(248,113,113,0.15)' : 'rgba(239,68,68,0.1)' }]}>
                                  <Text style={{ fontSize: ms(9), color: isDark ? '#FCA5A5' : '#DC2626', fontWeight: '600' }}>Unlucky</Text>
                                </View>
                              )}
                              {wasLucky && (
                                <View style={[styles.weekBadge, { backgroundColor: isDark ? 'rgba(52,211,153,0.15)' : 'rgba(16,185,129,0.1)' }]}>
                                  <Text style={{ fontSize: ms(9), color: isDark ? '#6EE7B7' : '#059669', fontWeight: '600' }}>Lucky</Text>
                                </View>
                              )}
                            </View>
                            <Ionicons name={isExpanded ? 'chevron-up' : 'chevron-down'} size={16} color={c.secondaryText} />
                          </View>
                          {isExpanded && (
                            <View style={styles.weekExpanded}>
                              <ThemedText style={[styles.weekDetail, { color: c.secondaryText }]}>Score: {isCategories ? week.teamScore : week.teamScore.toFixed(1)}</ThemedText>
                              <ThemedText style={[styles.weekDetail, { color: c.secondaryText }]}>Beat {week.wins} of {totalTeams - 1} teams</ThemedText>
                              <ThemedText style={[styles.weekDetail, { color: c.secondaryText }]}>Ranked #{week.rankAmongAll} of {totalTeams} that week</ThemedText>
                            </View>
                          )}
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                )}
              </View>
            )}
          </>
        )}
      </ScrollView>

      {/* ── Info Modal ── */}
      <Modal visible={infoModal !== null} transparent animationType="fade" onRequestClose={() => setInfoModal(null)}>
        <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={() => setInfoModal(null)} accessibilityLabel="Close" accessibilityRole="button">
          <View style={[styles.modalCard, { backgroundColor: c.card, borderColor: c.border }]}>
            <ThemedText type="defaultSemiBold" style={styles.modalTitle}>
              {infoModal === 'luck' ? 'Luck Index' : infoModal === 'allplay' ? 'All-Play Standings' : infoModal === 'dependency' ? 'Dependency Risk' : 'Strength of Schedule'}
            </ThemedText>

            {infoModal === 'luck' ? (
              <>
                <ThemedText style={[styles.modalBody, { color: c.secondaryText }]}>
                  Each week, your score is compared against every other team in the league — not just your actual opponent. This gives you an "all-play" win percentage that reflects how good your team really was.
                </ThemedText>
                <ThemedText style={[styles.modalBody, { color: c.secondaryText }]}>
                  <ThemedText style={{ fontWeight: '700' }}>Luck Index</ThemedText> = your actual wins minus the wins you'd "expect" based on that all-play percentage.
                </ThemedText>
                <ThemedText style={[styles.modalBody, { color: c.secondaryText }]}>
                  A positive number means you've won more than expected (lucky schedule). Negative means you've been unlucky — your team is better than your record shows.
                </ThemedText>
              </>
            ) : infoModal === 'allplay' ? (
              <>
                <ThemedText style={[styles.modalBody, { color: c.secondaryText }]}>
                  In a normal fantasy week, you only play one opponent. All-Play asks: "What if you played everyone?"
                </ThemedText>
                <ThemedText style={[styles.modalBody, { color: c.secondaryText }]}>
                  <ThemedText style={{ fontWeight: '700' }}>Record</ThemedText> — your all-play wins, losses, and ties across every week this season.
                </ThemedText>
                <ThemedText style={[styles.modalBody, { color: c.secondaryText }]}>
                  <ThemedText style={{ fontWeight: '700' }}>Win%</ThemedText> — what percentage of all hypothetical matchups you would have won.
                </ThemedText>
                <ThemedText style={[styles.modalBody, { color: c.secondaryText }]}>
                  <ThemedText style={{ fontWeight: '700' }}>Exp W</ThemedText> — "Expected Wins." If your all-play win% is 60% and you've played 20 weeks, your expected wins would be 12.
                </ThemedText>
                <ThemedText style={[styles.modalBody, { color: c.secondaryText }]}>
                  <ThemedText style={{ fontWeight: '700' }}>Luck</ThemedText> — the difference between your actual wins and expected wins.
                </ThemedText>
              </>
            ) : infoModal === 'dependency' ? (
              <>
                <ThemedText style={[styles.modalBody, { color: c.secondaryText }]}>
                  Dependency Risk measures how much of a team's total season production is concentrated in their top 3 players, weighted by games played.
                </ThemedText>
                <ThemedText style={[styles.modalBody, { color: c.secondaryText }]}>
                  Teams labeled <ThemedText style={{ fontWeight: '700' }}>High</ThemedText> are more fragile — if a key player gets injured or rests, the team's output drops significantly.
                </ThemedText>
                <ThemedText style={[styles.modalBody, { color: c.secondaryText }]}>
                  Teams labeled <ThemedText style={{ fontWeight: '700' }}>Deep</ThemedText> have balanced rosters that can absorb injuries and rest days more easily.
                </ThemedText>
                <ThemedText style={[styles.modalBody, { color: c.secondaryText }]}>
                  Labels are relative to your league — "High" means higher concentration than most teams in this league.
                </ThemedText>
              </>
            ) : (
              <>
                <ThemedText style={[styles.modalBody, { color: c.secondaryText }]}>
                  Strength of Schedule measures how tough your opponents have been (and will be), based on their win percentages.
                </ThemedText>
                <ThemedText style={[styles.modalBody, { color: c.secondaryText }]}>
                  <ThemedText style={{ fontWeight: '700' }}>Past</ThemedText> — the average win% of opponents you've already played. A high number means you've faced tougher competition.
                </ThemedText>
                <ThemedText style={[styles.modalBody, { color: c.secondaryText }]}>
                  <ThemedText style={{ fontWeight: '700' }}>Future</ThemedText> — the average win% of your remaining regular-season opponents.
                </ThemedText>
                <ThemedText style={[styles.modalBody, { color: c.secondaryText }]}>
                  <ThemedText style={{ fontWeight: '700' }}>Overall</ThemedText> — a weighted combination of past and future, giving a complete picture.
                </ThemedText>
              </>
            )}

            <TouchableOpacity style={[styles.modalClose, { backgroundColor: c.accent }]} onPress={() => setInfoModal(null)} accessibilityRole="button" accessibilityLabel="Got it">
              <Text style={[styles.modalCloseText, { color: '#fff' }]}>Got it</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { flex: 1 },
  scrollContent: { padding: s(16), paddingBottom: s(40) },
  loading: { marginTop: s(40) },

  card: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: s(16),
    paddingTop: s(14),
    paddingBottom: s(8),
    marginBottom: s(16),
  },
  // Variant used only for the standings table card so its rows (and the
  // "your team" highlight) can run edge-to-edge. The title/footnote inside
  // wrap themselves in standingsCardBody for the normal inset.
  standingsCard: {
    paddingHorizontal: 0,
    overflow: 'hidden',
  },
  standingsCardBody: {
    paddingHorizontal: s(16),
  },
  sectionTitle: { marginBottom: s(8) },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: s(4),
  },
  explainer: {
    fontSize: ms(11),
    lineHeight: ms(16),
    marginBottom: s(12),
  },
  placeholder: {
    fontSize: ms(14),
    textAlign: 'center',
    paddingVertical: s(20),
  },

  // ─── Team Insights grid ──────────────
  insightGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: s(8),
  },
  insightTile: {
    flexBasis: '47%',
    flexGrow: 1,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: s(10),
    paddingHorizontal: s(12),
    alignItems: 'center',
  },
  insightLabel: {
    fontSize: ms(9),
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: s(2),
  },
  insightValue: {
    fontSize: ms(22),
    fontWeight: '700',
  },
  insightSub: {
    fontSize: ms(10),
    marginTop: s(2),
  },

  // ─── Expandable sections ────────────
  expandHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: s(2),
  },
  expandHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(6),
  },
  expandTitle: {
    fontSize: ms(14),
  },
  expandBody: {
    marginTop: s(10),
  },

  // ─── Standings table ─────────────────
  tableHeaderRow: {
    height: s(24),
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(128,128,128,0.3)',
  },
  headerText: { fontSize: ms(10), fontWeight: '600' },
  standingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    // Small symmetric horizontal padding so highlighted rows run nearly
    // edge-to-edge on both sides of the card.
    paddingHorizontal: s(8),
    height: s(44),
  },
  rank: { width: s(18), fontSize: ms(12) },
  teamNameCol: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: s(4), marginLeft: s(6), minWidth: 0 },
  teamName: { flexShrink: 1 },
  clinchBadge: { fontSize: ms(10), fontWeight: '700', fontStyle: 'italic' },
  record: { width: s(44), textAlign: 'center', fontSize: ms(11) },
  stat: { width: s(46), textAlign: 'right', fontSize: ms(11) },
  gb: { width: s(26), textAlign: 'right', fontSize: ms(11) },
  streakCol: { width: s(28), textAlign: 'right', fontSize: ms(11), fontWeight: '600' },
  divisionBlock: { marginBottom: s(12) },
  divisionHeader: {
    fontSize: ms(12),
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: s(4),
    marginTop: s(4),
  },
  playoffCutoff: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: s(6),
    paddingHorizontal: s(16),
    gap: s(8),
  },
  cutoffLine: { flex: 1, height: 1, opacity: 0.4 },
  cutoffLabel: {
    fontSize: ms(9),
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  footnote: {
    fontSize: ms(10),
    fontStyle: 'italic',
    textAlign: 'center',
    paddingHorizontal: s(12),
    paddingTop: s(8),
    paddingBottom: s(4),
  },

  // ─── Luck Index bars ─────────────────
  luckRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: s(6),
    paddingHorizontal: s(4),
    borderRadius: 6,
  },
  luckTeamName: {
    width: s(60),
    fontSize: ms(11),
  },
  luckTeamNameBold: {
    fontWeight: '700',
  },
  luckBarContainer: {
    flex: 1,
    height: s(14),
    position: 'relative',
    marginHorizontal: s(8),
  },
  luckCenter: {
    position: 'absolute',
    left: '50%',
    top: 0,
    bottom: 0,
    width: 1,
  },
  luckBar: {
    position: 'absolute',
    top: s(2),
    height: s(10),
    borderRadius: 3,
    opacity: 0.7,
  },
  luckValue: {
    width: s(36),
    textAlign: 'right',
    fontSize: ms(11),
    fontWeight: '700',
  },

  // ─── All-Play table ──────────────────
  apHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: s(4),
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(128,128,128,0.3)',
  },
  apRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: s(7),
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: s(2),
    borderRadius: 6,
  },
  apRank: { width: s(22), fontSize: ms(11) },
  apTeam: { flex: 1, fontSize: ms(11) },
  apRecord: { width: s(60), textAlign: 'center', fontSize: ms(11) },
  apPct: { width: s(38), textAlign: 'right', fontSize: ms(11) },
  apExpW: { width: s(38), textAlign: 'right', fontSize: ms(11) },
  apLuck: { width: s(36), textAlign: 'right', fontSize: ms(11) },

  // ─── Weekly breakdown ────────────────
  weekRow: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: s(8),
  },
  weekHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  weekLabel: {
    width: s(42),
    fontSize: ms(12),
    fontWeight: '600',
  },
  weekMeta: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(10),
  },
  weekResult: {
    fontSize: ms(12),
    fontWeight: '700',
    width: s(16),
  },
  weekAp: { fontSize: ms(11) },
  weekRankText: { fontSize: ms(11) },
  weekBadge: {
    paddingHorizontal: s(6),
    paddingVertical: s(2),
    borderRadius: 4,
  },
  weekExpanded: {
    marginTop: s(8),
    marginLeft: s(42),
    gap: s(4),
  },
  weekDetail: {
    fontSize: ms(11),
    lineHeight: ms(16),
  },

  // ─── Dependency Risk ──────────────────
  depRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: s(6),
    paddingHorizontal: s(4),
    borderRadius: 6,
  },
  depTeamName: {
    width: s(60),
    fontSize: ms(11),
  },
  depBarOuter: {
    flex: 1,
    height: s(12),
    backgroundColor: 'rgba(128,128,128,0.1)',
    borderRadius: 4,
    marginHorizontal: s(8),
    overflow: 'hidden',
  },
  depBarInner: {
    height: '100%',
    borderRadius: 4,
    opacity: 0.7,
  },
  depPct: {
    width: s(34),
    textAlign: 'right',
    fontSize: ms(11),
    fontWeight: '700',
  },

  // ─── Strength of Schedule ────────────
  sosHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: s(4),
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(128,128,128,0.3)',
  },
  sosRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: s(7),
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: s(2),
    borderRadius: 6,
  },
  sosTeam: { flex: 1, fontSize: ms(11) },
  sosStat: { width: s(48), textAlign: 'right', fontSize: ms(11) },
  sosEmptyNote: {
    fontSize: ms(11),
    fontStyle: 'italic',
    marginTop: s(8),
    marginBottom: s(4),
  },

  // ─── Info modal ──────────────────────
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: s(24),
  },
  modalCard: {
    borderWidth: 1,
    borderRadius: 14,
    padding: s(20),
    width: '100%',
    maxWidth: 400,
  },
  modalTitle: {
    fontSize: ms(17),
    marginBottom: s(12),
  },
  modalBody: {
    fontSize: ms(13),
    lineHeight: ms(20),
    marginBottom: s(10),
  },
  modalClose: {
    marginTop: s(8),
    paddingVertical: s(10),
    borderRadius: 8,
    alignItems: 'center',
  },
  modalCloseText: {
    fontSize: ms(15),
    fontWeight: '600',
  },
});
