import { bootstrapTestLeague, BootstrapResult } from '../helpers/bootstrap';
import { adminClient, signInAsBot } from '../helpers/clients';
import {
  getRosterPlayerIds,
  getPlayerOwner,
  getPlayerSlot,
  pickFreeAgentPlayer,
  restoreCanonicalRosters,
} from '../helpers/seed';

const TIMEOUT = 30_000;

describe('commissioner-action', () => {
  let league: BootstrapResult;
  let teamCommish: BootstrapResult['teams'][number];
  let teamTarget: BootstrapResult['teams'][number];
  let watcher: BootstrapResult['teams'][number] | undefined;

  beforeAll(async () => {
    league = await bootstrapTestLeague();
    await restoreCanonicalRosters(league.leagueId);
    const bots = league.teams
      .filter((t) => typeof t.botIndex === 'number')
      .sort((a, b) => (a.botIndex as number) - (b.botIndex as number));
    teamCommish = bots[0]; // bot1 is commissioner
    teamTarget = bots[2]; // bot3 — used for add/drop/move so phase-1 trade tests don't collide
    watcher = league.teams.find((t) => t.botIndex === 'watcher');
  }, TIMEOUT);

  // NOTE: these tests mutate teamTarget's roster. Because they run after the
  // trade test file (alphabetical order: roster-moves > trades), any drift is
  // recovered by nuke + re-bootstrap. To keep state sane, each test restores
  // what it mutated before returning.

  it(
    'force_add: inserts a free agent onto a team roster',
    async () => {
      const fa = await pickFreeAgentPlayer(league.leagueId);
      const client = await signInAsBot(1);
      const { data, error } = await client.functions.invoke('commissioner-action', {
        body: {
          action: 'force_add',
          league_id: league.leagueId,
          team_id: teamTarget.id,
          player_id: fa.id,
          position: fa.position,
        },
      });

      expect(error).toBeNull();
      expect(data.message).toMatch(/added/i);
      expect(await getPlayerOwner(league.leagueId, fa.id)).toBe(teamTarget.id);
      expect(await getPlayerSlot(league.leagueId, fa.id)).toBe('BE');

      // Teardown: remove the added player so the roster returns to baseline.
      const admin = adminClient();
      await admin
        .from('league_players')
        .delete()
        .eq('league_id', league.leagueId)
        .eq('player_id', fa.id);
    },
    TIMEOUT,
  );

  it(
    'force_drop: removes a player from a team roster',
    async () => {
      const roster = await getRosterPlayerIds(league.leagueId, teamTarget.id);
      const toDropId = roster[roster.length - 1]; // last player (avoid collisions with other tests)

      const admin = adminClient();
      const { data: preSnapshot } = await admin
        .from('league_players')
        .select('position, roster_slot, acquired_via, acquired_at')
        .eq('league_id', league.leagueId)
        .eq('player_id', toDropId)
        .single();
      expect(preSnapshot).toBeTruthy();

      const client = await signInAsBot(1);
      const { error } = await client.functions.invoke('commissioner-action', {
        body: {
          action: 'force_drop',
          league_id: league.leagueId,
          team_id: teamTarget.id,
          player_id: toDropId,
        },
      });

      expect(error).toBeNull();
      expect(await getPlayerOwner(league.leagueId, toDropId)).toBeNull();

      // Restore the dropped player so subsequent tests see a complete roster.
      await admin.from('league_players').insert({
        league_id: league.leagueId,
        team_id: teamTarget.id,
        player_id: toDropId,
        position: preSnapshot!.position,
        roster_slot: preSnapshot!.roster_slot ?? 'BE',
        acquired_via: preSnapshot!.acquired_via,
        acquired_at: preSnapshot!.acquired_at,
      });
    },
    TIMEOUT,
  );

  it(
    'force_move: changes a player\'s roster slot',
    async () => {
      const roster = await getRosterPlayerIds(league.leagueId, teamTarget.id);
      const toMoveId = roster[0];
      const originalSlot = await getPlayerSlot(league.leagueId, toMoveId);

      const client = await signInAsBot(1);
      const { error } = await client.functions.invoke('commissioner-action', {
        body: {
          action: 'force_move',
          league_id: league.leagueId,
          team_id: teamTarget.id,
          player_id: toMoveId,
          target_slot: 'UTIL',
        },
      });

      expect(error).toBeNull();
      expect(await getPlayerSlot(league.leagueId, toMoveId)).toBe('UTIL');

      // Restore.
      const admin = adminClient();
      await admin
        .from('league_players')
        .update({ roster_slot: originalSlot ?? 'BE' })
        .eq('league_id', league.leagueId)
        .eq('player_id', toMoveId);
    },
    TIMEOUT,
  );

  it(
    'rejects action from a non-commissioner',
    async () => {
      const fa = await pickFreeAgentPlayer(league.leagueId);
      const client = await signInAsBot(3); // bot3 is a regular user

      await client.functions.invoke('commissioner-action', {
        body: {
          action: 'force_add',
          league_id: league.leagueId,
          team_id: teamTarget.id,
          player_id: fa.id,
          position: fa.position,
        },
      });

      // The 500 error is swallowed by supabase-js; the signal is that the player
      // was NOT added.
      expect(await getPlayerOwner(league.leagueId, fa.id)).toBeNull();
    },
    TIMEOUT,
  );

  // Showcase: commissioner force-adds a free agent onto the watcher team so
  // jjspoels receives a push notification and can verify the UI.
  it(
    'showcase — force-adds a free agent onto the watcher team',
    async () => {
      if (!watcher) {
        console.warn('[showcase] watcher team missing — skipping');
        return;
      }
      const fa = await pickFreeAgentPlayer(league.leagueId);
      const client = await signInAsBot(1);
      const { data, error } = await client.functions.invoke('commissioner-action', {
        body: {
          action: 'force_add',
          league_id: league.leagueId,
          team_id: watcher.id,
          player_id: fa.id,
          position: fa.position,
        },
      });

      expect(error).toBeNull();
      expect(data.message).toMatch(/added/i);
      expect(await getPlayerOwner(league.leagueId, fa.id)).toBe(watcher.id);
      // Intentionally do NOT tear down: leaves the player on the watcher's roster
      // so jjspoels can see the add in-app.
    },
    TIMEOUT,
  );
});
