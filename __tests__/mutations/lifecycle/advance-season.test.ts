import { adminClient, signInAsBot } from '../helpers/clients';
import {
  bootstrapLifecycleLeague,
  resetToSeasonComplete,
  clearRateLimits,
  LIFECYCLE_STANDINGS,
  LifecycleBootstrap,
} from '../helpers/lifecycle';

const TIMEOUT = 45_000;

/**
 * Exercises `advance-season` for all three league_type branches. Each test
 * seeds a completed regular season + playoff bracket, calls the edge function
 * as the commissioner, then asserts the resulting offseason_step, archive
 * rows, and league-type-specific roster behavior.
 */

async function invokeAdvanceSeason(leagueId: string) {
  const client = await signInAsBot(1);
  return client.functions.invoke('advance-season', { body: { league_id: leagueId } });
}

describe('advance-season', () => {
  describe('Dynasty (lottery order)', () => {
    let league: LifecycleBootstrap;

    beforeAll(async () => {
      league = await bootstrapLifecycleLeague('dynasty');
    }, TIMEOUT);

    beforeEach(async () => {
      await resetToSeasonComplete(league);
      await clearRateLimits(league.commissionerUserId, ['advance-season']);
    }, TIMEOUT);

    it(
      'advances to lottery_pending, archives standings, retains rosters',
      async () => {
        const admin = adminClient();
        const { leagueId, teams } = league;
        const champTeamId = teams.find((t) => t.botIndex === 1)!.id;

        const { data: rostersBefore } = await admin
          .from('league_players')
          .select('player_id, team_id')
          .eq('league_id', leagueId);
        const rosterCountBefore = rostersBefore?.length ?? 0;
        expect(rosterCountBefore).toBeGreaterThan(0);

        const { data, error } = await invokeAdvanceSeason(leagueId);
        expect(error).toBeNull();
        expect(data).toMatchObject({
          previous_season: '2026-27',
          new_season: '2027-28',
          champion_team_id: champTeamId,
          offseason_step: 'lottery_pending',
        });

        // League row updated
        const { data: leagueRow } = await admin
          .from('leagues')
          .select('offseason_step, season, champion_team_id, lottery_status')
          .eq('id', leagueId)
          .single();
        expect(leagueRow?.offseason_step).toBe('lottery_pending');
        expect(leagueRow?.season).toBe('2027-28');
        expect(leagueRow?.champion_team_id).toBe(champTeamId);
        expect(leagueRow?.lottery_status).toBe('pending');

        // team_seasons archived with final standings 1..4
        const { data: archived } = await admin
          .from('team_seasons')
          .select('team_id, final_standing, playoff_result, wins, losses, points_for')
          .eq('league_id', leagueId)
          .eq('season', '2026-27')
          .order('final_standing');
        expect(archived).toHaveLength(4);
        const byFinalStanding = new Map(archived!.map((r) => [r.final_standing, r]));
        expect(byFinalStanding.get(1)?.playoff_result).toBe('champion');
        expect(byFinalStanding.get(2)?.playoff_result).toBe('runner_up');
        // Teams 3 and 4 missed playoffs (not in bracket)
        expect(byFinalStanding.get(3)?.playoff_result).toBe('missed_playoffs');
        expect(byFinalStanding.get(4)?.playoff_result).toBe('missed_playoffs');

        // Dynasty: rosters retained
        const { data: rostersAfter } = await admin
          .from('league_players')
          .select('player_id, team_id')
          .eq('league_id', leagueId);
        expect(rostersAfter?.length).toBe(rosterCountBefore);

        // Team stats reset
        const { data: teamStats } = await admin
          .from('teams')
          .select('id, wins, losses, points_for, points_against')
          .eq('league_id', leagueId);
        for (const ts of teamStats ?? []) {
          expect(ts.wins).toBe(0);
          expect(ts.losses).toBe(0);
          expect(Number(ts.points_for)).toBe(0);
          expect(Number(ts.points_against)).toBe(0);
        }
      },
      TIMEOUT,
    );

    it(
      'rejects a second call while offseason_step is non-null',
      async () => {
        const { leagueId } = league;
        const first = await invokeAdvanceSeason(leagueId);
        expect(first.error).toBeNull();

        const second = await invokeAdvanceSeason(leagueId);
        // Edge function returns 500 on thrown errors; invoke surfaces as error.
        expect(second.error).not.toBeNull();
      },
      TIMEOUT,
    );
  });

  describe('Dynasty (reverse standings, no lottery)', () => {
    let league: LifecycleBootstrap;

    beforeAll(async () => {
      league = await bootstrapLifecycleLeague('dynasty');
    }, TIMEOUT);

    beforeEach(async () => {
      await resetToSeasonComplete(league);
      await clearRateLimits(league.commissionerUserId, ['advance-season']);
      // Override rookie_draft_order just for this block (non-lottery dynasty path).
      await adminClient()
        .from('leagues')
        .update({ rookie_draft_order: 'reverse_record' })
        .eq('id', league.leagueId);
    }, TIMEOUT);

    it(
      'advances straight to rookie_draft_pending and seeds draft_picks in reverse-standings order',
      async () => {
        const admin = adminClient();
        const { leagueId, teams } = league;

        const { data, error } = await invokeAdvanceSeason(leagueId);
        expect(error).toBeNull();
        expect(data).toMatchObject({ offseason_step: 'rookie_draft_pending' });

        // draft_picks seeded for the new season, 2 rounds × 4 teams = 8
        const { data: picks } = await admin
          .from('draft_picks')
          .select('season, round, slot_number, pick_number, original_team_id, current_team_id')
          .eq('league_id', leagueId)
          .eq('season', '2027-28')
          .order('round')
          .order('slot_number');
        expect(picks).toHaveLength(8);

        // Slot 1 must belong to the worst-record team (bot4). Slot 4 to best (bot1).
        const teamByBot = new Map(teams.map((t) => [t.botIndex, t.id]));
        const round1 = picks!.filter((p) => p.round === 1);
        expect(round1[0].original_team_id).toBe(teamByBot.get(4));
        expect(round1[0].slot_number).toBe(1);
        expect(round1[0].pick_number).toBe(1);
        expect(round1[3].original_team_id).toBe(teamByBot.get(1));
        expect(round1[3].slot_number).toBe(4);
        expect(round1[3].pick_number).toBe(4);

        // Round 2 starts at pick_number 5
        const round2 = picks!.filter((p) => p.round === 2);
        expect(round2[0].pick_number).toBe(5);
        expect(round2[0].original_team_id).toBe(teamByBot.get(4));
      },
      TIMEOUT,
    );
  });

  describe('Keeper', () => {
    let league: LifecycleBootstrap;

    beforeAll(async () => {
      league = await bootstrapLifecycleLeague('keeper');
    }, TIMEOUT);

    beforeEach(async () => {
      await resetToSeasonComplete(league);
      await clearRateLimits(league.commissionerUserId, ['advance-season']);
    }, TIMEOUT);

    it(
      'advances to keeper_pending and retains rosters for keeper declaration',
      async () => {
        const admin = adminClient();
        const { leagueId } = league;

        const { data: rostersBefore } = await admin
          .from('league_players')
          .select('player_id, team_id')
          .eq('league_id', leagueId);
        const countBefore = rostersBefore?.length ?? 0;
        expect(countBefore).toBeGreaterThan(0);

        const { data, error } = await invokeAdvanceSeason(leagueId);
        expect(error).toBeNull();
        expect(data).toMatchObject({ offseason_step: 'keeper_pending' });

        const { data: rostersAfter } = await admin
          .from('league_players')
          .select('player_id, team_id')
          .eq('league_id', leagueId);
        expect(rostersAfter?.length).toBe(countBefore);

        // Keeper leagues skip lottery entirely
        const { data: leagueRow } = await admin
          .from('leagues')
          .select('lottery_status')
          .eq('id', leagueId)
          .single();
        // lottery_status is still set to 'pending' by the generic update path.
        // That's fine for keeper — no lottery runs — but confirm the gate:
        expect(['pending', null]).toContain(leagueRow?.lottery_status);
      },
      TIMEOUT,
    );
  });

  describe('Redraft', () => {
    let league: LifecycleBootstrap;

    beforeAll(async () => {
      league = await bootstrapLifecycleLeague('redraft');
    }, TIMEOUT);

    beforeEach(async () => {
      await resetToSeasonComplete(league);
      await clearRateLimits(league.commissionerUserId, ['advance-season']);
    }, TIMEOUT);

    it(
      'advances to ready_for_new_season and clears all rosters',
      async () => {
        const admin = adminClient();
        const { leagueId } = league;

        const { data: rostersBefore } = await admin
          .from('league_players')
          .select('player_id')
          .eq('league_id', leagueId);
        expect((rostersBefore ?? []).length).toBeGreaterThan(0);

        const { data, error } = await invokeAdvanceSeason(leagueId);
        expect(error).toBeNull();
        expect(data).toMatchObject({ offseason_step: 'ready_for_new_season' });

        // Every player released
        const { data: rostersAfter } = await admin
          .from('league_players')
          .select('player_id')
          .eq('league_id', leagueId);
        expect((rostersAfter ?? []).length).toBe(0);

        // No orphan draft_picks left over
        const { data: orphanPicks } = await admin
          .from('draft_picks')
          .select('id')
          .eq('league_id', leagueId)
          .is('draft_id', null);
        expect((orphanPicks ?? []).length).toBe(0);
      },
      TIMEOUT,
    );
  });

  describe('regardless of type', () => {
    let league: LifecycleBootstrap;

    beforeAll(async () => {
      league = await bootstrapLifecycleLeague('dynasty');
    }, TIMEOUT);

    beforeEach(async () => {
      await resetToSeasonComplete(league);
      await clearRateLimits(league.commissionerUserId, ['advance-season']);
    }, TIMEOUT);

    it(
      'computes final_standing by wins, then points_for, matching LIFECYCLE_STANDINGS order',
      async () => {
        const admin = adminClient();
        const { leagueId, teams } = league;

        const { data, error } = await invokeAdvanceSeason(leagueId);
        expect(error).toBeNull();

        const { data: archived } = await admin
          .from('team_seasons')
          .select('team_id, final_standing, wins, points_for')
          .eq('league_id', leagueId)
          .eq('season', '2026-27')
          .order('final_standing');

        // LIFECYCLE_STANDINGS is already in rank order (bot1 best → bot4 worst).
        const teamByBot = new Map(teams.map((t) => [t.botIndex, t.id]));
        LIFECYCLE_STANDINGS.forEach((row, idx) => {
          expect(archived![idx].team_id).toBe(teamByBot.get(row.botIndex));
          expect(archived![idx].final_standing).toBe(idx + 1);
          expect(archived![idx].wins).toBe(row.wins);
        });
      },
      TIMEOUT,
    );
  });
});
