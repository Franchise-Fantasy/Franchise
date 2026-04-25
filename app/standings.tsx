import { TeamLogo } from '@/components/team/TeamLogo';
import { LogoSpinner } from '@/components/ui/LogoSpinner';
import { PageHeader } from '@/components/ui/PageHeader';
import { BrandSegmented } from '@/components/ui/BrandSegmented';
import { Badge } from '@/components/ui/Badge';
import { ListRow } from '@/components/ui/ListRow';
import { Section } from '@/components/ui/Section';
import { StatTile } from '@/components/ui/StatTile';
import { ThemedText } from '@/components/ui/ThemedText';
import { Brand, Colors, Fonts } from '@/constants/Colors';
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

// Segmented switcher labels — short forms picked to fit a 5-option row.
// "Risk" stands in for Dependency Risk in the switcher (full title still
// appears above the content for clarity).
const SEGMENTS = ['Standings', 'All-Play', 'Luck', 'Risk', 'SoS'] as const;
type Segment = typeof SEGMENTS[number];
type InfoKey = 'luck' | 'allplay' | 'dependency' | 'sos';

export default function StandingsScreen() {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const router = useRouter();
  const { leagueId, teamId } = useAppState();

  const { data: league } = useLeague();
  const scoringType = league?.scoring_type;
  const isCategories = scoringType === 'h2h_categories';
  const playoffTeams = league?.playoff_teams;
  const tiebreakers = league?.tiebreaker_order ?? DEFAULT_TIEBREAKER;
  const hasDivisions = league?.division_count === 2;

  const [segment, setSegment] = useState<Segment>('Standings');
  const [expandedWeek, setExpandedWeek] = useState<number | null>(null);
  const [infoModal, setInfoModal] = useState<InfoKey | null>(null);

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

  const allPlayRanked = useMemo(
    () => allPlayResults ? [...allPlayResults].sort((a, b) => b.allPlayWinPct - a.allPlayWinPct) : [],
    [allPlayResults],
  );

  const luckSorted = useMemo(
    () => allPlayResults ? [...allPlayResults].sort((a, b) => b.luckIndex - a.luckIndex) : [],
    [allPlayResults],
  );

  const maxAbsLuck = useMemo(
    () => luckSorted.length ? Math.max(...luckSorted.map(r => Math.abs(r.luckIndex)), 1) : 1,
    [luckSorted],
  );

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

  const sosResults = useMemo(() => {
    if (!rawTeams?.length) return [];
    return computeStrengthOfSchedule(matchups ?? [], futureMatchups ?? [], rawTeams);
  }, [matchups, futureMatchups, rawTeams]);

  const sosSorted = useMemo(
    () => [...sosResults].sort((a, b) => b.pastSoS - a.pastSoS),
    [sosResults],
  );

  const leagueAvgSoS = useMemo(() => {
    if (!sosResults.length) return 0;
    return sosResults.reduce((acc, r) => acc + r.pastSoS, 0) / sosResults.length;
  }, [sosResults]);

  const hasFutureSoS = sosResults.some(r => r.futureSoS !== null);

  const sosMap = useMemo(() => {
    const map = new Map<string, SoSResult>();
    for (const r of sosResults) map.set(r.teamId, r);
    return map;
  }, [sosResults]);

  const myAllPlay = teamId ? allPlayMap.get(teamId) : null;
  const myDep = teamId ? depMap.get(teamId) : null;
  const mySoS = teamId ? sosMap.get(teamId) : null;

  const teamNameMap = useMemo(() => {
    const map = new Map<string, TeamStanding>();
    for (const t of rawTeams ?? []) map.set(t.id, t);
    return map;
  }, [rawTeams]);

  const anyTies = (rawTeams ?? []).some((t) => (t.ties ?? 0) > 0);

  const isLoading = loadingTeams || loadingMatchups;

  // ─── Render helpers ──────────────────────────────────────────────────

  function streakColor(streak: string): string {
    if (streak.startsWith('W')) return c.success;
    if (streak.startsWith('L')) return c.danger;
    return c.secondaryText;
  }

  function depColor(pct: number): string {
    if (pct >= depThresholds.high) return c.danger;
    if (pct >= depThresholds.moderate) return c.warning;
    return c.success;
  }

  function depLabel(pct: number): string {
    if (pct >= depThresholds.high) return 'High';
    if (pct >= depThresholds.moderate) return 'Moderate';
    return 'Deep';
  }

  const handleTeamPress = (id: string) => {
    if (id === teamId) router.push('/(tabs)/roster');
    else router.push(`/team-roster/${id}` as any);
  };

  // ─── Sub-renders: Standings table ────────────────────────────────────

  const renderStandingsHeader = () => (
    <View style={[styles.tableHeader, { borderBottomColor: c.border }]}>
      <ThemedText type="varsitySmall" style={[styles.rank, { color: c.secondaryText }]}>#</ThemedText>
      <View style={styles.logoSlot} />
      <ThemedText type="varsitySmall" style={[styles.teamNameHeader, { color: c.secondaryText }]}>
        Team
      </ThemedText>
      <ThemedText type="varsitySmall" style={[styles.recordHeader, { color: c.secondaryText }]}>
        {anyTies ? 'W-L-T' : 'W-L'}
      </ThemedText>
      <ThemedText type="varsitySmall" style={[styles.streakCol, { color: c.secondaryText }]}>
        Stk
      </ThemedText>
      <ThemedText type="varsitySmall" style={[styles.statCol, { color: c.secondaryText }]}>
        {isCategories ? 'CW' : 'PF'}
      </ThemedText>
      <ThemedText type="varsitySmall" style={[styles.statCol, { color: c.secondaryText }]}>
        {isCategories ? 'CL' : 'PA'}
      </ThemedText>
      <ThemedText type="varsitySmall" style={[styles.gbCol, { color: c.secondaryText }]}>GB</ThemedText>
    </View>
  );

  const renderTeamRow = (
    team: TeamStanding & { rank: number },
    idx: number,
    total: number,
    leader?: TeamStanding,
  ) => {
    const isMe = team.id === teamId;
    const status = playoffStatuses?.get(team.id);
    const hasStreak = !!team.streak && team.streak !== 'W0' && team.streak !== 'L0';
    const streakDir = team.streak?.[0];
    const streakLen = hasStreak ? Number(team.streak.slice(1)) || 0 : 0;
    const isBigStreak = streakLen >= 5;
    const record = anyTies
      ? `${team.wins}-${team.losses}-${team.ties}`
      : `${team.wins}-${team.losses}`;
    const gb = leader
      ? ((leader.wins - team.wins) + (team.losses - leader.losses)) / 2
      : 0;
    const gbDisplay = gb === 0 ? '—' : gb % 1 === 0 ? gb.toFixed(0) : gb.toFixed(1);

    return (
      <ListRow
        key={team.id}
        index={idx}
        total={total}
        isActive={isMe}
        onPress={() => handleTeamPress(team.id)}
        accessibilityLabel={`${team.name}, rank ${team.rank}, record ${record}, streak ${team.streak || 'none'}`}
      >
        <ThemedText type="mono" style={[styles.rank, { color: c.secondaryText }]}>{team.rank}</ThemedText>
        <View style={styles.logoSlot}>
          <TeamLogo logoKey={team.logo_key} teamName={team.name} tricode={team.tricode ?? undefined} size="small" />
        </View>
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
        <View
          style={[
            styles.recordCell,
            hasStreak && streakDir === 'W' && { backgroundColor: c.successMuted },
            hasStreak && streakDir === 'L' && { backgroundColor: c.dangerMuted },
            isBigStreak && streakDir === 'W' && { borderColor: c.success },
            isBigStreak && streakDir === 'L' && { borderColor: c.danger },
          ]}
        >
          <ThemedText type="mono" style={[styles.recordText, { color: c.text }]}>
            {record}
          </ThemedText>
        </View>
        <Text style={[styles.streakCol, styles.monoBold, { color: streakColor(team.streak) }]}>
          {team.streak && team.streak !== 'W0' && team.streak !== 'L0' ? team.streak : '—'}
        </Text>
        <ThemedText type="mono" style={[styles.statCol, { color: c.secondaryText }]}>
          {Math.round(Number(team.points_for))}
        </ThemedText>
        <ThemedText type="mono" style={[styles.statCol, { color: c.secondaryText }]}>
          {Math.round(Number(team.points_against))}
        </ThemedText>
        <ThemedText type="mono" style={[styles.gbCol, { color: c.secondaryText }]}>
          {gbDisplay}
        </ThemedText>
      </ListRow>
    );
  };

  const renderStandingsBlock = (teams: (TeamStanding & { rank: number })[]) => {
    const leader = teams[0];
    const cutoff = playoffTeams ?? 0;
    const hasCutoff = cutoff > 0 && cutoff < teams.length;
    // Horizontal scroll lets the table show full team names + a dedicated
    // streak column without cramping on phone. Rows live inside a fixed-
    // width inner view so every column stays aligned across rows.
    return (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ minWidth: '100%' }}
      >
        <View style={styles.tableInner}>
          {renderStandingsHeader()}
          {teams.map((team, idx) => (
            <View key={team.id}>
              {hasCutoff && team.rank === cutoff + 1 && (
                <View style={styles.playoffCutoff}>
                  <View style={[styles.cutoffLine, { backgroundColor: c.border }]} />
                  <ThemedText type="varsitySmall" style={[styles.cutoffLabel, { color: c.secondaryText }]}>
                    Playoff Cutoff — Top {cutoff} Qualify
                  </ThemedText>
                  <View style={[styles.cutoffLine, { backgroundColor: c.border }]} />
                </View>
              )}
              {renderTeamRow(team, idx, teams.length, leader)}
            </View>
          ))}
        </View>
      </ScrollView>
    );
  };

  const renderDivisionBlock = (divisionTeams: TeamStanding[], divisionName: string) => {
    const divStandings = resolveStandings(divisionTeams, matchups ?? [], tiebreakers);
    return (
      <View key={divisionName} style={styles.divisionBlock}>
        <ThemedText
          type="varsitySmall"
          style={[styles.divisionHeader, { color: c.secondaryText }]}
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

  const renderStandingsView = () => (
    <Section title="League Standings" cardStyle={styles.tableCard}>
      {!rawTeams?.length ? (
        <ThemedText style={[styles.placeholderText, { color: c.secondaryText }]}>
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

      {!!rawTeams?.length && !!playoffTeams && (
        <View style={[styles.cardFooter, { borderTopColor: c.border }]}>
          <ThemedText type="varsitySmall" style={[styles.footnote, { color: c.secondaryText }]}>
            <ThemedText type="varsitySmall" style={{ color: c.success }}>x</ThemedText>
            {' '}Clinched · <ThemedText type="varsitySmall" style={{ color: c.danger }}>e</ThemedText>
            {' '}Eliminated · GB Games Behind
          </ThemedText>
        </View>
      )}
    </Section>
  );

  // ─── Sub-renders: All-Play view ──────────────────────────────────────

  const renderAllPlayView = () => (
    <>
      <Section
        title="All-Play Standings"
        onInfoPress={() => setInfoModal('allplay')}
        cardStyle={styles.tableCard}
      >
        {allPlayRanked.length === 0 ? (
          <ThemedText style={[styles.placeholderText, { color: c.secondaryText }]}>
            Not enough games played yet
          </ThemedText>
        ) : (
          <>
            <View style={[styles.tableHeader, { borderBottomColor: c.border }]}>
              <ThemedText type="varsitySmall" style={[styles.rank, { color: c.secondaryText }]}>#</ThemedText>
              <View style={styles.logoSlot} />
              <ThemedText type="varsitySmall" style={[styles.apTeamHeader, { color: c.secondaryText }]}>
                Team
              </ThemedText>
              <ThemedText type="varsitySmall" style={[styles.apRecord, { color: c.secondaryText }]}>Record</ThemedText>
              <ThemedText type="varsitySmall" style={[styles.apExpW, { color: c.secondaryText }]}>ExpW</ThemedText>
              <ThemedText type="varsitySmall" style={[styles.apLuck, { color: c.secondaryText }]}>Luck</ThemedText>
            </View>
            {allPlayRanked.map((r, idx) => {
              const team = teamNameMap.get(r.teamId);
              if (!team) return null;
              const isMe = r.teamId === teamId;
              const luckC = r.luckIndex >= 0.5 ? c.success : r.luckIndex <= -0.5 ? c.danger : c.secondaryText;
              return (
                <ListRow
                  key={r.teamId}
                  index={idx}
                  total={allPlayRanked.length}
                  isActive={isMe}
                  accessibilityLabel={`Rank ${idx + 1}, ${team.name}, all-play ${r.allPlayWins}-${r.allPlayLosses}-${r.allPlayTies}, luck ${r.luckIndex >= 0 ? 'plus' : 'minus'} ${Math.abs(r.luckIndex).toFixed(1)}`}
                >
                  <ThemedText type="mono" style={[styles.rank, { color: c.secondaryText }]}>
                    {idx + 1}
                  </ThemedText>
                  <View style={styles.logoSlot}>
                    <TeamLogo
                      logoKey={team.logo_key}
                      teamName={team.name}
                      tricode={team.tricode ?? undefined}
                      size="small"
                    />
                  </View>
                  <ThemedText
                    style={[
                      styles.apTeam,
                      { color: c.text, fontWeight: isMe ? '700' : '500' },
                    ]}
                    numberOfLines={1}
                    ellipsizeMode="tail"
                  >
                    {team.name}
                  </ThemedText>
                  <ThemedText type="mono" style={[styles.apRecord, { color: c.secondaryText }]}>
                    {r.allPlayWins}-{r.allPlayLosses}{r.allPlayTies > 0 ? `-${r.allPlayTies}` : ''}
                  </ThemedText>
                  <ThemedText type="mono" style={[styles.apExpW, { color: c.secondaryText }]}>
                    {r.expectedWins.toFixed(1)}
                  </ThemedText>
                  <Text style={[styles.apLuck, styles.monoBold, { color: luckC }]}>
                    {r.luckIndex >= 0 ? '+' : ''}{r.luckIndex.toFixed(1)}
                  </Text>
                </ListRow>
              );
            })}
          </>
        )}
      </Section>

      {myAllPlay && myAllPlay.weeklyBreakdown.length > 0 && (
        <Section title="Your Weekly Breakdown" cardStyle={styles.tableCard}>
          {myAllPlay.weeklyBreakdown.map((week, idx, arr) => {
            const totalTeams = rawTeams?.length ?? 1;
            const isExpanded = expandedWeek === week.weekNumber;
            const beatMost = week.wins >= (totalTeams - 1) * 0.5;
            const wasUnlucky = beatMost && week.actualResult === 'L';
            const wasLucky = !beatMost && week.actualResult === 'W';
            return (
              <ListRow
                key={week.weekNumber}
                index={idx}
                total={arr.length}
                onPress={() => setExpandedWeek(isExpanded ? null : week.weekNumber)}
                accessibilityLabel={`Week ${week.weekNumber}, beat ${week.wins} of ${totalTeams - 1} teams`}
                style={styles.weekRowOverride}
              >
                <View style={styles.weekHeader}>
                  <ThemedText type="mono" style={[styles.weekLabel, { color: c.text }]}>Wk {week.weekNumber}</ThemedText>
                  <View style={styles.weekMeta}>
                    <Text
                      style={[
                        styles.weekResult,
                        {
                          color: week.actualResult === 'W' ? c.success : week.actualResult === 'L' ? c.danger : c.secondaryText,
                        },
                      ]}
                    >
                      {week.actualResult}
                    </Text>
                    <ThemedText type="mono" style={[styles.weekAp, { color: c.secondaryText }]}>
                      AP {week.wins}-{week.losses}{week.ties > 0 ? `-${week.ties}` : ''}
                    </ThemedText>
                    <ThemedText type="mono" style={[styles.weekRankText, { color: c.secondaryText }]}>
                      #{week.rankAmongAll}
                    </ThemedText>
                    {wasUnlucky && <Badge label="Unlucky" variant="danger" size="small" />}
                    {wasLucky && <Badge label="Lucky" variant="success" size="small" />}
                  </View>
                </View>
                {isExpanded && (
                  <View style={styles.weekExpanded}>
                    <ThemedText style={[styles.weekDetail, { color: c.secondaryText }]}>
                      Score: {isCategories ? week.teamScore : week.teamScore.toFixed(1)}
                    </ThemedText>
                    <ThemedText style={[styles.weekDetail, { color: c.secondaryText }]}>
                      Beat {week.wins} of {totalTeams - 1} teams
                    </ThemedText>
                    <ThemedText style={[styles.weekDetail, { color: c.secondaryText }]}>
                      Ranked #{week.rankAmongAll} of {totalTeams} that week
                    </ThemedText>
                  </View>
                )}
              </ListRow>
            );
          })}
        </Section>
      )}
    </>
  );

  // ─── Sub-renders: Luck view ──────────────────────────────────────────

  const renderLuckView = () => (
    <Section
      title="Luck Index"
      onInfoPress={() => setInfoModal('luck')}
      cardStyle={styles.tableCard}
    >
      {luckSorted.length === 0 ? (
        <ThemedText style={[styles.placeholderText, { color: c.secondaryText }]}>
          Not enough games played yet
        </ThemedText>
      ) : (
        luckSorted.map((r, idx) => {
          const team = teamNameMap.get(r.teamId);
          if (!team) return null;
          const isMe = r.teamId === teamId;
          const isPositive = r.luckIndex >= 0;
          const barWidth = Math.abs(r.luckIndex) / maxAbsLuck;
          const barColor = isPositive ? c.success : c.danger;
          return (
            <ListRow
              key={r.teamId}
              index={idx}
              total={luckSorted.length}
              isActive={isMe}
              accessibilityLabel={`${team.name}, luck ${isPositive ? 'plus' : 'minus'} ${Math.abs(r.luckIndex).toFixed(1)}`}
            >
              <ThemedText
                style={[styles.luckTeamName, { color: c.text, fontWeight: isMe ? '700' : '500' }]}
                numberOfLines={1}
              >
                {team.tricode ?? team.name.slice(0, 10)}
              </ThemedText>
              <View style={styles.luckBarContainer}>
                <View style={[styles.luckCenter, { backgroundColor: c.border }]} />
                <View
                  style={[
                    styles.luckBar,
                    {
                      backgroundColor: barColor,
                      width: `${barWidth * 45}%`,
                      ...(isPositive ? { left: '50%' } : { right: '50%' }),
                    },
                  ]}
                />
              </View>
              <Text style={[styles.luckValue, { color: barColor }]}>
                {isPositive ? '+' : ''}{r.luckIndex.toFixed(1)}
              </Text>
            </ListRow>
          );
        })
      )}
    </Section>
  );

  // ─── Sub-renders: Dependency Risk view ───────────────────────────────

  const renderRiskView = () => (
    <Section
      title="Dependency Risk"
      onInfoPress={() => setInfoModal('dependency')}
      cardStyle={styles.tableCard}
    >
      {depSorted.length === 0 ? (
        <ThemedText style={[styles.placeholderText, { color: c.secondaryText }]}>
          Roster data unavailable
        </ThemedText>
      ) : (
        depSorted.map((r, idx) => {
          const team = teamNameMap.get(r.teamId);
          if (!team) return null;
          const isMe = r.teamId === teamId;
          const pct = Math.round(r.topThreePct * 100);
          const color = depColor(r.topThreePct);
          return (
            <ListRow
              key={r.teamId}
              index={idx}
              total={depSorted.length}
              isActive={isMe}
              accessibilityLabel={`${team.name}, ${pct}% from top 3: ${r.topThreePlayers.join(', ')}`}
            >
              <ThemedText
                style={[styles.depTeamName, { color: c.text, fontWeight: isMe ? '700' : '500' }]}
                numberOfLines={1}
              >
                {team.tricode ?? team.name.slice(0, 10)}
              </ThemedText>
              <View style={[styles.depBarOuter, { backgroundColor: c.border }]}>
                <View style={[styles.depBarInner, { width: `${pct}%`, backgroundColor: color }]} />
              </View>
              <Text style={[styles.depPct, { color }]}>{pct}%</Text>
            </ListRow>
          );
        })
      )}
    </Section>
  );

  // ─── Sub-renders: Schedule view ──────────────────────────────────────

  const renderScheduleView = () => (
    <Section
      title="Strength of Schedule"
      onInfoPress={() => setInfoModal('sos')}
      cardStyle={styles.tableCard}
    >
      {sosSorted.length === 0 ? (
        <ThemedText style={[styles.placeholderText, { color: c.secondaryText }]}>
          Not enough games played yet
        </ThemedText>
      ) : (
        <>
          <View style={[styles.tableHeader, { borderBottomColor: c.border }]}>
            <ThemedText type="varsitySmall" style={[styles.sosTeam, { color: c.secondaryText }]}>Team</ThemedText>
            <ThemedText type="varsitySmall" style={[styles.sosStat, { color: c.secondaryText }]}>Past</ThemedText>
            {hasFutureSoS && (
              <ThemedText type="varsitySmall" style={[styles.sosStat, { color: c.secondaryText }]}>Future</ThemedText>
            )}
            <ThemedText type="varsitySmall" style={[styles.sosStat, { color: c.secondaryText }]}>Overall</ThemedText>
          </View>
          {sosSorted.map((r, idx) => {
            const team = teamNameMap.get(r.teamId);
            if (!team) return null;
            const isMe = r.teamId === teamId;
            const pastC = r.pastSoS > leagueAvgSoS + 0.02
              ? c.danger
              : r.pastSoS < leagueAvgSoS - 0.02
                ? c.success
                : c.secondaryText;
            return (
              <ListRow
                key={r.teamId}
                index={idx}
                total={sosSorted.length}
                isActive={isMe}
                accessibilityLabel={`${team.name}, past strength of schedule ${(r.pastSoS * 100).toFixed(0)} percent`}
              >
                <ThemedText
                  style={[styles.sosTeam, { color: c.text, fontWeight: isMe ? '700' : '500', fontSize: ms(12) }]}
                  numberOfLines={1}
                >
                  {team.tricode ?? team.name}
                </ThemedText>
                <Text style={[styles.sosStat, styles.monoBold, { color: pastC }]}>
                  {r.pastOpponents > 0 ? (r.pastSoS * 100).toFixed(1) : '—'}
                </Text>
                {hasFutureSoS && (
                  <ThemedText type="mono" style={[styles.sosStat, { color: c.secondaryText }]}>
                    {r.futureSoS !== null ? (r.futureSoS * 100).toFixed(1) : '—'}
                  </ThemedText>
                )}
                <ThemedText type="mono" style={[styles.sosStat, { color: c.secondaryText }]}>
                  {(r.overallSoS * 100).toFixed(1)}
                </ThemedText>
              </ListRow>
            );
          })}
          {!hasFutureSoS && (
            <ThemedText style={[styles.sosEmptyNote, { color: c.secondaryText }]}>
              No remaining regular season games — future SoS unavailable.
            </ThemedText>
          )}
        </>
      )}
    </Section>
  );

  // ─── Your Team Insights tiles (above segmented switcher) ─────────────

  const renderInsightsTiles = () => {
    if (!teamId || !(myAllPlay || myDep || mySoS)) return null;
    return (
      <Section title="Your Team" noCard>
        <View style={styles.insightGrid}>
          {myAllPlay && (() => {
            const isPositive = myAllPlay.luckIndex >= 0;
            const luckC = isPositive ? c.success : c.danger;
            return (
              <StatTile
                label="Luck"
                value={`${isPositive ? '+' : ''}${myAllPlay.luckIndex.toFixed(1)}`}
                sub={isPositive ? 'Lucky' : 'Unlucky'}
                valueColor={luckC}
                onPress={() => setSegment('Luck')}
                accessibilityLabel={`Luck Index ${isPositive ? 'plus' : 'minus'} ${Math.abs(myAllPlay.luckIndex).toFixed(1)}. Tap to view league comparison.`}
              />
            );
          })()}

          {myAllPlay && (
            <StatTile
              label="All-Play"
              value={`${myAllPlay.allPlayWins}-${myAllPlay.allPlayLosses}`}
              sub={`${(myAllPlay.allPlayWinPct * 100).toFixed(0)}% win rate`}
              onPress={() => setSegment('All-Play')}
              accessibilityLabel={`All-play record ${myAllPlay.allPlayWins} wins, ${myAllPlay.allPlayLosses} losses. Tap to view standings.`}
            />
          )}

          {mySoS && mySoS.pastOpponents > 0 && (
            <StatTile
              label="Schedule"
              value={`.${(mySoS.pastSoS * 1000).toFixed(0).padStart(3, '0')}`}
              sub={mySoS.pastSoS > leagueAvgSoS + 0.02 ? 'Tough' : mySoS.pastSoS < leagueAvgSoS - 0.02 ? 'Easy' : 'Average'}
              onPress={() => setSegment('SoS')}
              accessibilityLabel={`Schedule strength ${(mySoS.pastSoS * 100).toFixed(0)} percent. Tap to view league comparison.`}
            />
          )}

          {myDep && (
            <StatTile
              label="Risk"
              value={`${Math.round(myDep.topThreePct * 100)}%`}
              sub={depLabel(myDep.topThreePct)}
              valueColor={depColor(myDep.topThreePct)}
              onPress={() => setSegment('Risk')}
              accessibilityLabel={`Dependency risk ${Math.round(myDep.topThreePct * 100)} percent. Tap to view league comparison.`}
            />
          )}
        </View>
      </Section>
    );
  };

  // ─── Render ──────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={['top']}>
      <PageHeader title="Standings" />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {isLoading ? (
          <View style={styles.loading}><LogoSpinner /></View>
        ) : (
          <>
            {renderInsightsTiles()}

            <BrandSegmented
              options={SEGMENTS}
              selected={segment}
              onSelect={setSegment}
            />

            {segment === 'Standings' && renderStandingsView()}
            {segment === 'All-Play' && renderAllPlayView()}
            {segment === 'Luck' && renderLuckView()}
            {segment === 'Risk' && renderRiskView()}
            {segment === 'SoS' && renderScheduleView()}
          </>
        )}
      </ScrollView>

      <Modal
        visible={infoModal !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setInfoModal(null)}
      >
        <TouchableOpacity
          style={styles.modalBackdrop}
          activeOpacity={1}
          onPress={() => setInfoModal(null)}
          accessibilityLabel="Close"
          accessibilityRole="button"
        >
          <View style={[styles.modalCard, { backgroundColor: c.card, borderColor: c.border }]}>
            <View style={styles.modalTitleRow}>
              <View style={[styles.labelRule, { backgroundColor: c.gold }]} />
              <ThemedText type="sectionLabel" style={{ color: c.text }}>
                {infoModal === 'luck' ? 'Luck Index'
                  : infoModal === 'allplay' ? 'All-Play Standings'
                    : infoModal === 'dependency' ? 'Dependency Risk'
                      : 'Strength of Schedule'}
              </ThemedText>
            </View>

            {infoModal === 'luck' ? (
              <>
                <ThemedText style={[styles.modalBody, { color: c.secondaryText }]}>
                  Each week, your score is compared against every other team in the league — not just your actual opponent. This gives you an "all-play" win percentage that reflects how good your team really was.
                </ThemedText>
                <ThemedText style={[styles.modalBody, { color: c.secondaryText }]}>
                  <ThemedText style={{ fontWeight: '700', color: c.text }}>Luck Index</ThemedText> = your actual wins minus the wins you'd "expect" based on that all-play percentage.
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
                  <ThemedText style={{ fontWeight: '700', color: c.text }}>Record</ThemedText> — your all-play wins, losses, and ties across every week this season.
                </ThemedText>
                <ThemedText style={[styles.modalBody, { color: c.secondaryText }]}>
                  <ThemedText style={{ fontWeight: '700', color: c.text }}>Win%</ThemedText> — what percentage of all hypothetical matchups you would have won.
                </ThemedText>
                <ThemedText style={[styles.modalBody, { color: c.secondaryText }]}>
                  <ThemedText style={{ fontWeight: '700', color: c.text }}>ExpW</ThemedText> — "Expected Wins." If your all-play win% is 60% and you've played 20 weeks, your expected wins would be 12.
                </ThemedText>
                <ThemedText style={[styles.modalBody, { color: c.secondaryText }]}>
                  <ThemedText style={{ fontWeight: '700', color: c.text }}>Luck</ThemedText> — the difference between your actual wins and expected wins.
                </ThemedText>
              </>
            ) : infoModal === 'dependency' ? (
              <>
                <ThemedText style={[styles.modalBody, { color: c.secondaryText }]}>
                  Dependency Risk measures how much of a team's total season production is concentrated in their top 3 players, weighted by games played.
                </ThemedText>
                <ThemedText style={[styles.modalBody, { color: c.secondaryText }]}>
                  Teams labeled <ThemedText style={{ fontWeight: '700', color: c.text }}>High</ThemedText> are more fragile — if a key player gets injured or rests, the team's output drops significantly.
                </ThemedText>
                <ThemedText style={[styles.modalBody, { color: c.secondaryText }]}>
                  Teams labeled <ThemedText style={{ fontWeight: '700', color: c.text }}>Deep</ThemedText> have balanced rosters that can absorb injuries and rest days more easily.
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
                  <ThemedText style={{ fontWeight: '700', color: c.text }}>Past</ThemedText> — the average win% of opponents you've already played. A high number means you've faced tougher competition.
                </ThemedText>
                <ThemedText style={[styles.modalBody, { color: c.secondaryText }]}>
                  <ThemedText style={{ fontWeight: '700', color: c.text }}>Future</ThemedText> — the average win% of your remaining regular-season opponents.
                </ThemedText>
                <ThemedText style={[styles.modalBody, { color: c.secondaryText }]}>
                  <ThemedText style={{ fontWeight: '700', color: c.text }}>Overall</ThemedText> — a weighted combination of past and future, giving a complete picture.
                </ThemedText>
              </>
            )}

            <TouchableOpacity
              style={[styles.modalClose, { backgroundColor: Brand.turfGreen }]}
              onPress={() => setInfoModal(null)}
              accessibilityRole="button"
              accessibilityLabel="Got it"
            >
              <ThemedText type="varsity" style={[styles.modalCloseText, { color: Brand.ecru }]}>
                Got it
              </ThemedText>
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

  // Any Section whose children are ListRow tables needs its card padding
  // dropped to 0 — so isActive row backgrounds reach the card's edges
  // instead of stopping at a 14-unit interior gutter.
  tableCard: {
    paddingHorizontal: 0,
    overflow: 'hidden',
  },

  placeholderText: {
    fontSize: ms(14),
    textAlign: 'center',
    paddingVertical: s(20),
    paddingHorizontal: s(14),
  },

  // ─── Team Insights grid ──────────────────────────────
  insightGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: s(8),
    marginBottom: s(16),
  },

  // ─── Standings table ─────────────────────────────────
  // Inner table width locked so every row/header column stays aligned
  // inside the horizontal ScrollView. Width sums the fixed column widths
  // below plus gaps — bumping a column here means adjusting this too.
  tableInner: {
    width: s(460),
  },
  tableHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: s(6),
    paddingHorizontal: s(14),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rank: {
    width: s(22),
    fontSize: ms(12),
    textAlign: 'left',
  },
  logoSlot: {
    width: s(28),
    alignItems: 'flex-start',
  },
  // Team name column — fixed width (no flex) so columns across all rows
  // line up horizontally inside the scrollable inner view. Long names
  // still ellipsize, but at s(150) most NBA-style team names fit.
  teamNameCol: {
    width: s(150),
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(6),
    marginLeft: s(8),
    minWidth: 0,
  },
  teamNameHeader: {
    width: s(150),
    marginLeft: s(8),
  },
  teamName: {
    flexShrink: 1,
    fontSize: ms(13),
    fontWeight: '500',
  },
  clinchBadge: {
    fontSize: ms(9),
  },
  // Record cell — tinted by streak direction, ringed on 5+ streaks.
  // Default transparent border reserves space so the ring doesn't shift
  // the row width when it appears.
  recordCell: {
    width: s(48),
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: s(3),
    borderRadius: 4,
    borderWidth: 1,
    borderColor: 'transparent',
    marginLeft: s(4),
  },
  recordHeader: {
    width: s(48),
    textAlign: 'center',
    marginLeft: s(4),
  },
  recordText: {
    fontSize: ms(12),
  },
  // Dedicated streak column — "W3" / "L2" in mono bold, tinted success/
  // danger. Sits right of the tinted record cell so both reinforce the
  // same signal at a glance.
  streakCol: {
    width: s(36),
    textAlign: 'center',
    fontSize: ms(11.5),
    marginLeft: s(4),
  },
  // PF/PA/GB — mono, right-aligned, whole-number-only content so the
  // widths hold across all weeks.
  statCol: {
    width: s(44),
    textAlign: 'right',
    fontSize: ms(11.5),
    marginLeft: s(4),
  },
  gbCol: {
    width: s(32),
    textAlign: 'right',
    fontSize: ms(11.5),
    marginLeft: s(4),
  },
  divisionBlock: {
    marginBottom: s(10),
  },
  divisionHeader: {
    fontSize: ms(10),
    letterSpacing: 0.8,
    marginTop: s(6),
    marginBottom: s(2),
    paddingHorizontal: s(14),
  },
  playoffCutoff: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: s(6),
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
  cardFooter: {
    paddingHorizontal: s(14),
    paddingTop: s(10),
    paddingBottom: s(4),
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: s(4),
    alignItems: 'center',
  },
  footnote: {
    fontSize: ms(9.5),
    textAlign: 'center',
  },

  // ─── All-Play table ──────────────────────────────────
  // All-Play columns — uses the shared rank + logoSlot from the main
  // standings table (so rank/logo alignment matches across lenses) plus
  // a flex team name, record, ExpW, and Luck. Win% dropped to make room
  // for full team names + logos without horizontal scroll.
  apTeam: {
    flex: 1,
    fontSize: ms(12.5),
    marginLeft: s(8),
    minWidth: 0,
  },
  apTeamHeader: {
    flex: 1,
    marginLeft: s(8),
  },
  apRecord: { width: s(58), textAlign: 'center', fontSize: ms(11), marginLeft: s(4) },
  apExpW: { width: s(34), textAlign: 'right', fontSize: ms(11), marginLeft: s(4) },
  apLuck: { width: s(38), textAlign: 'right', fontSize: ms(11), marginLeft: s(4) },
  // Bold mono emphasis for stat columns. SpaceMono doesn't have a true
  // bold variant, so we bump weight — Hermes falls back to the closest
  // available weight, which still reads tighter/heavier than regular.
  monoBold: {
    fontFamily: Fonts.mono,
    fontWeight: '700',
    letterSpacing: 0.5,
  },

  // ─── Weekly breakdown ────────────────────────────────
  // Override ListRow's default flex-row so header + expanded details can
  // stack vertically inside a single pressable row.
  weekRowOverride: {
    flexDirection: 'column',
    alignItems: 'stretch',
    paddingVertical: s(9),
  },
  weekHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  weekLabel: {
    width: s(46),
    fontSize: ms(12),
  },
  weekMeta: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(10),
  },
  weekResult: {
    fontSize: ms(13),
    fontWeight: '700',
    width: s(16),
  },
  weekAp: { fontSize: ms(11) },
  weekRankText: { fontSize: ms(11) },
  weekExpanded: {
    marginTop: s(8),
    marginLeft: s(46),
    gap: s(4),
  },
  weekDetail: {
    fontSize: ms(11),
    lineHeight: ms(16),
  },

  // ─── Luck Index bars ─────────────────────────────────
  luckTeamName: {
    width: s(68),
    fontSize: ms(12),
  },
  luckBarContainer: {
    flex: 1,
    height: s(14),
    position: 'relative',
    marginHorizontal: s(10),
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
    opacity: 0.75,
  },
  luckValue: {
    width: s(40),
    textAlign: 'right',
    fontSize: ms(11.5),
    fontFamily: Fonts.mono,
    fontWeight: '700',
    letterSpacing: 0.5,
  },

  // ─── Dependency Risk bars ────────────────────────────
  depTeamName: {
    width: s(68),
    fontSize: ms(12),
  },
  depBarOuter: {
    flex: 1,
    height: s(10),
    borderRadius: 4,
    marginHorizontal: s(10),
    overflow: 'hidden',
    opacity: 0.35,
  },
  depBarInner: {
    height: '100%',
    borderRadius: 4,
    opacity: 1,
  },
  depPct: {
    width: s(40),
    textAlign: 'right',
    fontSize: ms(11.5),
    fontFamily: Fonts.mono,
    fontWeight: '700',
    letterSpacing: 0.5,
  },

  // ─── Strength of Schedule ────────────────────────────
  sosTeam: { flex: 1, fontSize: ms(11), marginLeft: s(2), minWidth: 0 },
  sosStat: { width: s(56), textAlign: 'right', fontSize: ms(11), marginLeft: s(2) },
  sosEmptyNote: {
    fontSize: ms(11),
    fontStyle: 'italic',
    textAlign: 'center',
    marginTop: s(10),
    marginBottom: s(4),
  },

  // ─── Info modal ──────────────────────────────────────
  labelRule: {
    height: 2,
    width: s(18),
  },
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
  modalTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(10),
    marginBottom: s(14),
  },
  modalBody: {
    fontSize: ms(13),
    lineHeight: ms(20),
    marginBottom: s(10),
  },
  modalClose: {
    marginTop: s(8),
    paddingVertical: s(12),
    borderRadius: 10,
    alignItems: 'center',
  },
  modalCloseText: {
    fontSize: ms(12),
    letterSpacing: 1,
  },
});
