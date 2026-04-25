import { adminClient, signInAsBot } from '../helpers/clients';
import {
  bootstrapLifecycleLeague,
  resetToSeasonComplete,
  clearRateLimits,
  LifecycleBootstrap,
} from '../helpers/lifecycle';

const TIMEOUT = 45_000;

/**
 * Exercises the Dynasty-specific offseason chain:
 *   advance-season → start-lottery (or run-lottery) → create-rookie-draft
 *
 * Seeds a season-complete Dynasty league, then steps through each transition
 * and asserts offseason_step + side-effects after each.
 */
describe('Dynasty offseason chain', () => {
  let league: LifecycleBootstrap;

  beforeAll(async () => {
    league = await bootstrapLifecycleLeague('dynasty');
  }, TIMEOUT);

  beforeEach(async () => {
    await resetToSeasonComplete(league);
    await clearRateLimits(league.commissionerUserId, [
      'advance-season',
      'start-lottery',
      'run-lottery',
      'create-rookie-draft',
    ]);
  }, TIMEOUT);

  it(
    'advance-season → start-lottery → create-rookie-draft produces a linked rookie draft with ordered picks',
    async () => {
      const admin = adminClient();
      const { leagueId, teams } = league;
      const client = await signInAsBot(1);

      // ── Step 1: advance-season ──
      const advance = await client.functions.invoke('advance-season', {
        body: { league_id: leagueId },
      });
      expect(advance.error).toBeNull();
      expect(advance.data).toMatchObject({ offseason_step: 'lottery_pending' });

      // ── Step 2: start-lottery ──
      const lottery = await client.functions.invoke('start-lottery', {
        body: { league_id: leagueId },
      });
      expect(lottery.error).toBeNull();
      expect(lottery.data).toMatchObject({
        message: expect.stringContaining('Lottery completed'),
      });
      // lottery_pool_size == total teams − playoff teams == 4 − 2 == 2
      expect(lottery.data.lottery_pool_size).toBe(2);
      expect(Array.isArray(lottery.data.results)).toBe(true);
      expect(lottery.data.results).toHaveLength(2);

      const { data: leagueRowAfterLottery } = await admin
        .from('leagues')
        .select('offseason_step, lottery_status, season')
        .eq('id', leagueId)
        .single();
      expect(leagueRowAfterLottery?.offseason_step).toBe('lottery_complete');
      expect(leagueRowAfterLottery?.lottery_status).toBe('complete');

      // lottery_results row persisted for the new season
      const newSeason = leagueRowAfterLottery?.season as string;
      const { data: lotteryResults } = await admin
        .from('lottery_results')
        .select('results')
        .eq('league_id', leagueId)
        .eq('season', newSeason)
        .single();
      expect(lotteryResults?.results).toBeTruthy();

      // Top lottery pick belongs to one of the two non-playoff teams (bot3 or bot4)
      const nonPlayoffTeamIds = new Set([
        teams.find((t) => t.botIndex === 3)!.id,
        teams.find((t) => t.botIndex === 4)!.id,
      ]);
      const topLotteryTeamId = (lottery.data.results as any[])[0].team_id;
      expect(nonPlayoffTeamIds.has(topLotteryTeamId)).toBe(true);

      // Draft picks for the new season now have slot_number + pick_number assigned.
      // 4 teams × 2 rounds = 8 picks.
      const { data: picks } = await admin
        .from('draft_picks')
        .select('round, slot_number, pick_number, current_team_id, original_team_id')
        .eq('league_id', leagueId)
        .eq('season', newSeason)
        .order('round')
        .order('slot_number');
      expect(picks).toHaveLength(8);
      // Slot 1 in each round goes to the lottery #1 team
      const round1 = picks!.filter((p) => p.round === 1);
      expect(round1[0].slot_number).toBe(1);
      expect(round1[0].pick_number).toBe(1);
      expect(round1[0].original_team_id).toBe(topLotteryTeamId);

      // ── Step 3: create-rookie-draft ──
      const rookie = await client.functions.invoke('create-rookie-draft', {
        body: { league_id: leagueId },
      });
      expect(rookie.error).toBeNull();
      expect(rookie.data).toMatchObject({
        message: expect.stringContaining('Rookie draft created'),
        draft_id: expect.any(String),
      });

      const draftId = rookie.data.draft_id as string;
      const { data: draft } = await admin
        .from('drafts')
        .select('type, status, rounds, picks_per_round, season')
        .eq('id', draftId)
        .single();
      expect(draft).toMatchObject({
        type: 'rookie',
        status: 'unscheduled',
        rounds: 2,
        picks_per_round: 4,
        season: newSeason,
      });

      // All 8 picks linked to the new draft
      const { data: linkedPicks } = await admin
        .from('draft_picks')
        .select('id')
        .eq('league_id', leagueId)
        .eq('draft_id', draftId);
      expect(linkedPicks).toHaveLength(8);

      // League advanced past rookie_draft_pending (the edge function sets it
      // to rookie_draft_pending even when called from lottery_complete)
      const { data: leagueRowAfterRookie } = await admin
        .from('leagues')
        .select('offseason_step')
        .eq('id', leagueId)
        .single();
      expect(leagueRowAfterRookie?.offseason_step).toBe('rookie_draft_pending');
    },
    TIMEOUT,
  );

  it(
    'create-rookie-draft rejects when called twice for the same season',
    async () => {
      const { leagueId } = league;
      const client = await signInAsBot(1);

      await client.functions.invoke('advance-season', { body: { league_id: leagueId } });
      await client.functions.invoke('start-lottery', { body: { league_id: leagueId } });

      const first = await client.functions.invoke('create-rookie-draft', {
        body: { league_id: leagueId },
      });
      expect(first.error).toBeNull();

      const second = await client.functions.invoke('create-rookie-draft', {
        body: { league_id: leagueId },
      });
      // Second call should fail — a rookie draft already exists for this season.
      expect(second.error).not.toBeNull();
    },
    TIMEOUT,
  );

  it(
    'start-lottery refuses to run outside the lottery_pending/scheduled states',
    async () => {
      const { leagueId } = league;
      const client = await signInAsBot(1);

      // No advance-season call → offseason_step is null → start-lottery should reject.
      const { error } = await client.functions.invoke('start-lottery', {
        body: { league_id: leagueId },
      });
      expect(error).not.toBeNull();
    },
    TIMEOUT,
  );
});
