import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { CORS_HEADERS, corsResponse } from "../_shared/cors.ts";
import { checkRateLimit } from "../_shared/rate-limit.ts";
import { bdlFetch } from "../_shared/bdl.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

// ── Scoring helpers ─────────────────────────────────────────────────────────

const STAT_TO_GAME: Record<string, string> = {
  PTS: "pts", REB: "reb", AST: "ast", STL: "stl", BLK: "blk",
  TO: "tov", "3PM": "3pm", "3PA": "3pa", FGM: "fgm", FGA: "fga",
  FTM: "ftm", FTA: "fta", PF: "pf", DD: "double_double", TD: "triple_double",
};

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

function aggregateGameStats(
  gameLogs: Record<string, any>[],
): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const game of gameLogs) {
    for (const [, gameKey] of Object.entries(STAT_TO_GAME)) {
      const raw = game[gameKey];
      if (raw == null) continue;
      const val = typeof raw === 'boolean' ? (raw ? 1 : 0) : Number(raw);
      totals[gameKey] = (totals[gameKey] ?? 0) + val;
    }
  }
  return totals;
}

function compareCategoryStats(
  homeStats: Record<string, number>,
  awayStats: Record<string, number>,
  categories: ScoringWeight[],
): { homeWins: number; awayWins: number; ties: number } {
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
      const gameKey = STAT_TO_GAME[cat.stat_name];
      if (!gameKey) continue;
      homeVal = homeStats[gameKey] ?? 0;
      awayVal = awayStats[gameKey] ?? 0;
    }

    if (homeVal === awayVal) {
      ties++;
    } else if (cat.inverse) {
      if (homeVal < awayVal) homeWins++; else awayWins++;
    } else {
      if (homeVal > awayVal) homeWins++; else awayWins++;
    }
  }

  return { homeWins, awayWins, ties };
}

function calcFpts(
  game: Record<string, number | boolean>,
  weights: ScoringWeight[],
): number {
  let total = 0;
  for (const w of weights) {
    const field = STAT_TO_GAME[w.stat_name];
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
): Record<string, number | boolean> {
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

function toDateStr(d: Date): string {
  return d.toLocaleDateString("en-CA"); // YYYY-MM-DD
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T12:00:00");
  d.setDate(d.getDate() + days);
  return toDateStr(d);
}

// ── Score computation for a single league/week ──────────────────────────────

interface WeekScoreResult {
  teamScores: Record<string, number>;
  isCategories: boolean;
  categoryUpdates: Array<{
    matchupId: string;
    homeWins: number;
    awayWins: number;
    ties: number;
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

  const today = toDateStr(new Date());

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

  if (teamIdList.length === 0) return { teamScores: {}, isCategories, categoryUpdates: [] };

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
      acquiredDateMap.set(lp.player_id, toDateStr(new Date(lp.acquired_at)));
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
    // Drop-date guard: if player is no longer on this team, enforce DROPPED
    const teamPlayers = teamPlayerMap.get(teamId);
    if (!teamPlayers || !teamPlayers.has(playerId)) {
      const dropDate = dropDateByTeamPlayer.get(key);
      if (dropDate && day >= dropDate) return "DROPPED";
      if (!dropDate && day >= today) return "DROPPED";
    }
    const entries = dailyByTeamPlayer.get(key) ?? [];
    // Use most recent DROPPED as ownership boundary, but only for players
    // currently on the roster (re-acquired after a previous drop). For dropped
    // players, entries before the DROPPED marker are still valid.
    const isOnRoster = !!(teamPlayers && teamPlayers.has(playerId));
    const mostRecentDrop = entries.find((e) => e.roster_slot === "DROPPED");
    const boundary = isOnRoster ? mostRecentDrop?.lineup_date : undefined;
    // Exact match for the requested day always wins (handles same-week drop + re-acquire)
    const exactMatch = entries.find((e) => e.lineup_date === day && e.roster_slot !== "DROPPED");
    if (exactMatch) return exactMatch.roster_slot;
    const entry = entries.find((e) =>
      e.lineup_date <= day && e.roster_slot !== "DROPPED" && (!boundary || e.lineup_date > boundary),
    );
    if (entry) return entry.roster_slot;
    const acquired = acquiredDateMap.get(playerId);
    if (acquired && day < acquired) return "BE";
    return defaultSlotMap.get(playerId) ?? "BE";
  }

  function isActiveSlot(slot: string): boolean {
    return slot !== "BE" && slot !== "IR" && slot !== "TAXI" && slot !== "DROPPED";
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
      const fp = calcFpts(game as Record<string, number | boolean>, weights);
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
      const gameLog = liveToGameLog(live as Record<string, number>);
      const fp = calcFpts(gameLog, weights);
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
        for (const [, gameKey] of Object.entries(STAT_TO_GAME)) {
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
        const gameLog = liveToGameLog(live as Record<string, number>);
        const stats = teamStats.get(tid)!;
        for (const [, gameKey] of Object.entries(STAT_TO_GAME)) {
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
      const result = compareCategoryStats(homeStats, awayStats, weights);
      categoryUpdates.push({
        matchupId: m.id,
        homeWins: result.homeWins,
        awayWins: result.awayWins,
        ties: result.ties,
      });
    }
  }

  return { teamScores, isCategories, categoryUpdates };
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

// ── NBA game check via balldontlie ───────────────────────────────────────────

/** Returns true if any NBA game is currently live or recently finished today.
 *  Between midnight–3am ET, also checks yesterday for late West Coast games. */
async function hasActiveOrFinishedGames(): Promise<boolean> {
  try {
    const nowET = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
    const today = nowET.toISOString().slice(0, 10);
    const hour = nowET.getHours();
    const yesterdayET = new Date(nowET.getTime() - 86_400_000).toISOString().slice(0, 10);
    const datesToCheck = hour < 3 ? [today, yesterdayET] : [today];

    const results = await Promise.all(
      datesToCheck.map(d => bdlFetch("/games", { "dates[]": d })),
    );
    const games = results.flatMap((r: any) => r?.data ?? []);
    return games.some((g: any) => {
      const s: string = g.status ?? "";
      return s === "Final" || /Qtr|Half|OT/i.test(s);
    });
  } catch {
    return true; // On error, assume games are happening
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
    let body: Record<string, string> = {};
    try {
      body = await req.json();
    } catch {
      // Empty body = cron mode
    }

    const { league_id, schedule_id } = body;

    if (league_id && schedule_id) {
      // ── Client mode: verify auth + rate limit ──
      const authHeader = req.headers.get('Authorization');
      const token = authHeader?.startsWith('Bearer ') ? authHeader : `Bearer ${authHeader}`;
      const userClient = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_ANON_KEY')!,
        { global: { headers: { Authorization: token ?? '' } } },
      );
      const { data: { user } } = await userClient.auth.getUser();
      if (!user) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        });
      }

      const rateLimited = await checkRateLimit(supabase, user.id, 'get-week-scores');
      if (rateLimited) return rateLimited;

      const result = await computeWeekScores(league_id, schedule_id);
      await upsertScores(league_id, schedule_id, result.teamScores);
      if (result.isCategories) await upsertCategoryWins(result.categoryUpdates);

      return new Response(
        JSON.stringify({ scores: result.teamScores }),
        { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
      );
    }

    // ── Cron mode: verify CRON_SECRET ──
    const cronSecret = Deno.env.get('CRON_SECRET');
    const cronAuth = req.headers.get('Authorization');
    if (!cronSecret || cronAuth !== `Bearer ${cronSecret}`) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { 'Content-Type': 'application/json' },
      });
    }

    // ── Cron mode: skip during 3–10am ET when no NBA games are running ──
    const nowET = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
    const hour = nowET.getHours();
    if (hour >= 3 && hour < 10) {
      return new Response(
        JSON.stringify({ ok: true, skipped: true, reason: "off-hours (3-10am ET)" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    // ── Skip if no NBA games are active or recently finished ──
    const gamesActive = await hasActiveOrFinishedGames();
    if (!gamesActive) {
      return new Response(
        JSON.stringify({ ok: true, skipped: true, reason: "no active/finished games" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    // ── Compute scores for all live weeks ──
    const today = toDateStr(new Date());

    const { data: liveWeeks, error: weekErr } = await supabase
      .from("league_schedule")
      .select("id, league_id, start_date, end_date")
      .lte("start_date", today)
      .gte("end_date", today);

    if (weekErr) throw weekErr;

    const settled = await Promise.allSettled(
      (liveWeeks ?? []).map(async (week) => {
        const result = await computeWeekScores(week.league_id, week.id);
        await upsertScores(week.league_id, week.id, result.teamScores);
        if (result.isCategories) await upsertCategoryWins(result.categoryUpdates);
        return {
          league_id: week.league_id,
          schedule_id: week.id,
          teams: Object.keys(result.teamScores).length,
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

    return new Response(
      JSON.stringify({ ok: true, processed: results.length, results }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("get-week-scores error:", message);
    return new Response(
      JSON.stringify({ error: message }),
      {
        status: 500,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      },
    );
  }
});
