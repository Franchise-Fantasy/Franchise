import { ErrorState } from '@/components/ErrorState';
import { CategoryScoreboard } from '@/components/matchup/CategoryScoreboard';
import { MatchupSkeleton, SkeletonBlock } from '@/components/matchup/MatchupSkeleton';
import { PlayerCell, pStyles, RosterPlayer, DisplayMode, round1, buildStatLine } from '@/components/matchup/PlayerCell';
import { PlayerDetailModal } from '@/components/player/PlayerDetailModal';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { Colors } from '@/constants/Colors';
import { CURRENT_NBA_SEASON } from '@/constants/LeagueDefaults';
import { useAppState } from '@/context/AppStateProvider';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useLeague } from '@/hooks/useLeague';
import { useLeagueScoring } from '@/hooks/useLeagueScoring';
import { supabase } from '@/lib/supabase';
import { PlayerSeasonStats, ScoringWeight } from '@/types/player';
import { aggregateTeamStats, computeCategoryResults, TeamStatTotals } from '@/utils/categoryScoring';
import { liveToGameLog, LivePlayerStats, useLivePlayerStats } from '@/utils/nbaLive';
import { toDateStr, parseLocalDate, addDays, formatDayLabel, useToday } from '@/utils/dates';
import { fetchNbaScheduleForDate } from '@/utils/nbaSchedule';
import { calculateGameFantasyPoints } from '@/utils/fantasyPoints';
import { useLeagueRosterConfig, RosterConfigSlot } from '@/hooks/useLeagueRosterConfig';
import { slotLabel } from '@/utils/rosterSlots';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import {
  FlatList,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Week {
  id: string;
  week_number: number;
  start_date: string;
  end_date: string;
  is_playoff: boolean;
}

interface Matchup {
  id: string;
  home_team_id: string;
  away_team_id: string | null;
  home_score: number;
  away_score: number;
  playoff_round: number | null;
}

interface TeamMatchupData {
  teamId: string;
  teamName: string;
  players: RosterPlayer[];
  weekTotal: number;
  dayTotal: number;
  teamStats: TeamStatTotals;
}

interface MatchupSlotEntry {
  slotPosition: string;
  slotIndex: number;
  player: RosterPlayer | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────


function formatWeekRange(start: string, end: string): string {
  const s = parseLocalDate(start);
  const e = parseLocalDate(end);
  const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${fmt(s)} – ${fmt(e)}`;
}

// Build a fixed-length array of slot entries from the roster config, mapping players into their slots.
// Empty slots show as null. This ensures both teams always display the same number of rows.
function buildMatchupSlots(
  players: RosterPlayer[],
  config: RosterConfigSlot[],
): MatchupSlotEntry[] {
  const activeConfigs = config.filter((c) => c.position !== 'BE' && c.position !== 'IR');
  const slots: MatchupSlotEntry[] = [];

  for (const cfg of activeConfigs) {
    if (cfg.position === 'UTIL') {
      for (let i = 0; i < cfg.slot_count; i++) {
        const numberedSlot = `UTIL${i + 1}`;
        const player = players.find((p) => p.roster_slot === numberedSlot) ?? null;
        slots.push({ slotPosition: numberedSlot, slotIndex: i, player });
      }
    } else {
      const inSlot = players.filter((p) => p.roster_slot === cfg.position);
      for (let i = 0; i < cfg.slot_count; i++) {
        slots.push({
          slotPosition: cfg.position,
          slotIndex: i,
          player: inSlot[i] ?? null,
        });
      }
    }
  }
  return slots;
}


// ─── Data fetching ────────────────────────────────────────────────────────────

async function fetchWeeks(leagueId: string): Promise<Week[]> {
  const { data, error } = await supabase
    .from('league_schedule')
    .select('id, week_number, start_date, end_date, is_playoff')
    .eq('league_id', leagueId)
    .order('week_number', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

async function fetchMatchupForWeek(scheduleId: string, teamId: string): Promise<Matchup | null> {
  const { data, error } = await supabase
    .from('league_matchups')
    .select('id, home_team_id, away_team_id, home_score, away_score, playoff_round')
    .eq('schedule_id', scheduleId)
    .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function fetchTeamName(teamId: string): Promise<string> {
  const { data } = await supabase.from('teams').select('name').eq('id', teamId).single();
  return data?.name ?? 'Unknown Team';
}

async function fetchTeamData(
  teamId: string,
  leagueId: string,
  week: Week,
  selectedDate: string,
  scoring: ScoringWeight[]
): Promise<{ players: RosterPlayer[]; teamStats: Record<string, number> }> {
  const { data: leaguePlayers, error: lpErr } = await supabase
    .from('league_players')
    .select('player_id, roster_slot, players(name, position, nba_team, external_id_nba, status)')
    .eq('team_id', teamId)
    .eq('league_id', leagueId);

  if (lpErr) throw lpErr;
  if (!leaguePlayers || leaguePlayers.length === 0) return { players: [], teamStats: {} };

  const playerIds = leaguePlayers.map((lp: any) => lp.player_id);

  const defaultSlotMap = new Map<string, string>(
    leaguePlayers.map((lp: any) => [lp.player_id, lp.roster_slot ?? 'BE'])
  );

  const { data: dailyEntries } = await supabase
    .from('daily_lineups')
    .select('player_id, roster_slot, lineup_date')
    .eq('team_id', teamId)
    .eq('league_id', leagueId)
    .lte('lineup_date', week.end_date)
    .order('lineup_date', { ascending: false });

  const dailyByPlayer = new Map<string, Array<{ lineup_date: string; roster_slot: string }>>();
  for (const entry of dailyEntries ?? []) {
    if (!dailyByPlayer.has(entry.player_id)) {
      dailyByPlayer.set(entry.player_id, []);
    }
    dailyByPlayer.get(entry.player_id)!.push(entry);
  }

  const resolveSlot = (playerId: string, day: string): string => {
    const entries = dailyByPlayer.get(playerId) ?? [];
    const entry = entries.find((e) => e.lineup_date <= day);
    return entry?.roster_slot ?? defaultSlotMap.get(playerId) ?? 'BE';
  };

  // Fetch past game logs for the week (excludes today — live data covers that)
  const today = toDateStr(new Date());
  const weekEndForQuery = selectedDate >= today ? addDays(today, -1) : week.end_date;

  const { data: gameLogs } = await supabase
    .from('player_games')
    .select('player_id, pts, reb, ast, stl, blk, tov, fgm, fga, "3pm", "3pa", ftm, fta, pf, double_double, triple_double, game_date, matchup')
    .in('player_id', playerIds)
    .gte('game_date', week.start_date)
    .lte('game_date', weekEndForQuery);

  const weekPointsMap = new Map<string, number>();
  const dayPointsMap = new Map<string, number>();
  const dayMatchupMap = new Map<string, string>();
  const dayStatsMap = new Map<string, Record<string, number>>();
  const activeGames: Record<string, any>[] = [];

  for (const game of gameLogs ?? []) {
    const slot = resolveSlot(game.player_id, game.game_date);
    if (slot === 'BE' || slot === 'IR') continue;

    activeGames.push(game);
    const fp = calculateGameFantasyPoints(game as any, scoring);
    weekPointsMap.set(game.player_id, (weekPointsMap.get(game.player_id) ?? 0) + fp);

    if (game.game_date === selectedDate) {
      dayPointsMap.set(game.player_id, (dayPointsMap.get(game.player_id) ?? 0) + fp);
      if (game.matchup) dayMatchupMap.set(game.player_id, game.matchup);
      dayStatsMap.set(game.player_id, {
        pts: game.pts, reb: game.reb, ast: game.ast, stl: game.stl,
        blk: game.blk, tov: game.tov, fgm: game.fgm, fga: game.fga,
        '3pm': game['3pm'], ftm: game.ftm, fta: game.fta, pf: game.pf,
      });
    }
  }

  const teamStats = aggregateTeamStats(activeGames);

  return { players: leaguePlayers.map((lp: any) => ({
      player_id: lp.player_id,
      name: lp.players?.name ?? '—',
      position: lp.players?.position ?? '—',
      nba_team: lp.players?.nba_team ?? '—',
      external_id_nba: lp.players?.external_id_nba ?? null,
      status: lp.players?.status ?? 'active',
      nbaTricode: (() => {
        const t = lp.players?.nba_team ?? '';
        return t && t !== 'Active' && t !== 'Inactive' ? t : null;
      })(),
      roster_slot: resolveSlot(lp.player_id, selectedDate),
      weekPoints: round1(weekPointsMap.get(lp.player_id) ?? 0),
      dayPoints: round1(dayPointsMap.get(lp.player_id) ?? 0),
      dayMatchup: dayMatchupMap.get(lp.player_id) ?? null,
      dayStatLine: (() => {
        const ds = dayStatsMap.get(lp.player_id);
        return ds ? buildStatLine(ds, scoring) : null;
      })(),
    })), teamStats };
}

// Fetch seeds for a specific team in the current playoff round
async function fetchTeamSeeds(
  leagueId: string,
  season: string,
  round: number,
): Promise<Map<string, number>> {
  const { data, error } = await supabase
    .from('playoff_bracket')
    .select('team_a_id, team_a_seed, team_b_id, team_b_seed')
    .eq('league_id', leagueId)
    .eq('season', season)
    .eq('round', round);
  if (error) throw error;
  const map = new Map<string, number>();
  for (const row of data ?? []) {
    if (row.team_a_id && row.team_a_seed) map.set(row.team_a_id, row.team_a_seed);
    if (row.team_b_id && row.team_b_seed) map.set(row.team_b_id, row.team_b_seed);
  }
  return map;
}

async function fetchWeekMatchupData(
  week: Week,
  teamId: string,
  leagueId: string,
  selectedDate: string,
  scoring: ScoringWeight[]
): Promise<{ myTeam: TeamMatchupData; opponentTeam: TeamMatchupData | null; week: Week } | null> {
  const matchup = await fetchMatchupForWeek(week.id, teamId);
  if (!matchup) return null;

  const opponentId =
    matchup.home_team_id === teamId ? matchup.away_team_id : matchup.home_team_id;

  const [myResult, myName] = await Promise.all([
    fetchTeamData(teamId, leagueId, week, selectedDate, scoring),
    fetchTeamName(teamId),
  ]);

  let opponentTeam: TeamMatchupData | null = null;
  if (opponentId) {
    const [oppResult, oppName] = await Promise.all([
      fetchTeamData(opponentId, leagueId, week, selectedDate, scoring),
      fetchTeamName(opponentId),
    ]);
    opponentTeam = {
      teamId: opponentId,
      teamName: oppName,
      players: oppResult.players,
      weekTotal: round1(oppResult.players.reduce((s, p) => s + p.weekPoints, 0)),
      dayTotal: round1(oppResult.players.reduce((s, p) => s + p.dayPoints, 0)),
      teamStats: oppResult.teamStats,
    };
  }

  return {
    myTeam: {
      teamId,
      teamName: myName,
      players: myResult.players,
      weekTotal: round1(myResult.players.reduce((s, p) => s + p.weekPoints, 0)),
      dayTotal: round1(myResult.players.reduce((s, p) => s + p.dayPoints, 0)),
      teamStats: myResult.teamStats,
    },
    opponentTeam,
    week,
  };
}


// ─── Hooks ────────────────────────────────────────────────────────────────────

function useWeeks(leagueId: string | null) {
  return useQuery({
    queryKey: ['leagueSchedule', leagueId],
    queryFn: () => fetchWeeks(leagueId!),
    enabled: !!leagueId,
    staleTime: 1000 * 60 * 10,
  });
}

function useWeekMatchup(
  weeks: Week[] | undefined,
  selectedDate: string,
  teamId: string | null,
  leagueId: string | null,
  scoring: ScoringWeight[]
) {
  const week = weeks?.find((w) => w.start_date <= selectedDate && selectedDate <= w.end_date) ?? null;

  return useQuery({
    queryKey: ['weekMatchup', leagueId, week?.id, teamId, selectedDate],
    queryFn: () => {
      if (!week || !teamId || !leagueId) return null;
      return fetchWeekMatchupData(week, teamId, leagueId, selectedDate, scoring);
    },
    enabled: !!week && !!teamId && !!leagueId && scoring.length > 0,
    staleTime: 1000 * 60 * 2,
    placeholderData: (prev, prevQuery) => {
      // Only keep previous data when navigating within the same league
      const prevKey = prevQuery?.queryKey as string[] | undefined;
      if (prevKey && prevKey[1] === leagueId) return prev;
      return undefined;
    },
  });
}

// Renders the full matchup: score headers + slot rows with center position labels
function MatchupBoard({
  myTeam,
  opponentTeam,
  mySlots,
  oppSlots,
  c,
  mode,
  liveMap,
  scoring,
  myLiveBonus,
  oppLiveBonus,
  futureSchedule,
  seedMap,
  onPlayerPress,
  scoringType,
}: {
  myTeam: TeamMatchupData;
  opponentTeam: TeamMatchupData | null;
  mySlots: MatchupSlotEntry[];
  oppSlots: MatchupSlotEntry[];
  c: any;
  mode: DisplayMode;
  liveMap: Map<string, LivePlayerStats>;
  scoring: ScoringWeight[];
  myLiveBonus: number;
  oppLiveBonus: number;
  futureSchedule?: Map<string, string>;
  seedMap?: Map<string, number>;
  onPlayerPress?: (playerId: string) => void;
  scoringType?: string;
}) {
  const isCategories = scoringType === 'h2h_categories';
  const myWeek = round1(myTeam.weekTotal + myLiveBonus);
  const myDay = round1(myTeam.dayTotal + myLiveBonus);
  const oppWeek = opponentTeam ? round1(opponentTeam.weekTotal + oppLiveBonus) : 0;
  const oppDay = opponentTeam ? round1(opponentTeam.dayTotal + oppLiveBonus) : 0;

  // For category leagues, compute live category comparison
  const categoryComparison = isCategories && opponentTeam
    ? computeCategoryResults(
        myTeam.teamStats,
        opponentTeam.teamStats,
        scoring.filter((s) => s.is_enabled).map((s) => ({ stat_name: s.stat_name, inverse: s.inverse })),
      )
    : null;

  // Use the longer slot list (should always be the same length)
  const slotCount = Math.max(mySlots.length, oppSlots.length);

  return (
    <View>
      {/* Score header: [My Team] vs [Opponent] */}
      {isCategories && categoryComparison ? (
        <View style={{ marginBottom: 14 }}>
          <CategoryScoreboard
            results={categoryComparison.results}
            homeWins={categoryComparison.homeWins}
            awayWins={categoryComparison.awayWins}
            ties={categoryComparison.ties}
            homeTeamName={`${seedMap?.has(myTeam.teamId) ? `#${seedMap.get(myTeam.teamId)} ` : ''}${myTeam.teamName}`}
            awayTeamName={opponentTeam
              ? `${opponentTeam.teamName}${seedMap?.has(opponentTeam.teamId) ? ` #${seedMap.get(opponentTeam.teamId)}` : ''}`
              : 'BYE'}
          />
        </View>
      ) : (
        <View
          style={colStyles.scoreHeader}
          accessibilityRole="summary"
          accessibilityLabel={`${myTeam.teamName} ${myWeek.toFixed(1)} versus ${opponentTeam ? `${opponentTeam.teamName} ${oppWeek.toFixed(1)}` : 'BYE'}`}
        >
          <View style={[colStyles.scoreCol, { alignItems: 'flex-start' }]}>
            <Text style={[colStyles.teamName, { color: c.text }]} numberOfLines={1} accessibilityRole="header">
              {seedMap?.has(myTeam.teamId) ? `#${seedMap.get(myTeam.teamId)} ` : ''}{myTeam.teamName}
            </Text>
            <Text style={[colStyles.total, { color: c.accent }]}>{myWeek.toFixed(1)}</Text>
            {mode !== 'future' && (
              <Text style={[colStyles.dayTotal, { color: c.secondaryText }]}>{myDay.toFixed(1)} today</Text>
            )}
          </View>
          <Text style={[colStyles.vsText, { color: c.secondaryText }]} accessible={false}>vs</Text>
          <View style={[colStyles.scoreCol, { alignItems: 'flex-end' }]}>
            <Text style={[colStyles.teamName, { color: c.text, textAlign: 'right' }]} numberOfLines={1} accessibilityRole="header">
              {opponentTeam
                ? `${opponentTeam.teamName}${seedMap?.has(opponentTeam.teamId) ? ` #${seedMap.get(opponentTeam.teamId)}` : ''}`
                : 'BYE'}
            </Text>
            <Text style={[colStyles.total, { color: c.accent }]}>{oppWeek.toFixed(1)}</Text>
            {mode !== 'future' && (
              <Text style={[colStyles.dayTotal, { color: c.secondaryText }]}>{oppDay.toFixed(1)} today</Text>
            )}
          </View>
        </View>
      )}

      {/* Slot rows: [left player] [POS] [right player] */}
      {Array.from({ length: slotCount }).map((_, i) => {
        const mySlot = mySlots[i] ?? null;
        const oppSlot = oppSlots[i] ?? null;
        const slotPos = mySlot?.slotPosition ?? oppSlot?.slotPosition ?? '';

        return (
          <View key={`slot-${i}`} style={[pStyles.slotRow, { borderBottomColor: c.border }]}>
            <PlayerCell
              player={mySlot?.player ?? null}
              c={c}
              side="left"
              mode={mode}
              liveStats={mySlot?.player ? (liveMap.get(mySlot.player.player_id) ?? null) : null}
              scoring={scoring}
              futureSchedule={futureSchedule}
              onPress={onPlayerPress}
              isCategories={isCategories}
            />
            <View style={pStyles.slotCenter}>
              <Text style={[pStyles.slotText, { color: c.secondaryText }]}>
                {slotLabel(slotPos)}
              </Text>
            </View>
            <PlayerCell
              player={oppSlot?.player ?? null}
              c={c}
              side="right"
              mode={mode}
              liveStats={oppSlot?.player ? (liveMap.get(oppSlot.player.player_id) ?? null) : null}
              scoring={scoring}
              futureSchedule={futureSchedule}
              onPress={onPlayerPress}
              isCategories={isCategories}
            />
          </View>
        );
      })}
    </View>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function MatchupScreen() {
  const { leagueId, teamId } = useAppState();
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  const { data: weeks, isLoading: weeksLoading } = useWeeks(leagueId);
  const { data: league } = useLeague();
  const { data: scoring } = useLeagueScoring(leagueId ?? '');
  const { data: rosterConfig } = useLeagueRosterConfig(leagueId ?? '');

  const today = useToday();
  const [selectedDate, setSelectedDate] = useState<string>(today);
  const [scheduleVisible, setScheduleVisible] = useState(false);
  const [selectedPlayer, setSelectedPlayer] = useState<PlayerSeasonStats | null>(null);

  const handlePlayerPress = async (playerId: string) => {
    const { data } = await supabase
      .from('player_season_stats')
      .select('*')
      .eq('player_id', playerId)
      .maybeSingle();
    if (data) setSelectedPlayer(data as PlayerSeasonStats);
  };

  // Reset to today when switching leagues so stale data doesn't linger
  const prevLeague = useRef(leagueId);
  useEffect(() => {
    if (leagueId !== prevLeague.current) {
      setSelectedDate(today);
      prevLeague.current = leagueId;
    }
  }, [leagueId]);

  // If the calendar date rolled over (e.g. app resumed from background after midnight), snap to today
  const prevToday = useRef(today);
  useEffect(() => {
    if (today !== prevToday.current) {
      if (selectedDate === prevToday.current) setSelectedDate(today);
      prevToday.current = today;
    }
  }, [today]);


  const minDate = weeks?.[0]?.start_date ?? today;
  const maxDate = weeks?.[weeks.length - 1]?.end_date ?? today;

  const currentWeek = weeks?.find(
    (w) => w.start_date <= selectedDate && selectedDate <= w.end_date
  ) ?? null;

  const { data: matchupData, isLoading: matchupLoading, isError: matchupError, refetch: refetchMatchup } = useWeekMatchup(
    weeks,
    selectedDate,
    teamId,
    leagueId,
    scoring ?? []
  );

  // Collect all player IDs from both teams for live stat subscription
  const allPlayerIds: string[] = matchupData
    ? [
        ...matchupData.myTeam.players.map((p) => p.player_id),
        ...(matchupData.opponentTeam?.players.map((p) => p.player_id) ?? []),
      ]
    : [];

  const isToday = selectedDate === today;
  const isFutureDate = selectedDate > today;
  const liveMap = useLivePlayerStats(allPlayerIds, isToday);

  // Future schedule: tricode → matchup string for the selected future date
  const { data: futureSchedule } = useQuery<Map<string, string>>({
    queryKey: ['futureSchedule', selectedDate],
    queryFn: () => fetchNbaScheduleForDate(selectedDate),
    enabled: isToday || isFutureDate,
    staleTime: 1000 * 60 * 60,
  });

  const queryClient = useQueryClient();

  // Prefetch adjacent days to reduce pop-in when navigating
  useEffect(() => {
    if (!weeks || !teamId || !leagueId || !scoring || scoring.length === 0) return;
    const adjacent = [addDays(selectedDate, -1), addDays(selectedDate, 1), addDays(selectedDate, 2)];
    const todayStr = toDateStr(new Date());

    for (const day of adjacent) {
      const wk = weeks.find((w) => w.start_date <= day && day <= w.end_date);
      if (!wk) continue;

      queryClient.prefetchQuery({
        queryKey: ['weekMatchup', leagueId, wk.id, teamId, day],
        queryFn: () => fetchWeekMatchupData(wk, teamId, leagueId, day, scoring),
        staleTime: 1000 * 60 * 2,
      });

      if (day >= todayStr) {
        queryClient.prefetchQuery({
          queryKey: ['futureSchedule', day],
          queryFn: () => fetchNbaScheduleForDate(day),
          staleTime: 1000 * 60 * 60,
        });
      }
    }
  }, [selectedDate, weeks, teamId, leagueId, scoring]);

  // Playoff seeds for current round
  const playoffRound = currentWeek?.is_playoff
    ? (matchupData as any)?.week?.is_playoff ? null : null // need the matchup's playoff_round
    : null;
  // We get playoff_round from the matchup data. The useWeekMatchup hook fetches from league_matchups
  // but doesn't expose playoff_round directly. Let's fetch seeds based on the week.
  const { data: seedMap } = useQuery({
    queryKey: ['matchupSeeds', leagueId, currentWeek?.week_number],
    queryFn: async () => {
      // Find the playoff round: query any matchup in this schedule week
      const { data: matchups } = await supabase
        .from('league_matchups')
        .select('playoff_round')
        .eq('schedule_id', currentWeek!.id)
        .not('playoff_round', 'is', null)
        .limit(1);
      const round = matchups?.[0]?.playoff_round;
      if (!round) return new Map<string, number>();
      return fetchTeamSeeds(leagueId!, CURRENT_NBA_SEASON, round);
    },
    enabled: !!leagueId && !!currentWeek?.is_playoff,
    staleTime: 1000 * 60 * 5,
  });

  const mode: DisplayMode = selectedDate < today ? 'past' : selectedDate === today ? 'today' : 'future';

  const isBye = matchupData && matchupData.opponentTeam === null;
  const isPlayoffBye = isBye && currentWeek?.is_playoff;

  // Compute how much live FPTS to add to each team's week total
  function computeLiveBonus(players: RosterPlayer[]): number {
    if (!isToday) return 0;
    return round1(
      players.reduce((sum, p) => {
        if (p.roster_slot === 'BE' || p.roster_slot === 'IR') return sum;
        const live = liveMap.get(p.player_id);
        if (!live) return sum;
        return sum + calculateGameFantasyPoints(liveToGameLog(live) as any, scoring ?? []);
      }, 0)
    );
  }

  if (!leagueId) {
    return (
      <ThemedView style={styles.center}>
        <ThemedText>Join or create a league to see matchups.</ThemedText>
      </ThemedView>
    );
  }

  if (weeksLoading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: c.background }]}>
        {/* Placeholder day nav */}
        <View style={[styles.dayNav, { borderBottomColor: c.border }]}>
          <View style={styles.navArrow}><Text style={[styles.arrow, { color: c.buttonDisabled }]}>‹</Text></View>
          <View style={styles.dayInfo}>
            <SkeletonBlock width={120} height={16} color={c.border} />
            <SkeletonBlock width={160} height={11} color={c.border} style={{ marginTop: 4 }} />
          </View>
          <View style={styles.navArrow}><Text style={[styles.arrow, { color: c.buttonDisabled }]}>›</Text></View>
        </View>
        <MatchupSkeleton c={c} />
      </SafeAreaView>
    );
  }

  if (!weeks || weeks.length === 0) {
    return (
      <ThemedView style={styles.center}>
        <ThemedText type="defaultSemiBold">Season not started yet.</ThemedText>
        <ThemedText style={{ color: c.secondaryText, marginTop: 6, textAlign: 'center' }}>
          The commissioner needs to generate the schedule after the draft.
        </ThemedText>
      </ThemedView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.background }]}>
      {/* Day navigation */}
      <View style={[styles.dayNav, { borderBottomColor: c.border }]}>
        <TouchableOpacity
          disabled={selectedDate <= minDate}
          onPress={() => setSelectedDate(addDays(selectedDate, -1))}
          style={styles.navArrow}
          accessibilityRole="button"
          accessibilityLabel="Previous day"
          accessibilityState={{ disabled: selectedDate <= minDate }}
        >
          <Text style={[styles.arrow, { color: selectedDate <= minDate ? c.buttonDisabled : c.text }]}>
            ‹
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.dayInfo}
          onPress={() => setScheduleVisible(true)}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={`${formatDayLabel(selectedDate)}${currentWeek ? `, Week ${currentWeek.week_number}` : ', outside season'}`}
          accessibilityHint="Opens week schedule picker"
        >
          <ThemedText type="defaultSemiBold" style={styles.dayLabel}>
            {formatDayLabel(selectedDate)} ▾
          </ThemedText>
          {currentWeek && (
            <ThemedText style={[styles.weekMeta, { color: c.secondaryText }]}>
              {currentWeek.is_playoff ? 'Playoffs · ' : ''}Week {currentWeek.week_number} · {formatWeekRange(currentWeek.start_date, currentWeek.end_date)}
            </ThemedText>
          )}
          {!currentWeek && (
            <ThemedText style={[styles.weekMeta, { color: c.secondaryText }]}>
              Outside season
            </ThemedText>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          disabled={selectedDate >= maxDate}
          onPress={() => setSelectedDate(addDays(selectedDate, 1))}
          style={styles.navArrow}
          accessibilityRole="button"
          accessibilityLabel="Next day"
          accessibilityState={{ disabled: selectedDate >= maxDate }}
        >
          <Text style={[styles.arrow, { color: selectedDate >= maxDate ? c.buttonDisabled : c.text }]}>
            ›
          </Text>
        </TouchableOpacity>
      </View>

      {/* Matchup body */}
      <ScrollView contentContainerStyle={styles.body}>
        {matchupLoading && <MatchupSkeleton c={c} />}

        {!matchupLoading && matchupError && (
          <ErrorState message="Failed to load matchup" onRetry={() => refetchMatchup()} />
        )}

        {!matchupLoading && !matchupError && !currentWeek && (
          <View style={styles.center}>
            <ThemedText style={{ color: c.secondaryText }}>No matchup for this date.</ThemedText>
          </View>
        )}

        {!matchupLoading && !matchupError && currentWeek && !matchupData && (
          <View style={styles.center}>
            <ThemedText style={{ color: c.secondaryText }}>
              {currentWeek.is_playoff
                ? 'Your team is not in the playoffs this week.'
                : 'No matchup found for this week.'}
            </ThemedText>
          </View>
        )}

        {!matchupLoading && matchupData && (
          <>
            {isBye && (
              <View style={[styles.byeBanner, { backgroundColor: c.card }]}>
                <ThemedText type="defaultSemiBold">
                  {isPlayoffBye ? 'Playoff Bye Round' : 'Bye Week'}
                </ThemedText>
                {isPlayoffBye && (
                  <ThemedText style={{ color: c.secondaryText, fontSize: 13, marginTop: 4 }}>
                    Your team advances automatically as a top seed.
                  </ThemedText>
                )}
              </View>
            )}

            <MatchupBoard
              myTeam={matchupData.myTeam}
              opponentTeam={matchupData.opponentTeam}
              mySlots={rosterConfig ? buildMatchupSlots(matchupData.myTeam.players, rosterConfig) : []}
              oppSlots={rosterConfig && matchupData.opponentTeam ? buildMatchupSlots(matchupData.opponentTeam.players, rosterConfig) : []}
              c={c}
              mode={mode}
              liveMap={liveMap}
              scoring={scoring ?? []}
              myLiveBonus={computeLiveBonus(matchupData.myTeam.players)}
              oppLiveBonus={matchupData.opponentTeam ? computeLiveBonus(matchupData.opponentTeam.players) : 0}
              futureSchedule={futureSchedule}
              seedMap={seedMap ?? undefined}
              onPlayerPress={handlePlayerPress}
              scoringType={league?.scoring_type}
            />

          </>
        )}
      </ScrollView>

      <PlayerDetailModal
        player={selectedPlayer}
        leagueId={leagueId ?? ''}
        teamId={teamId ?? undefined}
        onClose={() => setSelectedPlayer(null)}
      />

      {/* Schedule dropdown modal */}
      <Modal
        visible={scheduleVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setScheduleVisible(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setScheduleVisible(false)}
          accessibilityRole="button"
          accessibilityLabel="Close schedule picker"
        >
          <View style={[styles.scheduleSheet, { backgroundColor: c.background, borderColor: c.border }]}>
            <ThemedText type="defaultSemiBold" style={styles.scheduleTitle} accessibilityRole="header">
              Schedule
            </ThemedText>
            <FlatList
              data={weeks}
              keyExtractor={(w) => w.id}
              renderItem={({ item: w }) => {
                const isActive = currentWeek?.id === w.id;
                return (
                  <TouchableOpacity
                    style={[
                      styles.scheduleRow,
                      { borderBottomColor: c.border },
                      isActive && { backgroundColor: c.card },
                    ]}
                    onPress={() => {
                      const jumpDate =
                        today >= w.start_date && today <= w.end_date
                          ? today
                          : w.start_date;
                      setSelectedDate(jumpDate);
                      setScheduleVisible(false);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={`${w.is_playoff ? 'Playoffs, ' : ''}Week ${w.week_number}, ${formatWeekRange(w.start_date, w.end_date)}`}
                    accessibilityState={{ selected: isActive }}
                  >
                    <ThemedText
                      style={[styles.scheduleWeekLabel, isActive && { color: c.accent }]}
                    >
                      {w.is_playoff ? 'Playoffs · ' : ''}Week {w.week_number}
                    </ThemedText>
                    <ThemedText style={[styles.scheduleWeekRange, { color: c.secondaryText }]}>
                      {formatWeekRange(w.start_date, w.end_date)}
                    </ThemedText>
                  </TouchableOpacity>
                );
              }}
            />
          </View>
        </TouchableOpacity>
      </Modal>

    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  dayNav: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  navArrow: { padding: 12 },
  arrow: { fontSize: 28, lineHeight: 32 },
  dayInfo: { flex: 1, alignItems: 'center' },
  dayLabel: { fontSize: 16 },
  weekMeta: { fontSize: 11, marginTop: 2 },
  body: { padding: 12, paddingBottom: 56, flexGrow: 1 },
  byeBanner: { borderRadius: 8, padding: 16, alignItems: 'center', marginBottom: 12 },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  scheduleSheet: {
    width: '80%',
    maxHeight: '70%',
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  scheduleTitle: {
    fontSize: 16,
    padding: 16,
    paddingBottom: 12,
  },
  scheduleRow: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  scheduleWeekLabel: { fontSize: 14, fontWeight: '600' },
  scheduleWeekRange: { fontSize: 12, marginTop: 2 },
});

const colStyles = StyleSheet.create({
  scoreHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  scoreCol: { flex: 1 },
  vsText: { fontSize: 12, fontWeight: '600', marginHorizontal: 10 },
  teamName: { fontWeight: '600', fontSize: 14, marginBottom: 2 },
  total: { fontSize: 20, fontWeight: '700' },
  dayTotal: { fontSize: 11, fontWeight: '500', marginTop: 2 },
});

