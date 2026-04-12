import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SB_SECRET_KEY")!,
);

function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

Deno.serve(async (req: Request) => {
  const cronSecret = Deno.env.get('CRON_SECRET');
  const authHeader = req.headers.get('Authorization');
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    });
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

    // Process all leagues in parallel — each league is independent
    const settled = await Promise.allSettled(
      activeLeagues.map(async (league) => {
        // Step 1: Write current week scores from week_scores table into matchup rows
        const { data: currentWeekMatchups } = await supabase
          .from("league_matchups")
          .select("id, home_team_id, away_team_id, schedule_id, league_schedule!inner(start_date, end_date)")
          .eq("league_id", league.id)
          .eq("is_finalized", false)
          .is("playoff_round", null)
          .lte("league_schedule.start_date", yesterday)
          .gte("league_schedule.end_date", yesterday);

        if (currentWeekMatchups && currentWeekMatchups.length > 0) {
          const scheduleId = currentWeekMatchups[0].schedule_id;

          const { data: weekScoreRows } = await supabase
            .from("week_scores")
            .select("team_id, score")
            .eq("schedule_id", scheduleId);

          const scores: Record<string, number> = {};
          for (const row of weekScoreRows ?? []) {
            scores[row.team_id] = Number(row.score);
          }

          const matchupUpdates = currentWeekMatchups.map((m) => ({
            id: m.id,
            home_score: scores[m.home_team_id] ?? 0,
            away_score: m.away_team_id ? (scores[m.away_team_id] ?? 0) : 0,
          }));
          if (matchupUpdates.length > 0) {
            await supabase.rpc("batch_update_matchup_scores", {
              p_updates: matchupUpdates,
            });
          }
        }

        // Step 2: Sum ALL matchup scores (finalized + current) for PF/PA
        const isCat = league.scoring_type === 'h2h_categories';
        const { data: allMatchups } = await supabase
          .from("league_matchups")
          .select("home_team_id, away_team_id, home_score, away_score, home_category_wins, away_category_wins")
          .eq("league_id", league.id)
          .is("playoff_round", null);

        const pf: Record<string, number> = {};
        const pa: Record<string, number> = {};
        for (const m of allMatchups ?? []) {
          const hs = isCat ? (Number(m.home_category_wins) || 0) : (Number(m.home_score) || 0);
          const as_ = isCat ? (Number(m.away_category_wins) || 0) : (Number(m.away_score) || 0);
          if (m.home_team_id) {
            pf[m.home_team_id] = (pf[m.home_team_id] ?? 0) + hs;
            pa[m.home_team_id] = (pa[m.home_team_id] ?? 0) + as_;
          }
          if (m.away_team_id) {
            pf[m.away_team_id] = (pf[m.away_team_id] ?? 0) + as_;
            pa[m.away_team_id] = (pa[m.away_team_id] ?? 0) + hs;
          }
        }

        // Step 3: Batch-update teams table in one round-trip
        const allTeamIds = [...new Set([...Object.keys(pf), ...Object.keys(pa)])];
        const teamUpdates = allTeamIds.map((tid) => ({
          id: tid,
          points_for: Math.round((pf[tid] ?? 0) * 100) / 100,
          points_against: Math.round((pa[tid] ?? 0) * 100) / 100,
        }));
        if (teamUpdates.length > 0) {
          await supabase.rpc("batch_update_team_standings", {
            p_updates: teamUpdates,
          });
        }

        return allTeamIds.length;
      }),
    );

    let updatedCount = 0;
    for (const r of settled) {
      if (r.status === 'fulfilled') {
        updatedCount += r.value;
      } else {
        console.error('Failed to update standings for a league:', r.reason);
      }
    }

    return new Response(
      JSON.stringify({ ok: true, updated: updatedCount }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (error: any) {
    console.error("update-standings error:", error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});
