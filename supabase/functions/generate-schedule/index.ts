import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { errorResponse, handleError, jsonResponse } from '../_shared/http.ts';
import { checkRateLimit } from '../_shared/rate-limit.ts';
import { parseBody, z } from '../_shared/validate.ts';
import { week1Length } from '../../../utils/leagueTime.ts';

const Body = z.object({
  league_id: z.string().uuid(),
});

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Whether a stored `season_start_date` actually belongs to `season`. Mirrors
// `startDateBelongsToSeason` in constants/LeagueDefaults.ts — NBA seasons span
// two calendar years ("2025-26" → 2025 & 2026); WNBA is single-year.
function startDateBelongsToSeason(season: string, startDate: string | null): boolean {
  if (!startDate) return false;
  const startYear = parseInt(String(season).split("-")[0], 10);
  const dateYear = Number(startDate.slice(0, 4));
  return dateYear === startYear || dateYear === startYear + 1;
}

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
      .select("regular_season_weeks, playoff_weeks, season, season_start_date, schedule_generated, created_by, offseason_step, imported_from, sport")
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

    // Resolve the season start date. A date that already belongs to the target
    // season (commish-set, or correct from creation) is used as-is. Otherwise —
    // missing, or carried over from the season that just ended after
    // `advance-season` bumped `season` — auto-fill it from the synced game
    // schedule's opening night so the commish doesn't have to. Only when no
    // schedule exists yet for the season do we ask them to set it manually.
    let seasonStartDate = league.season_start_date;
    if (!startDateBelongsToSeason(league.season, seasonStartDate)) {
      const { data: firstGame } = await supabase
        .from("game_schedule")
        .select("game_date")
        .eq("sport", league.sport ?? "nba")
        .eq("season", league.season)
        .order("game_date", { ascending: true })
        .limit(1)
        .maybeSingle();

      if (!firstGame?.game_date) {
        return errorResponse(
          `The ${league.season} schedule isn't available yet, so the start date couldn't be set automatically. Set it in League Info → Season Settings, then start the season.`,
          409,
        );
      }

      seasonStartDate = firstGame.game_date;
      // Persist so League Info + any later calls agree on the resolved date.
      await supabase.from("leagues").update({ season_start_date: seasonStartDate }).eq("id", league_id);
    }

    // Hard guard: the season must start AFTER the latest draft in this league
    // (calendar-day, league-TZ). Otherwise games played on draft day would
    // retroactively credit newly-drafted players. Client paths auto-bump the
    // start date when scheduling; this catches the case where the date was
    // edited directly in the DB or via a path that skipped that check.
    const { data: latestDraft } = await supabase
      .from('drafts')
      .select('draft_date')
      .eq('league_id', league_id)
      .not('draft_date', 'is', null)
      .order('draft_date', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latestDraft?.draft_date) {
      const draftDay = latestDraft.draft_date.slice(0, 10); // YYYY-MM-DD (UTC-ish, good enough here)
      if (seasonStartDate <= draftDay) {
        return errorResponse(
          `Season start (${seasonStartDate}) must be after the draft date (${draftDay}). Update the start date in League Info → Season Settings, or reschedule the draft.`,
          409,
        );
      }
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

    const [sy, sm, sd] = seasonStartDate.split("-").map(Number);

    // Week 1 absorbs any Thu/Fri/Sat/Sun leading days (8-11 day long week
    // ending the second Sunday); Mon/Tue/Wed starts give a 5-7 day Week 1.
    // Week 2+ are always full Mon–Sun. See week1Length in utils/leagueTime.
    const w1Start = new Date(Date.UTC(sy, sm - 1, sd));
    const w1Dow = w1Start.getUTCDay();
    const w1Len = week1Length(w1Dow);
    const w1EndDay = sd + w1Len - 1; // day-of-month for Week 1 Sunday
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
