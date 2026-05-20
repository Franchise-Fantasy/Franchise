import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { errorResponse, handleError, jsonResponse } from '../_shared/http.ts';
import { checkRateLimit } from '../_shared/rate-limit.ts';
import { parseBody, z } from '../_shared/validate.ts';

const Body = z.object({
  league_id: z.string().uuid(),
});

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
      Deno.env.get("SB_SECRET_KEY")!
    );

    // Verify calling user is commissioner
    const authHeader = req.headers.get('Authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader : `Bearer ${authHeader}`;
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SB_PUBLISHABLE_KEY') ?? '',
      { global: { headers: { Authorization: token ?? '' } } }
    );

    const { data: { user } } = await userClient.auth.getUser();
    if (!user) {
      return errorResponse('Unauthorized', 401);
    }

    const rateLimited = await checkRateLimit(supabase, user.id, 'generate-schedule');
    if (rateLimited) return rateLimited;

    const { league_id } = parseBody(Body, await req.json());

    // Verify commissioner (primary auth path), OR — for imported
    // leagues — a league member when all teams are claimed. Imports
    // don't have a draft to trigger schedule generation, so the
    // natural "ready" signal is "last team claimed," which can happen
    // when any member (not just the commissioner) claims. The
    // all-claimed state is the real authorization here; `created_by`
    // stays required for everything else.
    const { data: league, error: leagueErr } = await supabase
      .from("leagues")
      .select("regular_season_weeks, playoff_weeks, season, season_start_date, schedule_generated, created_by, offseason_step, imported_from")
      .eq("id", league_id)
      .single();

    if (leagueErr || !league) {
      return errorResponse('League not found', 404);
    }

    const isCommissioner = league.created_by === user.id;
    let authorized = isCommissioner;

    if (!authorized && league.imported_from) {
      // Check: caller is a team owner in this league AND every team
      // in the league now has a user_id (fully claimed). The second
      // check is what makes this safe — non-commissioners can only
      // fire when the league state is genuinely "ready to start."
      const [{ data: callerTeam }, { data: unclaimed }] = await Promise.all([
        supabase.from("teams").select("id").eq("league_id", league_id).eq("user_id", user.id).maybeSingle(),
        supabase.from("teams").select("id").eq("league_id", league_id).is("user_id", null).limit(1),
      ]);
      authorized = !!callerTeam && (!unclaimed || unclaimed.length === 0);
    }

    if (!authorized) {
      return errorResponse('Only the commissioner can generate a schedule', 403);
    }

    if (league.schedule_generated) {
      return errorResponse('Schedule already generated', 409);
    }

    const validOffseasonSteps = ['ready_for_new_season', 'rookie_draft_complete'];
    if (league.offseason_step && !validOffseasonSteps.includes(league.offseason_step)) {
      return errorResponse(`Cannot generate schedule during offseason step: ${league.offseason_step}`, 409);
    }

    if (!league.season_start_date) {
      return errorResponse('League has no season_start_date', 400);
    }

    const { data: teams, error: teamsErr } = await supabase
      .from("teams")
      .select("id")
      .eq("league_id", league_id);

    if (teamsErr || !teams || teams.length < 2) {
      return errorResponse('Not enough teams to generate a schedule', 400);
    }

    const teamIds = teams.map((t: { id: string }) => t.id);
    const N = teamIds.length;

    if (N % 2 !== 0 && league.regular_season_weeks % N !== 0) {
      return errorResponse(`With ${N} teams, regular_season_weeks must be a multiple of ${N} for equal bye weeks.`, 400);
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
      if (weeksErr) throw weeksErr;
      throw new Error('Failed to insert schedule weeks');
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
      if (matchupsErr) throw matchupsErr;
    }

    await supabase.from("leagues").update({ schedule_generated: true, offseason_step: null }).eq("id", league_id);

    return jsonResponse({ success: true, total_weeks: totalWeeks, regular_season_matchups: matchupRows.length });
  } catch (err) {
    return handleError(err, 'generate-schedule');
  }
});
