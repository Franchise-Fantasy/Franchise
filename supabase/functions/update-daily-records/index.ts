import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { resolveSlot, isActiveSlot } from '../_shared/resolveSlot.ts';

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const STAT_TO_GAME: Record<string, string> = {
  PTS: "pts", REB: "reb", AST: "ast", STL: "stl", BLK: "blk",
  TO: "tov", "3PM": "3pm", "3PA": "3pa", FGM: "fgm", FGA: "fga",
  FTM: "ftm", FTA: "fta", PF: "pf", DD: "double_double", TD: "triple_double",
};

interface ScoringWeight {
  stat_name: string;
  point_value: number;
  is_enabled: boolean;
  inverse: boolean;
}

function calculateGameFpts(
  game: Record<string, number>,
  weights: ScoringWeight[],
): number {
  let total = 0;
  for (const w of weights) {
    const field = STAT_TO_GAME[w.stat_name];
    if (field && game[field] != null) {
      total += game[field] * w.point_value;
    }
  }
  return Math.round(total * 100) / 100;
}

function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * For an entire league, fetch all roster + lineup data once, then compute
 * the best single-day score across all teams and all supplied dates.
 * Returns the best candidate (if any).
 */
async function findLeagueBestDay(
  leagueId: string,
  teamIds: string[],
  dates: string[],
  weights: ScoringWeight[],
): Promise<{ value: number; teamId: string; date: string } | null> {
  const startDate = dates[dates.length - 1]; // oldest
  const endDate = dates[0]; // newest (dates are desc)

  // 1) Fetch all rosters for every team in this league (single query)
  const { data: allLeaguePlayers } = await supabase
    .from("league_players")
    .select("team_id, player_id, roster_slot, acquired_at")
    .eq("league_id", leagueId)
    .in("team_id", teamIds);

  // Build per-team data structures
  const teamRosters = new Map<string, {
    currentPlayerIds: Set<string>;
    defaultSlotMap: Map<string, string>;
    acquiredDateMap: Map<string, string>;
  }>();

  for (const tid of teamIds) {
    teamRosters.set(tid, {
      currentPlayerIds: new Set(),
      defaultSlotMap: new Map(),
      acquiredDateMap: new Map(),
    });
  }

  for (const lp of allLeaguePlayers ?? []) {
    const roster = teamRosters.get(lp.team_id);
    if (!roster) continue;
    roster.currentPlayerIds.add(lp.player_id);
    roster.defaultSlotMap.set(lp.player_id, lp.roster_slot ?? "BE");
    if (lp.acquired_at) {
      roster.acquiredDateMap.set(lp.player_id, fmtDate(new Date(lp.acquired_at)));
    }
  }

  // 2) Fetch all daily lineup entries for every team in this league (single query)
  const { data: allDailyEntries } = await supabase
    .from("daily_lineups")
    .select("team_id, player_id, roster_slot, lineup_date")
    .eq("league_id", leagueId)
    .in("team_id", teamIds)
    .lte("lineup_date", endDate)
    .order("lineup_date", { ascending: false });

  // Group daily entries by team, then by player
  const teamDailyByPlayer = new Map<string, Map<string, Array<{ lineup_date: string; roster_slot: string }>>>();
  const teamDroppedPlayerIds = new Map<string, string[]>();

  for (const tid of teamIds) {
    teamDailyByPlayer.set(tid, new Map());
    teamDroppedPlayerIds.set(tid, []);
  }

  for (const entry of allDailyEntries ?? []) {
    const dailyByPlayer = teamDailyByPlayer.get(entry.team_id);
    if (!dailyByPlayer) continue;
    if (!dailyByPlayer.has(entry.player_id)) dailyByPlayer.set(entry.player_id, []);
    dailyByPlayer.get(entry.player_id)!.push(entry);

    const roster = teamRosters.get(entry.team_id)!;
    const dropped = teamDroppedPlayerIds.get(entry.team_id)!;
    if (!roster.currentPlayerIds.has(entry.player_id) && !dropped.includes(entry.player_id)) {
      dropped.push(entry.player_id);
    }
  }

  // Build drop-date maps and collect all player IDs we need game logs for
  const allPlayerIds = new Set<string>();
  const teamDropDateMap = new Map<string, Map<string, string>>();

  for (const tid of teamIds) {
    const roster = teamRosters.get(tid)!;
    const dailyByPlayer = teamDailyByPlayer.get(tid)!;
    const droppedIds = teamDroppedPlayerIds.get(tid)!;

    const dropDateMap = new Map<string, string>();
    for (const pid of droppedIds) {
      const entries = dailyByPlayer.get(pid) ?? [];
      const droppedEntry = entries.find((e) => e.roster_slot === "DROPPED");
      if (droppedEntry) dropDateMap.set(pid, droppedEntry.lineup_date);
    }
    teamDropDateMap.set(tid, dropDateMap);

    for (const pid of roster.currentPlayerIds) allPlayerIds.add(pid);
    for (const pid of droppedIds) allPlayerIds.add(pid);
  }

  if (allPlayerIds.size === 0) return null;

  // 3) Fetch all game logs for these players across the date range (single query)
  const playerIdArr = [...allPlayerIds];
  const { data: allGameLogs } = await supabase
    .from("player_games")
    .select('player_id, pts, reb, ast, stl, blk, tov, fgm, fga, "3pm", "3pa", ftm, fta, pf, double_double, triple_double, game_date')
    .in("player_id", playerIdArr)
    .gte("game_date", startDate)
    .lte("game_date", endDate);

  if (!allGameLogs || allGameLogs.length === 0) return null;

  // Index game logs by player_id + date for fast lookup
  const gamesByPlayerDate = new Map<string, Record<string, number>[]>();
  for (const game of allGameLogs) {
    const key = `${game.player_id}|${game.game_date}`;
    if (!gamesByPlayerDate.has(key)) gamesByPlayerDate.set(key, []);
    gamesByPlayerDate.get(key)!.push(game as any);
  }

  // 4) Compute scores in memory: for each team × date, sum active-slot fpts
  const today = fmtDate(new Date());
  let best: { value: number; teamId: string; date: string } | null = null;

  for (const tid of teamIds) {
    const roster = teamRosters.get(tid)!;
    const dailyByPlayer = teamDailyByPlayer.get(tid)!;
    const dropDateMap = teamDropDateMap.get(tid)!;
    const droppedIds = teamDroppedPlayerIds.get(tid)!;
    const teamPlayerIds = [...roster.currentPlayerIds, ...droppedIds];

    for (const date of dates) {
      let dayTotal = 0;

      for (const pid of teamPlayerIds) {
        const games = gamesByPlayerDate.get(`${pid}|${date}`);
        if (!games) continue;

        const slot = resolveSlot({
          dailyEntries: dailyByPlayer.get(pid) ?? [],
          day: date,
          defaultSlot: roster.defaultSlotMap.get(pid) ?? "BE",
          isOnCurrentRoster: roster.currentPlayerIds.has(pid),
          dropDate: dropDateMap.get(pid),
          acquiredDate: roster.acquiredDateMap.get(pid),
          today,
        });

        if (isActiveSlot(slot)) {
          for (const game of games) {
            dayTotal += calculateGameFpts(game, weights);
          }
        }
      }

      dayTotal = Math.round(dayTotal * 100) / 100;
      if (dayTotal > 0 && (!best || dayTotal > best.value)) {
        best = { value: dayTotal, teamId: tid, date };
      }
    }
  }

  return best;
}

Deno.serve(async (req: Request) => {
  const cronSecret = Deno.env.get("CRON_SECRET");
  const authHeader = req.headers.get("Authorization");
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    // Scan the last 7 days so we catch any days that were missed
    const now = new Date();
    const dates: string[] = [];
    for (let i = 1; i <= 7; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      dates.push(fmtDate(d));
    }

    // Get all points-scoring leagues with a generated schedule (in-season)
    const { data: leagues } = await supabase
      .from("leagues")
      .select("id, scoring_type")
      .eq("scoring_type", "points")
      .eq("schedule_generated", true);

    if (!leagues || leagues.length === 0) {
      return new Response(JSON.stringify({ ok: true, updated: 0, message: "No active points leagues" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Fetch scoring weights, teams, and existing records for all leagues in parallel
    const leagueData = await Promise.all(leagues.map(async (league) => {
      const [{ data: weights }, { data: teams }, { data: existing }] = await Promise.all([
        supabase
          .from("league_scoring_settings")
          .select("stat_name, point_value, is_enabled, inverse")
          .eq("league_id", league.id),
        supabase
          .from("teams")
          .select("id")
          .eq("league_id", league.id),
        supabase
          .from("league_records")
          .select("value")
          .eq("league_id", league.id)
          .eq("record_type", "highest_scoring_day")
          .single(),
      ]);
      return {
        leagueId: league.id,
        weights: weights ?? [],
        teamIds: (teams ?? []).map((t: any) => t.id),
        currentBest: existing ? Number(existing.value) : 0,
      };
    }));

    let updatedCount = 0;

    // Process each league (3 batched queries per league instead of 3 per team per date)
    await Promise.all(leagueData.map(async ({ leagueId, weights, teamIds, currentBest }) => {
      if (weights.length === 0 || teamIds.length === 0) return;

      const best = await findLeagueBestDay(leagueId, teamIds, dates, weights as ScoringWeight[]);

      if (best && best.value > currentBest) {
        const season = best.date.slice(0, 4);
        await supabase.from("league_records").upsert({
          league_id: leagueId,
          record_type: "highest_scoring_day",
          value: best.value,
          team_id: best.teamId,
          detail: best.date,
          season,
          updated_at: new Date().toISOString(),
        }, { onConflict: "league_id,record_type" });
        updatedCount++;
        console.log(`Updated highest_scoring_day for league ${leagueId}: ${best.value} by team ${best.teamId} on ${best.date}`);
      }
    }));

    return new Response(JSON.stringify({ ok: true, updated: updatedCount, datesChecked: dates.length }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("update-daily-records error:", err?.message ?? err);
    return new Response(
      JSON.stringify({ error: err?.message ?? String(err) }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});
