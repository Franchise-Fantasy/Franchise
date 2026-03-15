import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { CORS_HEADERS, corsResponse } from "../_shared/cors.ts";

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

async function computeWeekScores(
  leagueId: string,
  scheduleId: string,
): Promise<Record<string, number>> {
  // 1. Fetch week, scoring, matchups in parallel
  const [weekRes, scoringRes, matchupRes] = await Promise.all([
    supabase
      .from("league_schedule")
      .select("id, week_number, start_date, end_date, is_playoff")
      .eq("id", scheduleId)
      .single(),
    supabase
      .from("league_scoring_settings")
      .select("stat_name, point_value")
      .eq("league_id", leagueId),
    supabase
      .from("league_matchups")
      .select("id, home_team_id, away_team_id")
      .eq("schedule_id", scheduleId),
  ]);

  if (weekRes.error) throw weekRes.error;
  if (scoringRes.error) throw scoringRes.error;
  if (matchupRes.error) throw matchupRes.error;

  const week = weekRes.data;
  const weights: ScoringWeight[] = scoringRes.data ?? [];
  const matchups = matchupRes.data ?? [];

  // Collect all unique team IDs
  const teamIds = new Set<string>();
  for (const m of matchups) {
    teamIds.add(m.home_team_id);
    if (m.away_team_id) teamIds.add(m.away_team_id);
  }
  const teamIdList = [...teamIds];

  if (teamIdList.length === 0) return {};

  // 2. Fetch rosters, daily lineups, game logs, live stats
  const today = toDateStr(new Date());
  const weekIsLive = week.start_date <= today && today <= week.end_date;
  const gameEndDate = weekIsLive ? addDays(today, -1) : week.end_date;
  const hasCompletedDays = gameEndDate >= week.start_date;

  const [playersRes, dailyRes] = await Promise.all([
    supabase
      .from("league_players")
      .select("player_id, team_id, roster_slot, acquired_at")
      .eq("league_id", leagueId)
      .in("team_id", teamIdList),
    supabase
      .from("daily_lineups")
      .select("player_id, team_id, roster_slot, lineup_date")
      .eq("league_id", leagueId)
      .in("team_id", teamIdList)
      .lte("lineup_date", week.end_date)
      .order("lineup_date", { ascending: false }),
  ]);

  if (playersRes.error) throw playersRes.error;
  if (dailyRes.error) throw dailyRes.error;

  const allPlayerIdSet = new Set<string>();
  for (const lp of playersRes.data ?? []) allPlayerIdSet.add(lp.player_id);
  for (const dl of dailyRes.data ?? []) allPlayerIdSet.add(dl.player_id);
  const allPlayerIdList = [...allPlayerIdSet];

  const [gamesRes, liveRes] = await Promise.all([
    hasCompletedDays && allPlayerIdList.length > 0
      ? supabase
          .from("player_games")
          .select(
            'player_id, pts, reb, ast, stl, blk, tov, fgm, fga, "3pm", "3pa", ftm, fta, pf, double_double, triple_double, game_date',
          )
          .in("player_id", allPlayerIdList)
          .gte("game_date", week.start_date)
          .lte("game_date", gameEndDate)
      : Promise.resolve({ data: [], error: null }),
    weekIsLive && allPlayerIdList.length > 0
      ? supabase
          .from("live_player_stats")
          .select(
            'player_id, game_date, game_status, pts, reb, ast, stl, blk, tov, fgm, fga, "3pm", "3pa", ftm, fta, pf',
          )
          .in("player_id", allPlayerIdList)
          .gte("game_status", 2)
          .or(`game_date.eq.${today},and(game_date.eq.${addDays(today, -1)},game_status.eq.2)`)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (gamesRes.error) throw gamesRes.error;
  if (liveRes.error) throw liveRes.error;

  const leaguePlayers = playersRes.data ?? [];
  const dailyEntries = dailyRes.data ?? [];
  const gameLogs = gamesRes.data ?? [];
  const liveStats = liveRes.data ?? [];

  // 3. Build lookup structures
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

  function resolveSlot(teamId: string, playerId: string, day: string): string {
    const key = `${teamId}:${playerId}`;
    const entries = dailyByTeamPlayer.get(key) ?? [];
    const entry = entries.find((e) => e.lineup_date <= day);
    if (entry) return entry.roster_slot;
    const acquired = acquiredDateMap.get(playerId);
    if (acquired && day < acquired) return "BE";
    return defaultSlotMap.get(playerId) ?? "BE";
  }

  function isActiveSlot(slot: string): boolean {
    return slot !== "BE" && slot !== "IR" && slot !== "DROPPED";
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

  return teamScores;
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
      // ── Client mode: compute for a specific league/week ──
      const scores = await computeWeekScores(league_id, schedule_id);
      await upsertScores(league_id, schedule_id, scores);

      return new Response(
        JSON.stringify({ scores }),
        { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
      );
    }

    // ── Cron mode: compute scores for all live weeks ──
    const today = toDateStr(new Date());

    const { data: liveWeeks, error: weekErr } = await supabase
      .from("league_schedule")
      .select("id, league_id, start_date, end_date")
      .lte("start_date", today)
      .gte("end_date", today);

    if (weekErr) throw weekErr;

    const results: Array<{ league_id: string; schedule_id: string; teams: number }> = [];

    for (const week of liveWeeks ?? []) {
      try {
        const scores = await computeWeekScores(week.league_id, week.id);
        await upsertScores(week.league_id, week.id, scores);
        results.push({
          league_id: week.league_id,
          schedule_id: week.id,
          teams: Object.keys(scores).length,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`Failed to compute scores for league ${week.league_id}, week ${week.id}:`, msg);
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
