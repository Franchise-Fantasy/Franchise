import { ErrorState } from '@/components/ErrorState';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { Colors } from '@/constants/Colors';
import { CURRENT_NBA_SEASON } from '@/constants/LeagueDefaults';
import { useAppState } from '@/context/AppStateProvider';
import { useColorScheme } from '@/hooks/useColorScheme';
import { supabase } from '@/lib/supabase';
import { ScoringWeight } from '@/types/player';
import { formatGameInfo, LivePlayerStats, useLivePlayerStats } from '@/utils/nbaLive';
import { calculateGameFantasyPoints } from '@/utils/fantasyPoints';
import { getInjuryBadge } from '@/utils/injuryBadge';
import { useLeagueRosterConfig, RosterConfigSlot } from '@/hooks/useLeagueRosterConfig';
import { SLOT_LABELS } from '@/utils/rosterSlots';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  ActivityIndicator,
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

interface RosterPlayer {
  player_id: string;
  name: string;
  position: string;
  nba_team: string;
  nbaTricode: string | null; // real tricode from players.nba_team (e.g. "OKC")
  roster_slot: string;
  external_id_nba: number | null;
  status: string;
  weekPoints: number;
  dayPoints: number;
  // matchup string for past-date or future-date display (e.g. "vs MIA", "@BOS")
  dayMatchup: string | null;
  // stat line for past dates (e.g. "20 PTS · 8 REB · 5 AST")
  dayStatLine: string | null;
}

interface TeamMatchupData {
  teamId: string;
  teamName: string;
  players: RosterPlayer[];
  weekTotal: number;
  dayTotal: number;
}

interface MatchupSlotEntry {
  slotPosition: string;
  slotIndex: number;
  player: RosterPlayer | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toDateStr(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseLocalDate(str: string): Date {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function addDays(dateStr: string, n: number): string {
  const d = parseLocalDate(dateStr);
  d.setDate(d.getDate() + n);
  return toDateStr(d);
}

function formatDayLabel(dateStr: string): string {
  return parseLocalDate(dateStr).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function formatWeekRange(start: string, end: string): string {
  const s = parseLocalDate(start);
  const e = parseLocalDate(end);
  const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${fmt(s)} – ${fmt(e)}`;
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}

// Build a stat line string for a live/historical stat object.
// Only includes stats that the league actually scores.
function buildStatLine(
  stats: Record<string, number>,
  scoring: ScoringWeight[]
): string {
  // Ordered display labels for each scoring stat key
  const DISPLAY: Record<string, string> = {
    PTS: 'PTS',
    REB: 'REB',
    AST: 'AST',
    STL: 'STL',
    BLK: 'BLK',
    TO: 'TO',
    '3PM': '3PM',
    FGM: 'FGM',
    FGA: 'FGA',
    FTM: 'FTM',
    FTA: 'FTA',
    PF: 'PF',
  };
  // Map scoring stat_name → stat value from the stats object
  const LIVE_KEY: Record<string, string> = {
    PTS: 'pts', REB: 'reb', AST: 'ast', STL: 'stl', BLK: 'blk',
    TO: 'tov', '3PM': '3pm', FGM: 'fgm', FGA: 'fga', FTM: 'ftm',
    FTA: 'fta', PF: 'pf',
  };

  const scoredStatNames = new Set(scoring.map((w) => w.stat_name));
  // Always show PF if the table has it, even if not scored (optional: only show scored stats)
  const toShow = ['PTS', 'REB', 'AST', 'STL', 'BLK', 'TO', '3PM', 'PF'].filter(
    (key) => scoredStatNames.has(key) || key === 'PF'
  );

  return toShow
    .map((key) => {
      const val = stats[LIVE_KEY[key]] ?? 0;
      return `${val} ${DISPLAY[key]}`;
    })
    .join(' · ');
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
    const inSlot = players.filter((p) => p.roster_slot === cfg.position);
    for (let i = 0; i < cfg.slot_count; i++) {
      slots.push({
        slotPosition: cfg.position,
        slotIndex: i,
        player: inSlot[i] ?? null,
      });
    }
  }
  return slots;
}

// Convert a LivePlayerStats row to the shape calculateGameFantasyPoints expects
function liveToGameLog(live: LivePlayerStats): Record<string, number> {
  return {
    pts: live.pts,
    reb: live.reb,
    ast: live.ast,
    stl: live.stl,
    blk: live.blk,
    tov: live.tov,
    fgm: live.fgm,
    fga: live.fga,
    '3pm': live['3pm'],
    ftm: live.ftm,
    fta: live.fta,
    pf: live.pf,
  };
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
): Promise<RosterPlayer[]> {
  const { data: leaguePlayers, error: lpErr } = await supabase
    .from('league_players')
    .select('player_id, roster_slot, players(name, position, nba_team, external_id_nba, status)')
    .eq('team_id', teamId)
    .eq('league_id', leagueId);

  if (lpErr) throw lpErr;
  if (!leaguePlayers || leaguePlayers.length === 0) return [];

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

  for (const game of gameLogs ?? []) {
    const slot = resolveSlot(game.player_id, game.game_date);
    if (slot === 'BE' || slot === 'IR') continue;

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

  return leaguePlayers.map((lp: any) => ({
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
    }));
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

  const [myPlayers, myName] = await Promise.all([
    fetchTeamData(teamId, leagueId, week, selectedDate, scoring),
    fetchTeamName(teamId),
  ]);

  let opponentTeam: TeamMatchupData | null = null;
  if (opponentId) {
    const [oppPlayers, oppName] = await Promise.all([
      fetchTeamData(opponentId, leagueId, week, selectedDate, scoring),
      fetchTeamName(opponentId),
    ]);
    opponentTeam = {
      teamId: opponentId,
      teamName: oppName,
      players: oppPlayers,
      weekTotal: round1(oppPlayers.reduce((s, p) => s + p.weekPoints, 0)),
      dayTotal: round1(oppPlayers.reduce((s, p) => s + p.dayPoints, 0)),
    };
  }

  return {
    myTeam: {
      teamId,
      teamName: myName,
      players: myPlayers,
      weekTotal: round1(myPlayers.reduce((s, p) => s + p.weekPoints, 0)),
      dayTotal: round1(myPlayers.reduce((s, p) => s + p.dayPoints, 0)),
    },
    opponentTeam,
    week,
  };
}

async function fetchScheduleForDate(date: string): Promise<Map<string, string>> {
  const { data } = await supabase
    .from('nba_schedule')
    .select('home_team, away_team')
    .eq('game_date', date);
  const map = new Map<string, string>();
  for (const game of data ?? []) {
    map.set(game.home_team, `vs ${game.away_team}`);
    map.set(game.away_team, `@${game.home_team}`);
  }
  return map;
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

function useScoring(leagueId: string | null) {
  return useQuery<ScoringWeight[]>({
    queryKey: ['leagueScoring', leagueId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('league_scoring_settings')
        .select('stat_name, point_value')
        .eq('league_id', leagueId!);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!leagueId,
    staleTime: 1000 * 60 * 60,
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
    queryKey: ['weekMatchup', week?.id, teamId, selectedDate],
    queryFn: () => {
      if (!week || !teamId || !leagueId) return null;
      return fetchWeekMatchupData(week, teamId, leagueId, selectedDate, scoring);
    },
    enabled: !!week && !!teamId && !!leagueId && scoring.length > 0,
    staleTime: 1000 * 60 * 2,
    placeholderData: keepPreviousData,
  });
}

// ─── Sub-components ───────────────────────────────────────────────────────────

type DisplayMode = 'past' | 'today' | 'future';

// Static green dot shown when player is actively on the floor.
function OnCourtDot() {
  return <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#2dc653', marginRight: 2 }} />;
}

// Pops on value change (1 → 1.35 → 1 spring)
function AnimatedFpts({
  value,
  activeColor,
  dimColor,
  textStyle,
}: {
  value: number | null;
  activeColor: string;
  dimColor: string;
  textStyle: any;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const prev = useRef<number | null | undefined>(undefined);

  useEffect(() => {
    if (prev.current !== undefined && value !== prev.current) {
      Animated.sequence([
        Animated.timing(scale, { toValue: 1.35, duration: 150, useNativeDriver: true }),
        Animated.spring(scale, { toValue: 1, useNativeDriver: true, bounciness: 12 }),
      ]).start();
    }
    prev.current = value;
  }, [value]);

  return (
    <Animated.Text style={[textStyle, { transform: [{ scale }], color: value !== null ? activeColor : dimColor }]}>
      {value !== null ? value.toFixed(1) : '—'}
    </Animated.Text>
  );
}

// Renders a single player cell (one side of a matchup row). No slot badge — that's in the center.
function PlayerCell({
  player,
  c,
  side,
  mode,
  liveStats,
  scoring,
  futureSchedule,
}: {
  player: RosterPlayer | null;
  c: any;
  side: 'left' | 'right';
  mode: DisplayMode;
  liveStats: LivePlayerStats | null;
  scoring: ScoringWeight[];
  futureSchedule?: Map<string, string>;
}) {
  const align = side === 'right' ? 'flex-end' : 'flex-start';
  const textAlign = side === 'right' ? ('right' as const) : ('left' as const);

  const injuryBadge = player ? getInjuryBadge(player.status) : null;

  // Empty slot
  if (!player) {
    return (
      <View style={[pStyles.cell, { alignItems: align }]}>
        <Text style={[pStyles.name, { color: c.secondaryText, fontStyle: 'italic', textAlign }]}>Empty</Text>
        <Text style={[pStyles.pts, { color: c.secondaryText, textAlign }]}>—</Text>
      </View>
    );
  }

  if (mode === 'future') {
    const futureMatchup = player.nbaTricode ? (futureSchedule?.get(player.nbaTricode) ?? null) : null;
    return (
      <View style={[pStyles.cell, { alignItems: align }]}>
        <View style={[pStyles.nameRow, { justifyContent: align }]}>
          <Text style={[pStyles.name, { color: c.text, textAlign }]} numberOfLines={1}>{player.name}</Text>
          {futureMatchup ? (
            <Text style={[pStyles.matchup, { color: c.secondaryText }]}>{futureMatchup}</Text>
          ) : null}
          {injuryBadge && (
            <View style={[pStyles.liveBadge, { backgroundColor: injuryBadge.color }]}>
              <Text style={pStyles.liveText}>{injuryBadge.label}</Text>
            </View>
          )}
        </View>
        <Text style={[pStyles.meta, { color: c.secondaryText, textAlign }]}>
          {futureMatchup ? `${player.position} · proj` : player.position}
        </Text>
        <Text style={[pStyles.pts, { color: c.secondaryText, textAlign }]}>—</Text>
      </View>
    );
  }

  if (mode === 'today' && liveStats) {
    const liveFp = round1(calculateGameFantasyPoints(liveToGameLog(liveStats) as any, scoring));
    const isLive = liveStats.game_status === 2;
    const statLine = liveStats.game_status !== 1
      ? buildStatLine(liveToGameLog(liveStats), scoring)
      : null;
    const gameInfo = formatGameInfo(liveStats);

    return (
      <View style={[pStyles.cell, { alignItems: align }]}>
        <View style={[pStyles.nameRow, { justifyContent: align }]}>
          {liveStats.oncourt && <OnCourtDot />}
          <Text style={[pStyles.name, { color: c.text, flexShrink: 1, textAlign }]} numberOfLines={1}>{player.name}</Text>
          {liveStats.matchup ? (
            <Text style={[pStyles.matchup, { color: c.secondaryText }]}>{liveStats.matchup}</Text>
          ) : null}
          {injuryBadge && (
            <View style={[pStyles.liveBadge, { backgroundColor: injuryBadge.color }]}>
              <Text style={pStyles.liveText}>{injuryBadge.label}</Text>
            </View>
          )}
          {isLive && (
            <View style={[pStyles.liveBadge, { backgroundColor: '#e03131' }]}>
              <Text style={pStyles.liveText}>LIVE</Text>
            </View>
          )}
        </View>
        {gameInfo ? (
          <Text style={[pStyles.meta, { color: c.secondaryText, fontSize: 10, lineHeight: 13, textAlign }]} numberOfLines={1}>
            {gameInfo}
          </Text>
        ) : null}
        <Text style={[pStyles.meta, { color: c.secondaryText, textAlign }]} numberOfLines={1}>
          {statLine ?? player.position}
        </Text>
        <AnimatedFpts value={liveFp} activeColor={c.text} dimColor={c.secondaryText} textStyle={[pStyles.pts, { textAlign }]} />
      </View>
    );
  }

  // today with no live entry yet
  if (mode === 'today') {
    const todayMatchup = player.nbaTricode ? (futureSchedule?.get(player.nbaTricode) ?? null) : null;
    return (
      <View style={[pStyles.cell, { alignItems: align }]}>
        <View style={[pStyles.nameRow, { justifyContent: align }]}>
          <Text style={[pStyles.name, { color: c.text, flexShrink: 1, textAlign }]} numberOfLines={1}>{player.name}</Text>
          {todayMatchup ? (
            <Text style={[pStyles.matchup, { color: c.secondaryText }]}>{todayMatchup}</Text>
          ) : null}
          {injuryBadge && (
            <View style={[pStyles.liveBadge, { backgroundColor: injuryBadge.color }]}>
              <Text style={pStyles.liveText}>{injuryBadge.label}</Text>
            </View>
          )}
        </View>
        <Text style={[pStyles.meta, { color: c.secondaryText, textAlign }]}>
          {todayMatchup ? `${player.position} · proj` : player.position}
        </Text>
        <AnimatedFpts value={todayMatchup ? 0 : null} activeColor={c.text} dimColor={c.secondaryText} textStyle={[pStyles.pts, { textAlign }]} />
      </View>
    );
  }

  // past
  const hasDayGame = player.dayPoints > 0;
  return (
    <View style={[pStyles.cell, { alignItems: align }]}>
      <View style={[pStyles.nameRow, { justifyContent: align }]}>
        <Text style={[pStyles.name, { color: c.text, flexShrink: 1, textAlign }]} numberOfLines={1}>{player.name}</Text>
        {hasDayGame && player.dayMatchup ? (
          <Text style={[pStyles.matchup, { color: c.secondaryText }]}>{player.dayMatchup}</Text>
        ) : null}
        {injuryBadge && (
          <View style={[pStyles.liveBadge, { backgroundColor: injuryBadge.color }]}>
            <Text style={pStyles.liveText}>{injuryBadge.label}</Text>
          </View>
        )}
      </View>
      <Text style={[pStyles.meta, { color: c.secondaryText, textAlign }]} numberOfLines={1}>
        {hasDayGame && player.dayStatLine ? player.dayStatLine : player.position}
      </Text>
      <AnimatedFpts
        value={hasDayGame ? player.dayPoints : null}
        activeColor={c.text}
        dimColor={c.secondaryText}
        textStyle={[pStyles.pts, { textAlign }]}
      />
    </View>
  );
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
}) {
  const myWeek = round1(myTeam.weekTotal + myLiveBonus);
  const myDay = round1(myTeam.dayTotal + myLiveBonus);
  const oppWeek = opponentTeam ? round1(opponentTeam.weekTotal + oppLiveBonus) : 0;
  const oppDay = opponentTeam ? round1(opponentTeam.dayTotal + oppLiveBonus) : 0;

  // Use the longer slot list (should always be the same length)
  const slotCount = Math.max(mySlots.length, oppSlots.length);

  return (
    <View>
      {/* Score header: [My Team] vs [Opponent] */}
      <View style={colStyles.scoreHeader}>
        <View style={[colStyles.scoreCol, { alignItems: 'flex-start' }]}>
          <Text style={[colStyles.teamName, { color: c.text }]} numberOfLines={1}>
            {seedMap?.has(myTeam.teamId) ? `#${seedMap.get(myTeam.teamId)} ` : ''}{myTeam.teamName}
          </Text>
          <Text style={[colStyles.total, { color: c.accent }]}>{myWeek.toFixed(1)}</Text>
          {mode !== 'future' && (
            <Text style={[colStyles.dayTotal, { color: c.secondaryText }]}>{myDay.toFixed(1)} today</Text>
          )}
        </View>
        <Text style={[colStyles.vsText, { color: c.secondaryText }]}>vs</Text>
        <View style={[colStyles.scoreCol, { alignItems: 'flex-end' }]}>
          <Text style={[colStyles.teamName, { color: c.text, textAlign: 'right' }]} numberOfLines={1}>
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

      {/* Slot rows: [left player] [POS] [right player] */}
      {Array.from({ length: slotCount }).map((_, i) => {
        const mySlot = mySlots[i] ?? null;
        const oppSlot = oppSlots[i] ?? null;
        const slotLabel = mySlot?.slotPosition ?? oppSlot?.slotPosition ?? '';

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
            />
            <View style={pStyles.slotCenter}>
              <Text style={[pStyles.slotText, { color: c.secondaryText }]}>
                {SLOT_LABELS[slotLabel] ?? slotLabel}
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
  const { data: scoring } = useScoring(leagueId);
  const { data: rosterConfig } = useLeagueRosterConfig(leagueId ?? '');

  const today = toDateStr(new Date());
  const [selectedDate, setSelectedDate] = useState<string>(today);
  const [scheduleVisible, setScheduleVisible] = useState(false);

  // If the calendar date rolled over since the component mounted, snap to today
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
    queryFn: () => fetchScheduleForDate(selectedDate),
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
        queryKey: ['weekMatchup', wk.id, teamId, day],
        queryFn: () => fetchWeekMatchupData(wk, teamId, leagueId, day, scoring),
        staleTime: 1000 * 60 * 2,
      });

      if (day >= todayStr) {
        queryClient.prefetchQuery({
          queryKey: ['futureSchedule', day],
          queryFn: () => fetchScheduleForDate(day),
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
      <ThemedView style={styles.center}>
        <ActivityIndicator />
      </ThemedView>
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
        >
          <Text style={[styles.arrow, { color: selectedDate <= minDate ? c.buttonDisabled : c.text }]}>
            ‹
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.dayInfo}
          onPress={() => setScheduleVisible(true)}
          activeOpacity={0.7}
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
        >
          <Text style={[styles.arrow, { color: selectedDate >= maxDate ? c.buttonDisabled : c.text }]}>
            ›
          </Text>
        </TouchableOpacity>
      </View>

      {/* Matchup body */}
      <ScrollView contentContainerStyle={styles.body}>
        {matchupLoading && <ActivityIndicator style={{ marginTop: 40 }} />}

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

            {mode === 'future' && (
              <View style={[styles.futureBanner, { backgroundColor: c.card }]}>
                <ThemedText style={{ color: c.secondaryText, fontSize: 13 }}>
                  Future date — projected averages shown. Points will accumulate when games are played.
                </ThemedText>
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
            />

          </>
        )}
      </ScrollView>

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
        >
          <View style={[styles.scheduleSheet, { backgroundColor: c.background, borderColor: c.border }]}>
            <ThemedText type="defaultSemiBold" style={styles.scheduleTitle}>
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
  body: { padding: 12, flexGrow: 1 },
  byeBanner: { borderRadius: 8, padding: 16, alignItems: 'center', marginBottom: 12 },
  futureBanner: { borderRadius: 8, padding: 10, marginBottom: 12 },
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

const pStyles = StyleSheet.create({
  slotRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth },
  cell: { flex: 1, paddingHorizontal: 2 },
  slotCenter: { width: 34, alignItems: 'center', justifyContent: 'center' },
  slotText: { fontSize: 10, fontWeight: '600' },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 3, flexShrink: 1 },
  name: { fontSize: 12, fontWeight: '500' },
  matchup: { fontSize: 9, fontWeight: '600' },
  meta: { fontSize: 10 },
  pts: { fontSize: 13, fontWeight: '700' },
  liveBadge: { paddingHorizontal: 4, paddingVertical: 1, borderRadius: 3 },
  liveText: { color: '#fff', fontSize: 8, fontWeight: '800', letterSpacing: 0.5 },
});
