import { getLimitMatchKeys } from '@/utils/roster/rosterSlotsShared';

import { bootstrapTestLeague, BootstrapResult } from '../helpers/bootstrap';
import { adminClient } from '../helpers/clients';
import { restoreCanonicalRosters } from '../helpers/seed';

const TIMEOUT = 30_000;

// Guards the per-position roster-limit enforcement added to
// assert_can_add_free_agent + the position_limit_match_keys SQL helper
// (migration 20260607000001). Two things matter:
//   1. The SQL spectrum logic stays byte-for-byte equivalent to the TS
//      getLimitMatchKeys (rosterSlotsShared.ts) — they are a hand-maintained
//      paired pair, so this is the drift gate.
//   2. The RPC blocks an add that would exceed a position cap, and allows it
//      when a queued drop of the same position offsets it.
describe('position limits — SQL/TS parity + RPC enforcement', () => {
  const admin = adminClient();

  describe('position_limit_match_keys SQL == getLimitMatchKeys TS', () => {
    const tokens = [
      'PG', 'SG', 'SF', 'PF', 'C', 'G', 'F',
      'PG-SG', 'SG-SF', 'SF-PF', 'PF-C',
      'G-F', 'F-C', 'PG-SF', 'PG-C', 'G-C',
    ];

    it.each(tokens)('matches for "%s"', async (token) => {
      const { data, error } = await admin.rpc('position_limit_match_keys', {
        p_position: token,
      });
      expect(error).toBeNull();
      // Order isn't part of the contract — compare as sorted sets.
      expect([...(data as string[])].sort()).toEqual(
        [...getLimitMatchKeys(token)].sort(),
      );
    }, TIMEOUT);
  });

  describe('assert_can_add_free_agent — position cap', () => {
    let league: BootstrapResult;
    let teamId: string;
    let limitKey: string;
    let limitCount: number;
    let blockedPlayerIds: string[]; // teamA players counting toward limitKey
    let freeAgentId: string; // a player counting toward limitKey, not in the league

    beforeAll(async () => {
      league = await bootstrapTestLeague();
      await restoreCanonicalRosters(league.leagueId);
      const bot = league.teams.find((t) => typeof t.botIndex === 'number');
      if (!bot) throw new Error('No bot team found');
      teamId = bot.id;

      // Compute the team's active (non IR/TAXI) position-key counts the same
      // way checkPositionLimits does, then pick the key with the most players
      // so the cap is easy to saturate.
      const { data: roster } = await admin
        .from('league_players')
        .select('player_id, position, roster_slot')
        .eq('league_id', league.leagueId)
        .eq('team_id', teamId);
      const active = (roster ?? []).filter(
        (r) => !['IR', 'TAXI'].includes(r.roster_slot ?? ''),
      );
      const counts: Record<string, number> = {};
      const playersByKey: Record<string, string[]> = {};
      for (const r of active) {
        for (const k of getLimitMatchKeys(r.position ?? '')) {
          counts[k] = (counts[k] ?? 0) + 1;
          (playersByKey[k] ??= []).push(r.player_id);
        }
      }
      [limitKey, limitCount] = Object.entries(counts).sort(
        (a, b) => b[1] - a[1],
      )[0];
      blockedPlayerIds = playersByKey[limitKey];

      // Find a player that also counts toward limitKey and is NOT rostered in
      // this league — the free agent we'll try to add.
      const { data: rosteredRows } = await admin
        .from('league_players')
        .select('player_id')
        .eq('league_id', league.leagueId);
      const rostered = new Set((rosteredRows ?? []).map((r) => r.player_id));
      const { data: candidates } = await admin
        .from('players')
        .select('id, position')
        .eq('is_prospect', false)
        .not('position', 'is', null)
        .not('pro_team', 'is', null)
        .limit(400);
      const fa = (candidates ?? []).find(
        (p) =>
          !rostered.has(p.id) &&
          getLimitMatchKeys(p.position ?? '').includes(limitKey),
      );
      if (!fa) throw new Error(`No free agent found counting toward ${limitKey}`);
      freeAgentId = fa.id;
    }, TIMEOUT);

    afterEach(async () => {
      await admin
        .from('pending_transactions')
        .delete()
        .eq('league_id', league.leagueId)
        .eq('team_id', teamId);
    }, TIMEOUT);

    afterAll(async () => {
      await admin
        .from('leagues')
        .update({ position_limits: null })
        .eq('id', league.leagueId);
      await admin
        .from('pending_transactions')
        .delete()
        .eq('league_id', league.leagueId)
        .eq('team_id', teamId);
    }, TIMEOUT);

    it(
      'blocks an add that would exceed the position cap',
      async () => {
        // Set the cap exactly at the current count, so adding one more violates.
        await admin
          .from('leagues')
          .update({ position_limits: { [limitKey]: limitCount } })
          .eq('id', league.leagueId);

        const { error } = await admin.rpc('assert_can_add_free_agent', {
          p_league_id: league.leagueId,
          p_team_id: teamId,
          p_player_id: freeAgentId,
        });
        expect(error).not.toBeNull();
        expect(error?.message).toMatch(/position_limit_full/);
      },
      TIMEOUT,
    );

    it(
      'allows the add when a queued drop of the same position offsets it',
      async () => {
        await admin
          .from('leagues')
          .update({ position_limits: { [limitKey]: limitCount } })
          .eq('id', league.leagueId);

        // Queue a drop of one player counting toward the capped key — this
        // frees a slot, so the add should now pass.
        await admin.from('pending_transactions').insert({
          league_id: league.leagueId,
          team_id: teamId,
          player_id: blockedPlayerIds[0],
          target_player_id: blockedPlayerIds[0],
          action_type: 'drop',
          status: 'pending',
          execute_after: new Date(Date.now() + 86_400_000).toISOString(),
        });

        const { error } = await admin.rpc('assert_can_add_free_agent', {
          p_league_id: league.leagueId,
          p_team_id: teamId,
          p_player_id: freeAgentId,
        });
        expect(error).toBeNull();
      },
      TIMEOUT,
    );

    it(
      'allows the add when no position limits are configured',
      async () => {
        await admin
          .from('leagues')
          .update({ position_limits: null })
          .eq('id', league.leagueId);

        const { error } = await admin.rpc('assert_can_add_free_agent', {
          p_league_id: league.leagueId,
          p_team_id: teamId,
          p_player_id: freeAgentId,
        });
        expect(error).toBeNull();
      },
      TIMEOUT,
    );
  });
});
