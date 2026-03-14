import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

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
}

function calculateGameFpts(game: Record<string, any>, weights: ScoringWeight[]): number {
  let total = 0;
  for (const w of weights) {
    if (!w.is_enabled) continue;
    const field = STAT_TO_GAME[w.stat_name];
    if (field && game[field] != null) {
      const val = typeof game[field] === 'boolean' ? (game[field] ? 1 : 0) : Number(game[field]);
      total += val * w.point_value;
    }
  }
  return Math.round(total * 100) / 100;
}

function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Compute scores for all teams in a league for a given week range
// Mirrors scoreboard's computeAllTeamScores — includes dropped players
async function computeAllTeamScores(
  leagueId: string,
  startDate: string,
  endDate: string,
  scoring: ScoringWeight[],
): Promise<Record<string, number>> {
  // Fetch all currently rostered players
  const { data: leaguePlayers } = await supabase
    .from("league_players")
    .select("player_id, team_id, roster_slot")
    .eq("league_id", leagueId);

  const currentPlayerIds = new Set((leaguePlayers ?? []).map((lp: any) => lp.player_id));
  const defaultByPlayer = new Map<string, { teamId: string; slot: string }>();
  for (const lp of leaguePlayers ?? []) {
    defaultByPlayer.set(lp.player_id, { teamId: lp.team_id, slot: lp.roster_slot ?? "BE" });
  }

  // Fetch daily lineup history (includes snapshots for dropped players)
  const { data: dailyEntries } = await supabase
    .from("daily_lineups")
    .select("player_id, team_id, roster_slot, lineup_date")
    .eq("league_id", leagueId)
    .lte("lineup_date", endDate)
    .order("lineup_date", { ascending: false });

  const dailyByPlayer = new Map<string, Array<{ lineup_date: string; roster_slot: string; team_id: string }>>();
  const droppedPlayerTeam = new Map<string, string>();
  for (const entry of dailyEntries ?? []) {
    if (!dailyByPlayer.has(entry.player_id)) {
      dailyByPlayer.set(entry.player_id, []);
    }
    dailyByPlayer.get(entry.player_id)!.push(entry);

    // Track dropped players: in daily_lineups for this week but not currently rostered
    if (!currentPlayerIds.has(entry.player_id) && entry.lineup_date >= startDate && !droppedPlayerTeam.has(entry.player_id)) {
      droppedPlayerTeam.set(entry.player_id, entry.team_id);
    }
  }

  const allPlayerIds = [...currentPlayerIds, ...droppedPlayerTeam.keys()];
  if (allPlayerIds.length === 0) return {};

  // Resolve team ownership and slot for a player on a given day
  const resolveOwnership = (playerId: string, day: string): { teamId: string | null; slot: string } => {
    const entries = dailyByPlayer.get(playerId) ?? [];
    const entry = entries.find((e) => e.lineup_date <= day);
    if (entry) return { teamId: entry.team_id, slot: entry.roster_slot };
    const info = defaultByPlayer.get(playerId);
    return { teamId: info?.teamId ?? null, slot: info?.slot ?? "BE" };
  };

  // Fetch game logs for the week
  const { data: gameLogs } = await supabase
    .from("player_games")
    .select('player_id, pts, reb, ast, stl, blk, tov, fgm, fga, "3pm", "3pa", ftm, fta, pf, double_double, triple_double, game_date')
    .in("player_id", allPlayerIds)
    .gte("game_date", startDate)
    .lte("game_date", endDate);

  // Sum fantasy points per team
  const teamScores: Record<string, number> = {};
  for (const game of gameLogs ?? []) {
    const { teamId, slot } = resolveOwnership(game.player_id, game.game_date);
    if (!teamId) continue;
    if (slot === "BE" || slot === "IR" || slot === "DROPPED") continue;
    teamScores[teamId] = (teamScores[teamId] ?? 0) + calculateGameFpts(game, scoring);
  }

  for (const k of Object.keys(teamScores)) {
    teamScores[k] = Math.round(teamScores[k] * 100) / 100;
  }
  return teamScores;
}

Deno.serve(async (req: Request) => {
  const cronSecret = Deno.env.get('CRON_SECRET');
  if (cronSecret) {
    const authHeader = req.headers.get('Authorization');
    if (authHeader !== `Bearer ${cronSecret}`) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  try {
    const yesterday = toDateStr(new Date(Date.now() - 86400000));

    const { data: activeLeagues } = await supabase
      .from("leagues")
      .select("id, scoring_type")
      .eq("schedule_generated", true)
      .is("offseason_step", null);

    if (!activeLeagues || activeLeagues.length === 0) {
      return new Response(
        JSON.stringify({ ok: true, updated: 0, message: "No active leagues" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    let updatedCount = 0;

    for (const league of activeLeagues) {
      const { data: scoring } = await supabase
        .from("league_scoring_settings")
        .select("stat_name, point_value, is_enabled")
        .eq("league_id", league.id);

      if (!scoring || scoring.length === 0) continue;

      // Step 1: Compute current week scores and write them into matchup rows
      const { data: currentWeekMatchups } = await supabase
        .from("league_matchups")
        .select("id, home_team_id, away_team_id, schedule_id, league_schedule!inner(start_date, end_date)")
        .eq("league_id", league.id)
        .eq("is_finalized", false)
        .is("playoff_round", null)
        .lte("league_schedule.start_date", yesterday)
        .gte("league_schedule.end_date", yesterday);

      if (currentWeekMatchups && currentWeekMatchups.length > 0) {
        const schedule = (currentWeekMatchups[0] as any).league_schedule;
        const startDate = schedule.start_date;
        const endDate = yesterday < schedule.end_date ? yesterday : schedule.end_date;

        if (startDate <= endDate) {
          const scores = await computeAllTeamScores(league.id, startDate, endDate, scoring);

          // Write computed scores into each matchup row
          for (const m of currentWeekMatchups) {
            await supabase
              .from("league_matchups")
              .update({
                home_score: scores[m.home_team_id] ?? 0,
                away_score: m.away_team_id ? (scores[m.away_team_id] ?? 0) : 0,
              })
              .eq("id", m.id);
          }
        }
      }

      // Step 2: Sum ALL matchup scores (finalized + current) for PF/PA
      const { data: allMatchups } = await supabase
        .from("league_matchups")
        .select("home_team_id, away_team_id, home_score, away_score")
        .eq("league_id", league.id)
        .is("playoff_round", null);

      const pf: Record<string, number> = {};
      const pa: Record<string, number> = {};
      for (const m of allMatchups ?? []) {
        const hs = Number(m.home_score) || 0;
        const as_ = Number(m.away_score) || 0;
        if (m.home_team_id) {
          pf[m.home_team_id] = (pf[m.home_team_id] ?? 0) + hs;
          pa[m.home_team_id] = (pa[m.home_team_id] ?? 0) + as_;
        }
        if (m.away_team_id) {
          pf[m.away_team_id] = (pf[m.away_team_id] ?? 0) + as_;
          pa[m.away_team_id] = (pa[m.away_team_id] ?? 0) + hs;
        }
      }

      // Step 3: Update teams table
      const allTeamIds = [...new Set([...Object.keys(pf), ...Object.keys(pa)])];
      for (const tid of allTeamIds) {
        const pfVal = Math.round((pf[tid] ?? 0) * 100) / 100;
        const paVal = Math.round((pa[tid] ?? 0) * 100) / 100;
        await supabase
          .from("teams")
          .update({ points_for: pfVal, points_against: paVal })
          .eq("id", tid);
      }

      updatedCount += allTeamIds.length;
    }

    return new Response(
      JSON.stringify({ ok: true, updated: updatedCount }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (error: any) {
    console.error("update-standings error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});
