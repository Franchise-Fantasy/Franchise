import { adminClient, signInAsBot } from '../helpers/clients';
import {
  bootstrapLifecycleLeague,
  resetToSeasonComplete,
  clearRateLimits,
  LifecycleBootstrap,
} from '../helpers/lifecycle';

const TIMEOUT = 45_000;

/**
 * Exercises the Keeper-specific finalize flow:
 *   advance-season → keeper_pending → (teams insert keeper_declarations) →
 *   finalize-keepers → ready_for_new_season
 *
 * Asserts: only declared keepers remain on rosters, declarations cleared,
 * offseason_step advances, and the function enforces league_type + state.
 */
describe('finalize-keepers (Keeper)', () => {
  let league: LifecycleBootstrap;

  beforeAll(async () => {
    league = await bootstrapLifecycleLeague('keeper');
  }, TIMEOUT);

  beforeEach(async () => {
    await resetToSeasonComplete(league);
    await clearRateLimits(league.commissionerUserId, [
      'advance-season',
      'finalize-keepers',
    ]);
  }, TIMEOUT);

  it(
    'retains declared keepers, releases the rest, and advances to ready_for_new_season',
    async () => {
      const admin = adminClient();
      const { leagueId, teams, canonicalPlayerIds } = league;
      const client = await signInAsBot(1);

      // Step 1: advance-season → keeper_pending
      const advance = await client.functions.invoke('advance-season', {
        body: { league_id: leagueId },
      });
      expect(advance.error).toBeNull();
      expect(advance.data).toMatchObject({ offseason_step: 'keeper_pending' });

      // At this point rosters are still intact. Each team has 2 canonical players.
      // We declare the first player per team as a keeper. Second stays un-declared
      // and should be released.
      const newSeason = advance.data.new_season as string;
      const declaredKeeperIds: string[] = [];
      const nonKeeperIds: string[] = [];
      const keeperDeclarations = teams.map((team, ti) => {
        const keeperPlayerId = canonicalPlayerIds[ti][0];
        const cutPlayerId = canonicalPlayerIds[ti][1];
        declaredKeeperIds.push(keeperPlayerId);
        nonKeeperIds.push(cutPlayerId);
        return {
          league_id: leagueId,
          team_id: team.id,
          player_id: keeperPlayerId,
          season: newSeason,
        };
      });
      const { error: declErr } = await admin
        .from('keeper_declarations')
        .insert(keeperDeclarations);
      expect(declErr).toBeNull();

      // Step 2: finalize-keepers
      const finalize = await client.functions.invoke('finalize-keepers', {
        body: { league_id: leagueId },
      });
      expect(finalize.error).toBeNull();
      expect(finalize.data).toMatchObject({
        message: expect.stringContaining('Keepers finalized'),
        kept_count: teams.length,
      });

      // League advanced
      const { data: leagueRow } = await admin
        .from('leagues')
        .select('offseason_step')
        .eq('id', leagueId)
        .single();
      expect(leagueRow?.offseason_step).toBe('ready_for_new_season');

      // Only declared keepers remain on any league roster
      const { data: remaining } = await admin
        .from('league_players')
        .select('player_id, team_id')
        .eq('league_id', leagueId);
      const remainingPids = new Set((remaining ?? []).map((r) => r.player_id));
      for (const kept of declaredKeeperIds) {
        expect(remainingPids.has(kept)).toBe(true);
      }
      for (const cut of nonKeeperIds) {
        expect(remainingPids.has(cut)).toBe(false);
      }

      // Declarations for the new season were cleaned up
      const { data: leftoverDecls } = await admin
        .from('keeper_declarations')
        .select('id')
        .eq('league_id', leagueId)
        .eq('season', newSeason);
      expect((leftoverDecls ?? []).length).toBe(0);
    },
    TIMEOUT,
  );

  it(
    'releases all rosters when no keepers are declared',
    async () => {
      const admin = adminClient();
      const { leagueId } = league;
      const client = await signInAsBot(1);

      await client.functions.invoke('advance-season', { body: { league_id: leagueId } });

      // No keeper_declarations inserted — finalize should wipe every player.
      const finalize = await client.functions.invoke('finalize-keepers', {
        body: { league_id: leagueId },
      });
      expect(finalize.error).toBeNull();
      expect(finalize.data).toMatchObject({ kept_count: 0 });

      const { data: remaining } = await admin
        .from('league_players')
        .select('id')
        .eq('league_id', leagueId);
      expect((remaining ?? []).length).toBe(0);
    },
    TIMEOUT,
  );

  it(
    'rejects calls outside the keeper_pending state',
    async () => {
      const { leagueId } = league;
      const client = await signInAsBot(1);

      // State is "regular season complete" — offseason_step still null, not
      // keeper_pending. The function must refuse.
      const { error } = await client.functions.invoke('finalize-keepers', {
        body: { league_id: leagueId },
      });
      expect(error).not.toBeNull();
    },
    TIMEOUT,
  );
});

/**
 * finalize-keepers must refuse to run against non-Keeper leagues.
 */
describe('finalize-keepers (non-Keeper rejection)', () => {
  let dynastyLeague: LifecycleBootstrap;

  beforeAll(async () => {
    dynastyLeague = await bootstrapLifecycleLeague('dynasty');
  }, TIMEOUT);

  beforeEach(async () => {
    await resetToSeasonComplete(dynastyLeague);
    await clearRateLimits(dynastyLeague.commissionerUserId, [
      'advance-season',
      'finalize-keepers',
    ]);
  }, TIMEOUT);

  it(
    'rejects when called on a Dynasty league',
    async () => {
      const { leagueId } = dynastyLeague;
      const client = await signInAsBot(1);

      // Advance to offseason so state isn't the blocker — league_type is.
      await client.functions.invoke('advance-season', { body: { league_id: leagueId } });

      const { error } = await client.functions.invoke('finalize-keepers', {
        body: { league_id: leagueId },
      });
      expect(error).not.toBeNull();
    },
    TIMEOUT,
  );
});
