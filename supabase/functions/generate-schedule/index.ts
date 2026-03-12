import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { checkRateLimit } from '../_shared/rate-limit.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Berger round-robin: returns one array per round, each element is [homeId, awayId|null]
function buildRoundRobin(teams: (string | null)[]): Array<Array<[string | null, string | null]>> {
  const n = teams.length;
  const list = [...teams];
  const rounds: Array<Array<[string | null, string | null]>> = [];

  for (let r = 0; r < n - 1; r++) {
    const round: Array<[string | null, string | null]> = [];
    for (let m = 0; m < n / 2; m++) {
      round.push([list[m], list[n - 1 - m]]);
    }
    rounds.push(round);
    const last = list.pop()!;
    list.splice(1, 0, last);
  }
  return rounds;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Verify calling user is commissioner
    const authHeader = req.headers.get('Authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader : `Bearer ${authHeader}`;
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: token ?? '' } } }
    );

    const { data: { user } } = await userClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const rateLimited = await checkRateLimit(supabase, user.id, 'generate-schedule');
    if (rateLimited) return rateLimited;

    const { league_id } = await req.json();
    if (!league_id) {
      return new Response(JSON.stringify({ error: "league_id required" }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Verify commissioner
    const { data: league, error: leagueErr } = await supabase
      .from("leagues")
      .select("regular_season_weeks, playoff_weeks, season, season_start_date, schedule_generated, created_by")
      .eq("id", league_id)
      .single();

    if (leagueErr || !league) {
      return new Response(JSON.stringify({ error: "League not found" }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (league.created_by !== user.id) {
      return new Response(JSON.stringify({ error: 'Only the commissioner can generate a schedule' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (league.schedule_generated) {
      return new Response(JSON.stringify({ error: "Schedule already generated" }), {
        status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!league.season_start_date) {
      return new Response(JSON.stringify({ error: "League has no season_start_date" }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: teams, error: teamsErr } = await supabase
      .from("teams")
      .select("id")
      .eq("league_id", league_id);

    if (teamsErr || !teams || teams.length < 2) {
      return new Response(JSON.stringify({ error: "Not enough teams to generate a schedule" }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const teamIds = teams.map((t: { id: string }) => t.id);
    const N = teamIds.length;

    if (N % 2 !== 0 && league.regular_season_weeks % N !== 0) {
      return new Response(
        JSON.stringify({
          error: `With ${N} teams, regular_season_weeks must be a multiple of ${N} for equal bye weeks.`,
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const teamList: (string | null)[] = N % 2 === 0 ? [...teamIds] : [...teamIds, null];
    const cycleRounds = buildRoundRobin(teamList);
    const cycleLength = cycleRounds.length;

    const [sy, sm, sd] = league.season_start_date.split("-").map(Number);

    // Week 1 may be a partial week (e.g. Tue–Sun) if the league was
    // created mid-week.  Week 2+ are always full Mon–Sun.
    const w1Start = new Date(Date.UTC(sy, sm - 1, sd));
    const w1Dow = w1Start.getUTCDay(); // 0=Sun, 1=Mon, …, 6=Sat
    const daysUntilSun = w1Dow === 0 ? 0 : 7 - w1Dow;
    const w1EndDay = sd + daysUntilSun; // day-of-month for Week 1 Sunday
    const week2StartDay = w1EndDay + 1;  // Monday after Week 1

    const totalWeeks = league.regular_season_weeks + league.playoff_weeks;
    const scheduleRows = [];

    for (let w = 0; w < totalWeeks; w++) {
      let wsDate: Date;
      let weDate: Date;

      if (w === 0) {
        // Week 1: season_start_date through first Sunday
        wsDate = w1Start;
        weDate = new Date(Date.UTC(sy, sm - 1, w1EndDay));
      } else {
        // Week 2+: full Mon–Sun
        wsDate = new Date(Date.UTC(sy, sm - 1, week2StartDay + (w - 1) * 7));
        weDate = new Date(Date.UTC(sy, sm - 1, week2StartDay + (w - 1) * 7 + 6));
      }

      scheduleRows.push({
        league_id,
        week_number: w + 1,
        start_date: wsDate.toISOString().split("T")[0],
        end_date: weDate.toISOString().split("T")[0],
        is_playoff: w >= league.regular_season_weeks,
        season: league.season,
      });
    }

    const { data: insertedWeeks, error: weeksErr } = await supabase
      .from("league_schedule")
      .insert(scheduleRows)
      .select("id, week_number");

    if (weeksErr || !insertedWeeks) {
      return new Response(JSON.stringify({ error: "Failed to insert schedule weeks", detail: weeksErr }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const weekMap = new Map<number, string>(insertedWeeks.map((w: { week_number: number; id: string }) => [w.week_number, w.id]));

    const matchupRows = [];
    for (let w = 0; w < league.regular_season_weeks; w++) {
      const round = cycleRounds[w % cycleLength];
      const scheduleId = weekMap.get(w + 1)!;

      for (const [home, away] of round) {
        if (home === null && away === null) continue;

        const homeId = home ?? away;
        const awayId = home === null ? null : away;

        matchupRows.push({
          league_id,
          schedule_id: scheduleId,
          week_number: w + 1,
          home_team_id: homeId,
          away_team_id: awayId,
        });
      }
    }

    if (matchupRows.length > 0) {
      const { error: matchupsErr } = await supabase.from("league_matchups").insert(matchupRows);
      if (matchupsErr) {
        return new Response(JSON.stringify({ error: "Failed to insert matchups", detail: matchupsErr }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    await supabase.from("leagues").update({ schedule_generated: true }).eq("id", league_id);

    return new Response(
      JSON.stringify({ success: true, total_weeks: totalWeeks, regular_season_matchups: matchupRows.length }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
