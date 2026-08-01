import { adminClient, signInAsBot } from '../helpers/clients';
import { expectHttpError } from '../helpers/expect';
import {
  bootstrapLifecycleLeague,
  resetToSeasonComplete,
  clearRateLimits,
  LifecycleBootstrap,
} from '../helpers/lifecycle';
import { pickFreeAgentPlayer } from '../helpers/seed';

const TIMEOUT = 180_000;

/**
 * Picks up where dynasty-offseason-chain leaves off. That suite proves the
 * offseason chain up to draft CREATION (advance-season → start-lottery →
 * create-rookie-draft); this one runs the rookie draft to its last pick and
 * carries the league into the next season:
 *
 *   schedule draft → start-draft → make-draft-pick ×N → generate-schedule
 *
 * The two transitions it exists to protect are the ones nothing else covers:
 *   1. the FINAL rookie pick flipping offseason_step to 'rookie_draft_complete'
 *      and arming the dynasty roster-cuts deadline (execute_draft_pick →
 *      arm_roster_cuts_deadline), and
 *   2. generate-schedule accepting that step and clearing offseason_step, which
 *      is the moment the league is back in-season.
 */
describe('Dynasty rookie draft → new season', () => {
  let league: LifecycleBootstrap;

  // The 4-team lifecycle league drafts 2 rounds → 8 picks.
  const EXPECTED_PICKS = 8;

  // The commissioner sets this in League Info → Season Settings. It can't be
  // auto-resolved here: generate-schedule falls back to the first `game_schedule`
  // row for the season, and no real 2027-28 NBA schedule has been synced. It
  // must also land AFTER the draft date, which generate-schedule enforces.
  const NEW_SEASON_START = '2027-10-19';

  beforeAll(async () => {
    league = await bootstrapLifecycleLeague('dynasty');
  }, TIMEOUT);

  beforeEach(async () => {
    await resetToSeasonComplete(league);
    await clearGeneratedSchedule();
    // Every bot picks, so clear the whole league's buckets, not just the
    // commissioner's.
    for (const team of league.teams) {
      await clearRateLimits(team.userId, [
        'advance-season',
        'start-lottery',
        'create-rookie-draft',
        'start-draft',
        'make-draft-pick',
        'generate-schedule',
      ]);
    }
  }, TIMEOUT);

  /**
   * Drop any schedule this suite generated on a previous run.
   *
   * Deliberately NOT part of resetToSeasonComplete: advance_season_atomic keeps
   * old `league_schedule` rows on purpose (they're season-scoped history that
   * the schedule/scoreboard pages still read), so "rewind to season complete"
   * shouldn't delete them. But this is the only suite that calls
   * generate-schedule, and without this a second run would stack a second set
   * of 2027-28 weeks on top of the first.
   */
  async function clearGeneratedSchedule(): Promise<void> {
    const admin = adminClient();
    const { data: weeks } = await admin
      .from('league_schedule')
      .select('id')
      .eq('league_id', league.leagueId);
    const weekIds = (weeks ?? []).map((w) => w.id);
    if (weekIds.length > 0) {
      // week_scores and league_matchups both FK to league_schedule.
      await admin.from('week_scores').delete().in('schedule_id', weekIds);
      await admin.from('league_matchups').delete().in('schedule_id', weekIds);
      await admin.from('league_schedule').delete().in('id', weekIds);
    }
  }

  /** Drive the offseason up to a created, unscheduled rookie draft. */
  async function advanceToRookieDraft(): Promise<{ draftId: string; newSeason: string }> {
    const admin = adminClient();
    const commish = await signInAsBot(1);
    const { leagueId } = league;

    const advance = await commish.functions.invoke('advance-season', {
      body: { league_id: leagueId },
    });
    expect(advance.error).toBeNull();

    const lottery = await commish.functions.invoke('start-lottery', {
      body: { league_id: leagueId },
    });
    expect(lottery.error).toBeNull();

    const rookie = await commish.functions.invoke('create-rookie-draft', {
      body: { league_id: leagueId },
    });
    expect(rookie.error).toBeNull();

    const { data: leagueRow } = await admin
      .from('leagues')
      .select('season')
      .eq('id', leagueId)
      .single();

    return { draftId: rookie.data.draft_id as string, newSeason: leagueRow!.season as string };
  }

  it(
    'runs every rookie pick, completes the draft, and starts the next season',
    async () => {
      const admin = adminClient();
      const { leagueId, teams } = league;
      const { draftId, newSeason } = await advanceToRookieDraft();

      // advance-season rolls the league forward a year; the picks the lifecycle
      // fixture seeded are for that season.
      expect(newSeason).toBe('2027-28');

      // ── Schedule the draft ──
      // Mirrors the commissioner UI, which writes `drafts` directly rather than
      // going through an edge function (app/(tabs)/index.tsx). Backdated so
      // start-draft's "has not reached its scheduled start time" gate passes.
      const { data: beforeSchedule } = await admin
        .from('drafts')
        .select('status, rounds, picks_per_round, type')
        .eq('id', draftId)
        .single();
      expect(beforeSchedule).toMatchObject({
        type: 'rookie',
        status: 'unscheduled',
        rounds: 2,
        picks_per_round: 4,
      });

      await admin
        .from('drafts')
        .update({ status: 'pending', draft_date: new Date(Date.now() - 60_000).toISOString() })
        .eq('id', draftId);

      // ── start-draft ──
      const commish = await signInAsBot(1);
      const started = await commish.functions.invoke('start-draft', {
        body: { draft_id: draftId },
      });
      expect(started.error).toBeNull();

      const { data: liveDraft } = await admin
        .from('drafts')
        .select('status, current_pick_number')
        .eq('id', draftId)
        .single();
      expect(liveDraft).toMatchObject({ status: 'in_progress', current_pick_number: 1 });

      // ── Every pick, in the order the lottery assigned ──
      const { data: picks } = await admin
        .from('draft_picks')
        .select('pick_number, current_team_id')
        .eq('draft_id', draftId)
        .order('pick_number');
      expect(picks).toHaveLength(EXPECTED_PICKS);
      // A null pick_number here means create-rookie-draft never committed the
      // lottery staging — the draft would be unplayable.
      expect(picks!.map((p) => p.pick_number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);

      const botIndexByTeam = new Map(teams.map((t) => [t.id, t.botIndex]));
      const clients = new Map<number, Awaited<ReturnType<typeof signInAsBot>>>();
      const draftedPlayerIds: string[] = [];

      for (const pick of picks!) {
        const botIndex = botIndexByTeam.get(pick.current_team_id as string);
        expect(botIndex).toBeTruthy();
        if (!clients.has(botIndex!)) clients.set(botIndex!, await signInAsBot(botIndex!));

        // Re-queried per pick so it never returns a player taken earlier in
        // this loop.
        const fa = await pickFreeAgentPlayer(leagueId);
        const res = await clients.get(botIndex!)!.functions.invoke('make-draft-pick', {
          body: {
            draft_id: draftId,
            player_id: fa.id,
            player_position: fa.position,
            league_id: leagueId,
          },
        });
        expect(res.error).toBeNull();
        draftedPlayerIds.push(fa.id);
      }

      // ── The draft is finished ──
      const { data: finishedDraft } = await admin
        .from('drafts')
        .select('status, current_pick_number')
        .eq('id', draftId)
        .single();
      expect(finishedDraft?.status).toBe('complete');
      expect(finishedDraft?.current_pick_number).toBe(EXPECTED_PICKS + 1);

      // Every pick recorded a player.
      const { data: madePicks } = await admin
        .from('draft_picks')
        .select('pick_number, player_id, selected_at')
        .eq('draft_id', draftId);
      expect(madePicks!.every((p) => p.player_id && p.selected_at)).toBe(true);

      // Drafted players landed on rosters, tagged as rookie-draft acquisitions
      // (the acquired_via branch in execute_draft_pick's p_is_rookie_draft).
      const { data: acquired } = await admin
        .from('league_players')
        .select('player_id, team_id, acquired_via')
        .eq('league_id', leagueId)
        .in('player_id', draftedPlayerIds);
      expect(acquired).toHaveLength(EXPECTED_PICKS);
      expect(acquired!.every((r) => r.acquired_via === 'rookie_draft')).toBe(true);

      // 2 canonical + 2 drafted per team.
      for (const team of teams) {
        const { count } = await admin
          .from('league_players')
          .select('id', { count: 'exact', head: true })
          .eq('league_id', leagueId)
          .eq('team_id', team.id);
        expect(count).toBe(4);
      }

      // ── The final pick advanced the offseason + armed the cuts deadline ──
      const { data: postDraftLeague } = await admin
        .from('leagues')
        .select('offseason_step, roster_cuts_deadline, roster_cuts_grace_days, schedule_generated')
        .eq('id', leagueId)
        .single();
      expect(postDraftLeague?.offseason_step).toBe('rookie_draft_complete');
      // Dynasty + a non-null grace window ⇒ arm_roster_cuts_deadline set a date.
      expect(postDraftLeague?.roster_cuts_grace_days).not.toBeNull();
      expect(postDraftLeague?.roster_cuts_deadline).toBeTruthy();
      // advance-season cleared the old schedule, so the new one can be built.
      expect(postDraftLeague?.schedule_generated).toBe(false);

      // ── Into the new season ──
      // The commissioner's Season Settings date. Without it generate-schedule
      // 409s: there's no synced 2027-28 game_schedule to auto-resolve from.
      await admin
        .from('leagues')
        .update({ season_start_date: NEW_SEASON_START })
        .eq('id', leagueId);

      const schedule = await commish.functions.invoke('generate-schedule', {
        body: { league_id: leagueId },
      });
      expect(schedule.error).toBeNull();
      expect(schedule.data).toMatchObject({ success: true });

      // generate_schedule_atomic clears offseason_step — the league is live again.
      const { data: newSeasonLeague } = await admin
        .from('leagues')
        .select('offseason_step, schedule_generated, season')
        .eq('id', leagueId)
        .single();
      expect(newSeasonLeague?.offseason_step).toBeNull();
      expect(newSeasonLeague?.schedule_generated).toBe(true);
      expect(newSeasonLeague?.season).toBe(newSeason);

      // Weeks + matchups were built for the NEW season.
      const { data: weeks } = await admin
        .from('league_schedule')
        .select('id, week_number, is_playoff')
        .eq('league_id', leagueId)
        .eq('season', newSeason)
        .order('week_number');
      expect(weeks!.length).toBe(5); // 4 regular + 1 playoff
      expect(weeks!.filter((w) => w.is_playoff)).toHaveLength(1);

      const { count: matchupCount } = await admin
        .from('league_matchups')
        .select('id', { count: 'exact', head: true })
        .in('schedule_id', weeks!.map((w) => w.id));
      // 4 regular-season weeks × 2 matchups per week (4 teams).
      expect(matchupCount).toBe(8);
    },
    TIMEOUT,
  );

  it(
    'refuses to start the new season while the rookie draft is still pending',
    async () => {
      // generate-schedule only accepts 'ready_for_new_season' and
      // 'rookie_draft_complete'. A league that created its rookie draft but
      // hasn't run it must not be able to skip straight into the season —
      // that would strand the draft and the incoming class with it.
      const admin = adminClient();
      const { leagueId } = league;
      const { newSeason } = await advanceToRookieDraft();

      await admin
        .from('leagues')
        .update({ season_start_date: NEW_SEASON_START })
        .eq('id', leagueId);

      const commish = await signInAsBot(1);
      const result = await commish.functions.invoke('generate-schedule', {
        body: { league_id: leagueId },
      });
      await expectHttpError(result, { status: 409, messageMatch: /rookie_draft_pending/ });

      // Nothing was built, and the claim flag wasn't burned.
      const { count } = await admin
        .from('league_schedule')
        .select('id', { count: 'exact', head: true })
        .eq('league_id', leagueId)
        .eq('season', newSeason);
      expect(count).toBe(0);

      const { data: stillOffseason } = await admin
        .from('leagues')
        .select('offseason_step, schedule_generated')
        .eq('id', leagueId)
        .single();
      expect(stillOffseason?.offseason_step).toBe('rookie_draft_pending');
      expect(stillOffseason?.schedule_generated).toBe(false);
    },
    TIMEOUT,
  );
});
