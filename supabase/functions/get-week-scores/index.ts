import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsResponse } from "../_shared/cors.ts";
import { requireUser } from "../_shared/auth.ts";
import { errorResponse, handleError, jsonResponse } from "../_shared/http.ts";
import { checkRateLimit } from "../_shared/rate-limit.ts";
import { pushActivityUpdate } from "../_shared/apns.ts";
import { type CategoryResult } from "../_shared/finalizeWeek/scoring.ts";
import {
  buildCategoriesContentState,
  buildPointsContentState,
  categoryResultsToLines,
  type LiveActivityContentState,
  type LiveMarginTrend,
  type LiveMoment,
  type LiveNextTipoff,
} from "../_shared/liveActivityContent.ts";
import { resolveSlot as sharedResolveSlot, isActiveSlot } from "../_shared/resolveSlot.ts";
import { parseBody, z } from "../_shared/validate.ts";
import { getSportToday, addSlateDays } from "../../../utils/leagueTime.ts";
import { getSportModule } from "../../../utils/sports/registry.ts";

const Body = z.object({
  league_id: z.string().uuid().optional(),
  schedule_id: z.string().uuid().optional(),
});

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SB_SECRET_KEY")!,
);

// ── Scoring helpers ─────────────────────────────────────────────────────────
// Stat-name → game-column maps come from the shared sports registry so this
// function scores whatever sport the league is (the RPC bundle carries
// `sport`). Helpers below take the resolved map as a param — computed once
// per computeWeekScores call.

interface ScoringWeight {
  stat_name: string;
  point_value: number;
  is_enabled?: boolean;
  inverse?: boolean;
}

// ── Category scoring helpers ────────────────────────────────────────────────

const PERCENTAGE_STATS: Record<string, { numerator: string; denominator: string }> = {
  'FG%': { numerator: 'fgm', denominator: 'fga' },
  'FT%': { numerator: 'ftm', denominator: 'fta' },
};

function compareCategoryStats(
  homeStats: Record<string, number>,
  awayStats: Record<string, number>,
  categories: ScoringWeight[],
  statToGame: Record<string, string>,
): { results: CategoryResult[]; homeWins: number; awayWins: number; ties: number } {
  const results: CategoryResult[] = [];
  let homeWins = 0;
  let awayWins = 0;
  let ties = 0;

  for (const cat of categories) {
    if (!cat.is_enabled) continue;
    const pctDef = PERCENTAGE_STATS[cat.stat_name];
    let homeVal: number;
    let awayVal: number;

    if (pctDef) {
      const hNum = homeStats[pctDef.numerator] ?? 0;
      const hDen = homeStats[pctDef.denominator] ?? 0;
      const aNum = awayStats[pctDef.numerator] ?? 0;
      const aDen = awayStats[pctDef.denominator] ?? 0;
      homeVal = hDen > 0 ? Math.round((hNum / hDen) * 1000) / 1000 : 0;
      awayVal = aDen > 0 ? Math.round((aNum / aDen) * 1000) / 1000 : 0;
    } else {
      const gameKey = statToGame[cat.stat_name];
      if (!gameKey) continue;
      homeVal = homeStats[gameKey] ?? 0;
      awayVal = awayStats[gameKey] ?? 0;
    }

    let winner: 'home' | 'away' | 'tie';
    if (homeVal === awayVal) {
      winner = 'tie';
      ties++;
    } else if (cat.inverse) {
      winner = homeVal < awayVal ? 'home' : 'away';
      if (winner === 'home') homeWins++; else awayWins++;
    } else {
      winner = homeVal > awayVal ? 'home' : 'away';
      if (winner === 'home') homeWins++; else awayWins++;
    }

    results.push({ stat: cat.stat_name, home: homeVal, away: awayVal, winner });
  }

  return { results, homeWins, awayWins, ties };
}

function calcFpts(
  game: Record<string, number | boolean>,
  weights: ScoringWeight[],
  statToGame: Record<string, string>,
): number {
  let total = 0;
  for (const w of weights) {
    const field = statToGame[w.stat_name];
    if (!field || game[field] == null) continue;
    const val = typeof game[field] === "boolean"
      ? (game[field] ? 1 : 0)
      : (game[field] as number);
    total += val * w.point_value;
  }
  return total;
}

function liveToGameLog(
  live: Record<string, number>,
  sport: string,
): Record<string, number | boolean> {
  if (sport === "nfl") {
    // NFL live rows already carry the exact scoring columns (incl. the
    // derived dst_pa_pts tier) — pass them through, nulls stay absent.
    const out: Record<string, number | boolean> = {};
    for (const col of Object.values(getSportModule("nfl").statToGame)) {
      const v = live[col];
      if (v != null) out[col] = v;
    }
    return out;
  }
  const cats = [live.pts, live.reb, live.ast, live.stl, live.blk].filter(
    (v) => v >= 10,
  ).length;
  return {
    pts: live.pts, reb: live.reb, ast: live.ast, stl: live.stl,
    blk: live.blk, tov: live.tov, fgm: live.fgm, fga: live.fga,
    "3pm": live["3pm"], "3pa": live["3pa"] ?? 0, ftm: live.ftm,
    fta: live.fta, pf: live.pf,
    double_double: cats >= 2,
    triple_double: cats >= 3,
  };
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

// addDays is sport-TZ-anchored via the shared helper so this cron's "today"
// matches what GMs and other crons see for the same wall-clock moment.
const addDays = (dateStr: string, days: number) => addSlateDays(dateStr, days);

// ── Score computation for a single league/week ──────────────────────────────

interface WeekScoreResult {
  teamScores: Record<string, number>;
  isCategories: boolean;
  inverseByStat: Record<string, boolean>;
  categoryUpdates: Array<{
    matchupId: string;
    homeWins: number;
    awayWins: number;
    ties: number;
    results: CategoryResult[];
  }>;
}

async function computeWeekScores(
  leagueId: string,
  scheduleId: string,
): Promise<WeekScoreResult> {
  // Single RPC call fetches ALL data (week, scoring, matchups, rosters, lineups, games, live)
  // in one DB round trip instead of 3 sequential rounds.
  const { data: bundle, error: rpcError } = await supabase.rpc("get_week_score_data", {
    p_league_id: leagueId,
    p_schedule_id: scheduleId,
  });

  if (rpcError) throw rpcError;
  if (bundle?.error) throw new Error(bundle.error);

  const sport: string = bundle.sport ?? 'nba';
  const statToGame = getSportModule(sport).statToGame;
  const today = getSportToday(sport);

  const week = bundle.week;
  const weights: ScoringWeight[] = bundle.scoring ?? [];
  const matchups = bundle.matchups ?? [];
  const scoringType: string = bundle.scoring_type ?? 'h2h_points';
  const isCategories = scoringType === 'h2h_categories';

  // Collect all unique team IDs
  const teamIds = new Set<string>();
  for (const m of matchups) {
    teamIds.add(m.home_team_id);
    if (m.away_team_id) teamIds.add(m.away_team_id);
  }
  const teamIdList = [...teamIds];

  if (teamIdList.length === 0) return { teamScores: {}, isCategories, inverseByStat: {}, categoryUpdates: [] };

  const leaguePlayers = bundle.rosters ?? [];
  const dailyEntries = bundle.lineups ?? [];
  const gameLogs = bundle.games ?? [];
  const liveStats = bundle.live ?? [];

  // Build lookup structures
  const teamPlayerMap = new Map<string, Set<string>>();
  const defaultSlotMap = new Map<string, string>();
  const acquiredDateMap = new Map<string, string>();

  for (const lp of leaguePlayers) {
    if (!teamPlayerMap.has(lp.team_id)) {
      teamPlayerMap.set(lp.team_id, new Set());
    }
    teamPlayerMap.get(lp.team_id)!.add(lp.player_id);
    defaultSlotMap.set(lp.player_id, lp.roster_slot ?? "BE");
    if (lp.acquired_at) {
      acquiredDateMap.set(lp.player_id, getSportToday(sport, new Date(lp.acquired_at)));
    }
  }

  const dailyByTeamPlayer = new Map<
    string,
    Array<{ lineup_date: string; roster_slot: string }>
  >();
  const droppedByTeam = new Map<string, Set<string>>();

  for (const entry of dailyEntries) {
    const key = `${entry.team_id}:${entry.player_id}`;
    if (!dailyByTeamPlayer.has(key)) {
      dailyByTeamPlayer.set(key, []);
    }
    dailyByTeamPlayer.get(key)!.push(entry);

    const teamPlayers = teamPlayerMap.get(entry.team_id);
    if (
      (!teamPlayers || !teamPlayers.has(entry.player_id)) &&
      entry.lineup_date >= week.start_date &&
      entry.lineup_date <= week.end_date
    ) {
      if (!droppedByTeam.has(entry.team_id)) {
        droppedByTeam.set(entry.team_id, new Set());
      }
      droppedByTeam.get(entry.team_id)!.add(entry.player_id);
    }
  }

  // Build drop-date map for players no longer on their team
  const dropDateByTeamPlayer = new Map<string, string>();
  for (const [key, entries] of dailyByTeamPlayer) {
    const droppedEntry = entries.find((e) => e.roster_slot === "DROPPED");
    if (droppedEntry) dropDateByTeamPlayer.set(key, droppedEntry.lineup_date);
  }

  function resolveSlot(teamId: string, playerId: string, day: string): string {
    const key = `${teamId}:${playerId}`;
    const teamPlayers = teamPlayerMap.get(teamId);
    const isOnCurrentRoster = !!(teamPlayers && teamPlayers.has(playerId));
    return sharedResolveSlot({
      dailyEntries: dailyByTeamPlayer.get(key) ?? [],
      day,
      defaultSlot: defaultSlotMap.get(playerId) ?? "BE",
      isOnCurrentRoster,
      dropDate: dropDateByTeamPlayer.get(key),
      acquiredDate: acquiredDateMap.get(playerId),
      today,
    });
  }

  // 4. Compute scores from completed games
  const teamScores: Record<string, number> = {};
  const completedToday = new Set<string>();

  const allPlayersByTeam = new Map<string, Set<string>>();
  for (const tid of teamIdList) {
    const set = new Set(teamPlayerMap.get(tid) ?? []);
    const dropped = droppedByTeam.get(tid);
    if (dropped) {
      for (const pid of dropped) set.add(pid);
    }
    allPlayersByTeam.set(tid, set);
  }

  for (const game of gameLogs) {
    for (const [tid, playerSet] of allPlayersByTeam) {
      if (!playerSet.has(game.player_id)) continue;
      const slot = resolveSlot(tid, game.player_id, game.game_date);
      if (!isActiveSlot(slot)) continue;
      const fp = calcFpts(game as Record<string, number | boolean>, weights, statToGame);
      teamScores[tid] = (teamScores[tid] ?? 0) + fp;
      if (game.game_date === today) completedToday.add(game.player_id);
      break;
    }
  }

  // 5. Add live stats
  for (const live of liveStats) {
    if (completedToday.has(live.player_id) && live.game_date === today) continue;
    for (const [tid, playerSet] of allPlayersByTeam) {
      if (!playerSet.has(live.player_id)) continue;
      const slot = resolveSlot(tid, live.player_id, live.game_date);
      if (!isActiveSlot(slot)) continue;
      const gameLog = liveToGameLog(live as Record<string, number>, sport);
      const fp = calcFpts(gameLog, weights, statToGame);
      teamScores[tid] = (teamScores[tid] ?? 0) + fp;
      break;
    }
  }

  // Round all scores
  for (const k of Object.keys(teamScores)) {
    teamScores[k] = round2(teamScores[k]);
  }

  // 6. For category leagues, compute per-matchup category wins from raw stats
  const categoryUpdates: WeekScoreResult['categoryUpdates'] = [];
  if (isCategories) {
    // Build per-team aggregated stats (completed games + live)
    const teamStats = new Map<string, Record<string, number>>();
    for (const tid of teamIdList) teamStats.set(tid, {});

    for (const game of gameLogs) {
      for (const [tid, playerSet] of allPlayersByTeam) {
        if (!playerSet.has(game.player_id)) continue;
        const slot = resolveSlot(tid, game.player_id, game.game_date);
        if (!isActiveSlot(slot)) continue;
        const stats = teamStats.get(tid)!;
        for (const [, gameKey] of Object.entries(statToGame)) {
          const raw = game[gameKey];
          if (raw == null) continue;
          const val = typeof raw === 'boolean' ? (raw ? 1 : 0) : Number(raw);
          stats[gameKey] = (stats[gameKey] ?? 0) + val;
        }
        break;
      }
    }

    for (const live of liveStats) {
      if (completedToday.has(live.player_id) && live.game_date === today) continue;
      for (const [tid, playerSet] of allPlayersByTeam) {
        if (!playerSet.has(live.player_id)) continue;
        const slot = resolveSlot(tid, live.player_id, live.game_date);
        if (!isActiveSlot(slot)) continue;
        const gameLog = liveToGameLog(live as Record<string, number>, sport);
        const stats = teamStats.get(tid)!;
        for (const [, gameKey] of Object.entries(statToGame)) {
          const raw = gameLog[gameKey];
          if (raw == null) continue;
          const val = typeof raw === 'boolean' ? (raw ? 1 : 0) : Number(raw);
          stats[gameKey] = (stats[gameKey] ?? 0) + val;
        }
        break;
      }
    }

    // Compare each matchup
    for (const m of matchups) {
      if (!m.away_team_id) continue;
      const homeStats = teamStats.get(m.home_team_id) ?? {};
      const awayStats = teamStats.get(m.away_team_id) ?? {};
      const result = compareCategoryStats(homeStats, awayStats, weights, statToGame);
      categoryUpdates.push({
        matchupId: m.id,
        homeWins: result.homeWins,
        awayWins: result.awayWins,
        ties: result.ties,
        results: result.results,
      });
    }
  }

  const inverseByStat: Record<string, boolean> = {};
  for (const w of weights) inverseByStat[w.stat_name] = !!w.inverse;

  return { teamScores, isCategories, inverseByStat, categoryUpdates };
}

// ── Upsert scores into week_scores table ────────────────────────────────────

async function upsertScores(
  leagueId: string,
  scheduleId: string,
  scores: Record<string, number>,
): Promise<void> {
  if (Object.keys(scores).length === 0) return;

  const rows = Object.entries(scores).map(([teamId, score]) => ({
    league_id: leagueId,
    schedule_id: scheduleId,
    team_id: teamId,
    score,
    updated_at: new Date().toISOString(),
  }));

  const { error } = await supabase
    .from("week_scores")
    .upsert(rows, { onConflict: "league_id,schedule_id,team_id" });

  if (error) throw error;

  // Live-score broadcast is handled by the `week_scores_broadcast` DB trigger
  // (per-row `score_update` to `scores:<schedule_id>`), which also covers
  // finalize-week's writes — no manual channel.send() needed here.
}

// ── Update live category wins on league_matchups ───────────────────────────

async function upsertCategoryWins(
  updates: WeekScoreResult['categoryUpdates'],
): Promise<void> {
  if (updates.length === 0) return;

  // Batch update all matchups in parallel
  await Promise.all(
    updates.map(({ matchupId, homeWins, awayWins, ties }) =>
      supabase
        .from("league_matchups")
        .update({
          home_category_wins: homeWins,
          away_category_wins: awayWins,
          category_ties: ties,
        })
        .eq("id", matchupId)
    ),
  );
}

// ── Game activity check ─────────────────────────────────────────────────────

/** Returns true if any game (any sport) has tipped off today. Reads from
 *  game_schedule rather than BDL so a single check covers both leagues without
 *  paying for two API calls.
 *  Between midnight–3am ET, also checks yesterday for late West Coast games. */
async function hasActiveOrFinishedGames(): Promise<boolean> {
  try {
    // ET-anchored: this cron's "today" must match game_schedule.game_date,
    // which is also ET-anchored (see bdlGameSlateDate). Get the ET wall-clock
    // via Intl.DateTimeFormat — never via the new Date(toLocaleString())
    // antipattern, which has locale-parsing bugs across JS engines.
    const today = getSportToday(null);
    const etParts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York', hour: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date());
    const hour = parseInt(etParts.find((p) => p.type === 'hour')!.value, 10);
    const datesToCheck = hour < 3 ? [today, addSlateDays(today, -1)] : [today];

    // sport-scope: global "any games happening at all" short-circuit for the
    // whole cron run — cross-sport on purpose.
    const { data } = await supabase
      .from('game_schedule')
      .select('game_id', { head: false, count: 'exact' })
      .in('game_date', datesToCheck)
      .lte('game_time_utc', new Date().toISOString())
      .limit(1);

    return (data?.length ?? 0) > 0;
  } catch {
    return true; // On error, assume games are happening
  }
}

// ── Live Activity dispatch ──────────────────────────────────────────────────

// expo-widgets pushes REPLACE the entire ContentState — every dispatch must
// send the full props the JS widget expects (see widgets/MatchupActivity.tsx).
const TRICODE_FROM_NAME = (name: string) =>
  name.trim().substring(0, 3).toUpperCase() || '???';

// ── Moments: pick the hero row from recent scoring events ───────────────────
//
// The widget renders ONE hero row above the player ticker. In priority order:
//   1. A live_scoring_event in the last 90s for any rostered player (either side)
//   2. A margin-trajectory line (gap closing/widening over the last ~10 min)
//   3. A "next tipoff" line when no live action and a relevant game is coming
//
// Cats mode is intentionally excluded for v1 — the closest-cat hero comes from
// a different signal (category swing) that we can add later.

const MOMENT_KIND_PRIORITY: Record<string, number> = {
  TD: 100,
  DD: 90,
  MADE_3PT: 70,
  BLK: 50,
  STL: 50,
  AST: 30,
};

function formatMomentText(playerName: string, kind: string, value: number): string {
  const parts = playerName.trim().split(/\s+/);
  const initial = parts[0]?.charAt(0) ?? '';
  const last = parts.length > 1 ? parts.slice(1).join(' ') : (parts[0] ?? '');
  const prefix = parts.length > 1 ? `${initial}. ${last.toUpperCase()}` : last.toUpperCase();
  switch (kind) {
    case 'TD':       return `${prefix} — TRIPLE-DOUBLE`;
    case 'DD':       return `${prefix} — DOUBLE-DOUBLE`;
    case 'MADE_3PT': return value > 1 ? `${prefix} — ${value} 3PTRS` : `${prefix} — 3-POINTER`;
    case 'STL':      return value > 1 ? `${prefix} — ${value} STEALS` : `${prefix} — STEAL`;
    case 'BLK':      return value > 1 ? `${prefix} — ${value} BLOCKS` : `${prefix} — BLOCK`;
    case 'AST':      return value > 1 ? `${prefix} — ${value} ASSISTS` : `${prefix} — DIME`;
    default:         return '';
  }
}

function momentIconFor(kind: string): LiveMoment['icon'] {
  if (kind === 'TD' || kind === 'DD') return 'check';
  if (kind === 'MADE_3PT') return 'flame';
  return 'bolt';
}

function momentKindFor(kind: string): LiveMoment['kind'] {
  if (kind === 'TD' || kind === 'DD') return 'threshold';
  if (kind === 'MADE_3PT') return 'event';
  return 'swing';
}

interface RawEvent {
  player_id: string;
  player_name: string;
  kind: string;
  value: number;
  occurred_at: string;
}

function pickMoment(
  events: RawEvent[],
  myPlayerIds: Set<string>,
  oppPlayerIds: Set<string>,
  nowMs: number,
): LiveMoment | undefined {
  let best: { ev: RawEvent; score: number; side: 'me' | 'opp' } | null = null;
  for (const ev of events) {
    const priority = MOMENT_KIND_PRIORITY[ev.kind];
    if (priority === undefined) continue;
    const side: 'me' | 'opp' = myPlayerIds.has(ev.player_id)
      ? 'me'
      : oppPlayerIds.has(ev.player_id)
        ? 'opp'
        : (null as never);
    if (side === null) continue;
    const ageSec = Math.max(0, Math.round((nowMs - Date.parse(ev.occurred_at)) / 1000));
    // Decay priority by age — a fresh DIME (30 priority, 5s old) shouldn't beat
    // a 3PTR (70 priority, 80s old). Loss of 1 priority per 10s.
    const score = priority - Math.floor(ageSec / 10);
    if (!best || score > best.score) {
      best = { ev, score, side };
    }
  }
  if (!best) return undefined;
  const ageSec = Math.max(0, Math.round((nowMs - Date.parse(best.ev.occurred_at)) / 1000));
  return {
    kind: momentKindFor(best.ev.kind),
    icon: momentIconFor(best.ev.kind),
    text: formatMomentText(best.ev.player_name, best.ev.kind, best.ev.value),
    side: best.side,
    ageSec,
  };
}

// ── Margin trajectory: track scoreGap snapshots in metadata.marginHistory ───

interface MarginSnapshot { at: string; gap: number; }

function computeMarginTrend(
  currentGap: number,
  history: MarginSnapshot[],
  nowMs: number,
): LiveMarginTrend | undefined {
  if (!Array.isArray(history) || history.length === 0) return undefined;
  const tenMinAgoMs = nowMs - 10 * 60 * 1000;
  const eligible = history
    .filter((e) => Date.parse(e.at) >= tenMinAgoMs)
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  if (eligible.length === 0) return undefined;
  const earliest = eligible[0];
  const earlierMinAgo = Math.round((nowMs - Date.parse(earliest.at)) / 60000);
  // Need at least 3 min of history AND ≥2 fpts of movement to be a "trend".
  if (earlierMinAgo < 3) return undefined;
  if (Math.abs(currentGap - earliest.gap) < 2) return undefined;
  return { current: currentGap, earlier: earliest.gap, earlierMinAgo };
}

function appendMarginHistory(
  prev: MarginSnapshot[],
  currentGap: number,
  nowIso: string,
  nowMs: number,
): MarginSnapshot[] {
  const fifteenMinAgoMs = nowMs - 15 * 60 * 1000;
  const trimmed = (Array.isArray(prev) ? prev : []).filter(
    (e) => Date.parse(e.at) >= fifteenMinAgoMs,
  );
  trimmed.push({ at: nowIso, gap: currentGap });
  return trimmed.slice(-16);
}

// ── Next tipoff fallback ────────────────────────────────────────────────────

interface UpcomingGame {
  home_team: string | null;
  away_team: string | null;
  game_time_utc: string | null;
}

function pickNextTipoff(
  games: UpcomingGame[],
  myProTeamCounts: Map<string, number>,
  oppProTeamCounts: Map<string, number>,
  nowMs: number,
): LiveNextTipoff | undefined {
  const tomorrowCap = nowMs + 30 * 60 * 60 * 1000; // 30h horizon
  const candidates = games
    .filter((g) => g.game_time_utc && g.home_team && g.away_team)
    .filter((g) => {
      const t = Date.parse(g.game_time_utc!);
      return Number.isFinite(t) && t > nowMs && t < tomorrowCap;
    })
    .filter((g) => {
      const teams = [g.home_team!, g.away_team!];
      return teams.some((t) => myProTeamCounts.has(t) || oppProTeamCounts.has(t));
    })
    .sort((a, b) => Date.parse(a.game_time_utc!) - Date.parse(b.game_time_utc!));
  if (candidates.length === 0) return undefined;
  const first = candidates[0];
  const t = new Date(Date.parse(first.game_time_utc!));
  const timeText = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(t).replace(' AM', 'a').replace(' PM', 'p').replace(/^0/, '') + ' ET';
  const matchup = `${first.away_team} @ ${first.home_team}`;
  const myStarters =
    (myProTeamCounts.get(first.home_team!) ?? 0) +
    (myProTeamCounts.get(first.away_team!) ?? 0);
  const oppStarters =
    (oppProTeamCounts.get(first.home_team!) ?? 0) +
    (oppProTeamCounts.get(first.away_team!) ?? 0);
  return { timeText, matchup, myStarters, oppStarters };
}

interface DispatchWeekResult {
  league_id: string;
  schedule_id: string;
  teamScores: Record<string, number>;
  isCategories: boolean;
  inverseByStat: Record<string, boolean>;
  categoryUpdates: WeekScoreResult['categoryUpdates'];
}

async function dispatchMatchupActivities(
  weekResults: DispatchWeekResult[],
): Promise<void> {
  // Check if any Live Activities are registered before doing work
  const scheduleIds = weekResults.map(w => w.schedule_id);
  if (scheduleIds.length === 0) return;

  const { data: tokens } = await supabase
    .from('activity_tokens')
    .select('id, team_id, schedule_id, league_id, matchup_id, metadata')
    .eq('activity_type', 'matchup')
    .eq('stale', false)
    .in('schedule_id', scheduleIds);

  if (!tokens || tokens.length === 0) return;

  // Resolve team display info for every team referenced by any token's matchup
  const matchupIds = [...new Set(tokens.map(t => t.matchup_id).filter(Boolean))];
  const { data: matchupRows } = await supabase
    .from('league_matchups')
    .select('id, home_team_id, away_team_id')
    .in('id', matchupIds);

  const matchupById = new Map((matchupRows ?? []).map(m => [m.id, m]));

  const allTeamIds = new Set<string>();
  for (const t of tokens) {
    if (t.team_id) allTeamIds.add(t.team_id);
    const m = matchupById.get(t.matchup_id);
    if (m?.home_team_id) allTeamIds.add(m.home_team_id);
    if (m?.away_team_id) allTeamIds.add(m.away_team_id);
  }

  const { data: teamRows } = await supabase
    .from('teams')
    .select('id, name, tricode')
    .in('id', [...allTeamIds]);

  const teamInfo = new Map<string, { name: string; tricode: string }>();
  for (const t of teamRows ?? []) {
    teamInfo.set(t.id, {
      name: t.name ?? '',
      tricode: t.tricode?.trim() || TRICODE_FROM_NAME(t.name ?? ''),
    });
  }

  // ── Roster fetch: needed for moments (event filtering) + nextTipoff
  // (pro_team mapping). Same pattern as poll-live-stats — today's daily_lineups
  // first, fall back to league_players default slot for teams that don't use
  // daily lineups.
  const today = getSportToday(null);
  const allTeamIdsArr = [...allTeamIds];
  const { data: dailyLineupRows } = await supabase
    .from('daily_lineups')
    .select('player_id, team_id')
    .eq('lineup_date', today)
    .in('team_id', allTeamIdsArr)
    .not('roster_slot', 'in', '("BE","IR","TAXI","DROPPED")');
  const teamsWithDaily = new Set<string>(
    (dailyLineupRows ?? []).map((r) => r.team_id),
  );
  const teamsNeedingFallback = allTeamIdsArr.filter((id) => !teamsWithDaily.has(id));
  let fallbackRows: Array<{ player_id: string; team_id: string }> = [];
  if (teamsNeedingFallback.length > 0) {
    const { data } = await supabase
      .from('league_players')
      .select('player_id, team_id')
      .in('team_id', teamsNeedingFallback)
      .not('roster_slot', 'in', '("BE","IR","TAXI","DROPPED")');
    fallbackRows = data ?? [];
  }
  const rosterByTeam = new Map<string, Set<string>>();
  for (const row of [...(dailyLineupRows ?? []), ...fallbackRows]) {
    const set = rosterByTeam.get(row.team_id) ?? new Set<string>();
    set.add(row.player_id);
    rosterByTeam.set(row.team_id, set);
  }
  const allRosterPlayerIds = new Set<string>();
  for (const set of rosterByTeam.values()) for (const pid of set) allRosterPlayerIds.add(pid);

  // ── Recent moments: events ≤90s old for any rostered player. One query
  // for the whole batch — filter per-token in memory.
  const nowMs = Date.now();
  const ninetySecAgoIso = new Date(nowMs - 90_000).toISOString();
  const allRosterPlayerIdsArr = [...allRosterPlayerIds];
  let recentEvents: RawEvent[] = [];
  if (allRosterPlayerIdsArr.length > 0) {
    const { data } = await supabase
      .from('live_scoring_events')
      .select('player_id, player_name, kind, value, occurred_at')
      .gte('occurred_at', ninetySecAgoIso)
      .in('player_id', allRosterPlayerIdsArr)
      .order('occurred_at', { ascending: false })
      .limit(200);
    recentEvents = data ?? [];
  }

  // ── Next-tipoff data: today + tomorrow's game_schedule rows for any pro
  // team a rostered player plays for. pro_team mapping is per-player.
  // Tricodes are qualified by sport ("nba:PHX") — NBA and WNBA share several
  // city codes, so a bare-tricode lookup can match the wrong sport's game
  // when both have a slate on the same day.
  const playerToProTeam = new Map<string, string>();
  if (allRosterPlayerIdsArr.length > 0) {
    const { data } = await supabase
      .from('players')
      .select('id, pro_team, sport')
      .in('id', allRosterPlayerIdsArr);
    for (const p of data ?? []) {
      if (p.pro_team) playerToProTeam.set(p.id, `${p.sport}:${p.pro_team}`);
    }
  }
  const tomorrow = addSlateDays(today, 1);
  // sport-scope: intentionally spans sports (one fetch for all leagues in the
  // run); rows are disambiguated by the sport-qualified tricode keys below.
  const { data: upcomingGamesRaw } = await supabase
    .from('game_schedule')
    .select('home_team, away_team, game_time_utc, sport')
    .in('game_date', [today, tomorrow]);
  const upcomingGames = (upcomingGamesRaw ?? []).map((g) => ({
    home_team: g.home_team ? `${g.sport}:${g.home_team}` : g.home_team,
    away_team: g.away_team ? `${g.sport}:${g.away_team}` : g.away_team,
    game_time_utc: g.game_time_utc,
  }));

  for (const weekResult of weekResults) {
    const weekTokens = tokens.filter(t => t.schedule_id === weekResult.schedule_id);
    if (weekTokens.length === 0) continue;

    const updatesByMatchupId = new Map(
      weekResult.categoryUpdates.map((u) => [u.matchupId, u]),
    );

    for (const token of weekTokens) {
      const matchup = matchupById.get(token.matchup_id);
      if (!matchup) continue;

      const myTeamId = token.team_id;
      const oppTeamId = matchup.home_team_id === myTeamId
        ? matchup.away_team_id
        : matchup.home_team_id;
      if (!myTeamId || !oppTeamId) continue;

      const myMeta = teamInfo.get(myTeamId) ?? { name: '', tricode: '???' };
      const oppMeta = teamInfo.get(oppTeamId) ?? { name: '', tricode: '???' };

      const meta = (token.metadata ?? {}) as {
        myLogoFileUri?: string | null;
        opponentLogoFileUri?: string | null;
        patchFileUri?: string | null;
        myTeamId?: string;
        opponentTeamId?: string;
        playerTicker?: {
          players?: Array<{
            name: string;
            statLine: string;
            fantasyPoints: number;
            gameStatus: string;
            isOnCourt: boolean;
          }>;
          myActivePlayers?: number;
          opponentActivePlayers?: number;
          biggestContributor?: string;
          updatedAt?: string;
        };
        marginHistory?: MarginSnapshot[];
      };
      // Token metadata stores logos by the role they had at activity start
      // ("my" = the device's team). Mirror that perspective for THIS push.
      const myLogoFileUri = meta.myLogoFileUri ?? undefined;
      const opponentLogoFileUri = meta.opponentLogoFileUri ?? undefined;
      const patchFileUri = meta.patchFileUri ?? undefined;

      // poll-live-stats writes the latest live ticker into metadata after each
      // tick. Echo it here so we don't clobber player rows with []. 10-min
      // freshness check keeps us from echoing stale zombie data after games
      // end.
      const TICKER_FRESH_MS = 10 * 60 * 1000;
      const tickerUpdatedAt = meta.playerTicker?.updatedAt
        ? Date.parse(meta.playerTicker.updatedAt)
        : 0;
      const tickerFresh =
        Number.isFinite(tickerUpdatedAt) &&
        Date.now() - tickerUpdatedAt < TICKER_FRESH_MS;
      const cachedTicker = tickerFresh ? meta.playerTicker : undefined;

      let contentState: LiveActivityContentState;
      if (weekResult.isCategories) {
        const update = updatesByMatchupId.get(token.matchup_id);
        const perspective: 'home' | 'away' =
          matchup.home_team_id === myTeamId ? 'home' : 'away';
        const lines = update
          ? categoryResultsToLines(update.results, perspective, weekResult.inverseByStat)
          : [];
        const myWins = update
          ? perspective === 'home' ? update.homeWins : update.awayWins
          : 0;
        const oppWins = update
          ? perspective === 'home' ? update.awayWins : update.homeWins
          : 0;
        const ties = update?.ties ?? 0;
        contentState = buildCategoriesContentState({
          myTeamName: myMeta.name,
          opponentTeamName: oppMeta.name,
          myTeamTricode: myMeta.tricode,
          opponentTeamTricode: oppMeta.tricode,
          myWins,
          oppWins,
          ties,
          categories: lines,
          myActivePlayers: 0,
          opponentActivePlayers: 0,
          myLogoFileUri,
          opponentLogoFileUri,
          patchFileUri,
        });
      } else {
        const myScore = weekResult.teamScores[myTeamId] ?? 0;
        const oppScore = weekResult.teamScores[oppTeamId] ?? 0;
        const roundedMy = Math.round(myScore * 10) / 10;
        const roundedOpp = Math.round(oppScore * 10) / 10;
        const gap = Math.round((roundedMy - roundedOpp) * 10) / 10;

        // Hero row picker — moment > marginTrend > nextTipoff
        const myRoster = rosterByTeam.get(myTeamId) ?? new Set<string>();
        const oppRoster = rosterByTeam.get(oppTeamId) ?? new Set<string>();
        const moment = pickMoment(recentEvents, myRoster, oppRoster, nowMs);

        let marginTrend: LiveMarginTrend | undefined = undefined;
        let nextTipoff: LiveNextTipoff | undefined = undefined;
        if (!moment) {
          marginTrend = computeMarginTrend(gap, meta.marginHistory ?? [], nowMs);
        }
        const activeNow =
          (cachedTicker?.myActivePlayers ?? 0) + (cachedTicker?.opponentActivePlayers ?? 0);
        if (!moment && !marginTrend && activeNow === 0) {
          const myProCounts = new Map<string, number>();
          const oppProCounts = new Map<string, number>();
          for (const pid of myRoster) {
            const pro = playerToProTeam.get(pid);
            if (pro) myProCounts.set(pro, (myProCounts.get(pro) ?? 0) + 1);
          }
          for (const pid of oppRoster) {
            const pro = playerToProTeam.get(pid);
            if (pro) oppProCounts.set(pro, (oppProCounts.get(pro) ?? 0) + 1);
          }
          nextTipoff = pickNextTipoff(upcomingGames ?? [], myProCounts, oppProCounts, nowMs);
        }

        // Persist a fresh gap snapshot so future ticks have history to compare.
        // Spread the existing metadata first to preserve playerTicker (written
        // by poll-live-stats on its own cadence). Race window is small; if
        // poll writes between our read and our write, we lose ≤1 tick of
        // playerTicker freshness — self-heals on the next poll.
        const newHistory = appendMarginHistory(
          meta.marginHistory ?? [],
          gap,
          new Date(nowMs).toISOString(),
          nowMs,
        );
        await supabase
          .from('activity_tokens')
          .update({
            metadata: {
              ...(token.metadata ?? {}),
              marginHistory: newHistory,
            },
          })
          .eq('id', token.id)
          .then(() => undefined, () => undefined);

        contentState = buildPointsContentState({
          myTeamName: myMeta.name,
          opponentTeamName: oppMeta.name,
          myTeamTricode: myMeta.tricode,
          opponentTeamTricode: oppMeta.tricode,
          myScore: roundedMy,
          opponentScore: roundedOpp,
          biggestContributor: cachedTicker?.biggestContributor ?? '',
          myActivePlayers: cachedTicker?.myActivePlayers ?? 0,
          opponentActivePlayers: cachedTicker?.opponentActivePlayers ?? 0,
          players: cachedTicker?.players ?? [],
          myLogoFileUri,
          opponentLogoFileUri,
          patchFileUri,
          moment,
          marginTrend,
          nextTipoff,
        });
      }

      await pushActivityUpdate(supabase, 'matchup', {
        schedule_id: weekResult.schedule_id,
        league_id: weekResult.league_id,
      }, contentState).catch((err) =>
        console.warn('pushActivityUpdate failed (get-week-scores):', err),
      );
    }
  }
}

// ── Main handler ────────────────────────────────────────────────────────────
// Two modes:
// 1. Cron mode (no league_id in body): compute scores for ALL leagues with live weeks
// 2. Client mode (league_id + schedule_id): compute for a specific week (non-live / fallback)

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return corsResponse();

  try {
    // Parse body — cron sends {} or empty, client sends league_id + schedule_id
    let rawBody: unknown = {};
    try {
      rawBody = await req.json();
    } catch {
      // Empty body = cron mode
    }

    const { league_id, schedule_id } = parseBody(Body, rawBody);

    if (league_id && schedule_id) {
      // ── Client mode: verify auth + rate limit ──
      const user = await requireUser(req);

      const rateLimited = await checkRateLimit(supabase, user.id, 'get-week-scores');
      if (rateLimited) return rateLimited;

      const result = await computeWeekScores(league_id, schedule_id);
      await upsertScores(league_id, schedule_id, result.teamScores);
      if (result.isCategories) await upsertCategoryWins(result.categoryUpdates);

      return jsonResponse({ scores: result.teamScores });
    }

    // ── Cron mode: verify CRON_SECRET ──
    const cronSecret = Deno.env.get('CRON_SECRET');
    const cronAuth = req.headers.get('Authorization');
    if (!cronSecret || cronAuth !== `Bearer ${cronSecret}`) {
      return errorResponse('Unauthorized', 401);
    }

    // ── Cron mode: skip during 3–10am ET when no NBA games are running ──
    const etCronParts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York', hour: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date());
    const hour = parseInt(etCronParts.find((p) => p.type === 'hour')!.value, 10);
    if (hour >= 3 && hour < 10) {
      return jsonResponse({ ok: true, skipped: true, reason: "off-hours (3-10am ET)" });
    }

    // ── Skip if no live fantasy weeks — cheap local-DB check, avoids the
    //    BDL call entirely during offseason and between-week gaps. ──
    const today = getSportToday(null);

    const { data: liveWeeks, error: weekErr } = await supabase
      .from("league_schedule")
      .select("id, league_id, start_date, end_date")
      .lte("start_date", today)
      .gte("end_date", today);

    if (weekErr) throw weekErr;

    if (!liveWeeks || liveWeeks.length === 0) {
      return jsonResponse({ ok: true, skipped: true, reason: "no live weeks" });
    }

    // ── Skip if no NBA games are active or recently finished ──
    const gamesActive = await hasActiveOrFinishedGames();
    if (!gamesActive) {
      return jsonResponse({ ok: true, skipped: true, reason: "no active/finished games" });
    }

    const settled = await Promise.allSettled(
      (liveWeeks ?? []).map(async (week) => {
        const result = await computeWeekScores(week.league_id, week.id);
        await upsertScores(week.league_id, week.id, result.teamScores);
        if (result.isCategories) await upsertCategoryWins(result.categoryUpdates);
        return {
          league_id: week.league_id,
          schedule_id: week.id,
          teams: Object.keys(result.teamScores).length,
          teamScores: result.teamScores,
          isCategories: result.isCategories,
          inverseByStat: result.inverseByStat,
          categoryUpdates: result.categoryUpdates,
        };
      }),
    );

    const results: Array<{ league_id: string; schedule_id: string; teams: number }> = [];
    for (const r of settled) {
      if (r.status === 'fulfilled') {
        results.push(r.value);
      } else {
        console.error('Failed to compute scores for a league/week:', r.reason);
      }
    }

    // ── Dispatch Live Activity updates (non-blocking) ──
    // Fire-and-forget: don't let activity push failures slow down the cron
    dispatchMatchupActivities(results.map(r => {
      const settledValue = (settled.find(
        s => s.status === 'fulfilled' && s.value.league_id === r.league_id && s.value.schedule_id === r.schedule_id,
      ) as PromiseFulfilledResult<any>)?.value;
      return {
        league_id: r.league_id,
        schedule_id: r.schedule_id,
        teamScores: settledValue?.teamScores ?? {},
        isCategories: settledValue?.isCategories ?? false,
        inverseByStat: settledValue?.inverseByStat ?? {},
        categoryUpdates: settledValue?.categoryUpdates ?? [],
      };
    })).catch(err => console.warn('Live activity dispatch error (non-fatal):', err));

    return jsonResponse({ ok: true, processed: results.length, results });
  } catch (err: unknown) {
    return handleError(err, 'get-week-scores');
  }
});
