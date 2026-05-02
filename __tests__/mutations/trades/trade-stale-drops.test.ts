import { bootstrapTestLeague, BootstrapResult } from '../helpers/bootstrap';
import { resetTrades } from '../helpers/cleanup';
import { adminClient, serverInvoke } from '../helpers/clients';
import {
  createAcceptedTrade,
  getRosterPlayerIds,
  getPlayerOwner,
  setLeagueRosterSize,
  setTeamDrops,
  getProposalStatus,
  restoreCanonicalRosters,
  getCanonicalRosterPlayerIds,
} from '../helpers/seed';

const TIMEOUT = 30_000;

// When a team queues a drop on a pending_drops trade and then drops that same
// player independently (e.g. via free agency / waiver) BEFORE the trade
// re-executes, the trade should still complete cleanly. The edge function
// detects the stale drop and skips it — the roster space is already free.
describe('execute-trade — stale queued drops (player already gone)', () => {
  let league: BootstrapResult;
  let teamA: BootstrapResult['teams'][number];
  let teamB: BootstrapResult['teams'][number];
  let teamC: BootstrapResult['teams'][number];
  let originalRosterSize: number;

  beforeAll(async () => {
    league = await bootstrapTestLeague();
    await resetTrades(league.leagueId);
    await restoreCanonicalRosters(league.leagueId);
    const bots = league.teams
      .filter((t) => typeof t.botIndex === 'number')
      .sort((a, b) => (a.botIndex as number) - (b.botIndex as number));
    teamA = bots[0];
    teamB = bots[1];
    teamC = bots[2];

    // Shrink to 4 so a 2-for-1 to teamA forces pending_drops.
    originalRosterSize = await setLeagueRosterSize(league.leagueId, 4);
  }, TIMEOUT);

  afterAll(async () => {
    await setLeagueRosterSize(league.leagueId, originalRosterSize);
  }, TIMEOUT);

  beforeEach(async () => {
    await resetTrades(league.leagueId);
    await restoreCanonicalRosters(league.leagueId);
  }, TIMEOUT);

  it(
    '2-team — queued drop player was already removed: trade completes, no error',
    async () => {
      const [rosterA, rosterB] = await Promise.all([
        getCanonicalRosterPlayerIds(league.leagueId, teamA.id),
        getCanonicalRosterPlayerIds(league.leagueId, teamB.id),
      ]);
      const aSends = rosterA[0];
      const bSends1 = rosterB[0];
      const bSends2 = rosterB[1];

      const { proposalId } = await createAcceptedTrade({
        leagueId: league.leagueId,
        proposedByTeamId: teamA.id,
        items: [
          { fromTeamId: teamA.id, toTeamId: teamB.id, playerId: aSends },
          { fromTeamId: teamB.id, toTeamId: teamA.id, playerId: bSends1 },
          { fromTeamId: teamB.id, toTeamId: teamA.id, playerId: bSends2 },
        ],
      });

      // First execute: teamA needs a drop (4 - 1 + 2 = 5 > 4).
      const first = await serverInvoke('execute-trade', { proposal_id: proposalId });
      expect(first.error).toBeNull();
      expect(first.data?.pending_drops).toBe(true);

      // Queue a drop on teamA.
      const currentA = await getRosterPlayerIds(league.leagueId, teamA.id);
      const queuedDrop = currentA.find((p) => p !== aSends);
      if (!queuedDrop) throw new Error('No drop candidate on teamA');
      await setTeamDrops(proposalId, teamA.id, [queuedDrop]);

      // Simulate the manager dropping that player INDEPENDENTLY before the
      // trade re-executes (e.g. dropped them to clear a waiver claim).
      const admin = adminClient();
      await admin
        .from('league_players')
        .delete()
        .eq('league_id', league.leagueId)
        .eq('player_id', queuedDrop);

      // Re-execute. The edge function should detect the stale drop, skip it,
      // and complete the trade — teamA now has space because the player they
      // queued is already gone.
      const second = await serverInvoke('execute-trade', { proposal_id: proposalId });
      expect(second.error).toBeNull();
      expect(second.data?.transaction_id).toBeTruthy();

      // Ownership transferred.
      expect(await getPlayerOwner(league.leagueId, aSends)).toBe(teamB.id);
      expect(await getPlayerOwner(league.leagueId, bSends1)).toBe(teamA.id);
      expect(await getPlayerOwner(league.leagueId, bSends2)).toBe(teamA.id);
      // Queued drop stays gone.
      expect(await getPlayerOwner(league.leagueId, queuedDrop)).toBeNull();

      expect(await getProposalStatus(proposalId)).toBe('completed');
    },
    TIMEOUT,
  );

  it(
    '3-team — queued drop player was already removed: trade completes, no error',
    async () => {
      // teamA receives 2 (from teamB and teamC), sends 1 to teamC. Net +1.
      // teamB receives 0, sends 1. teamC receives 1, sends 1. Net 0 elsewhere.
      const [rosterA, rosterB, rosterC] = await Promise.all([
        getCanonicalRosterPlayerIds(league.leagueId, teamA.id),
        getCanonicalRosterPlayerIds(league.leagueId, teamB.id),
        getCanonicalRosterPlayerIds(league.leagueId, teamC.id),
      ]);
      const aSends = rosterA[0];
      const bSends = rosterB[0];
      const cSends = rosterC[0];

      const { proposalId } = await createAcceptedTrade({
        leagueId: league.leagueId,
        proposedByTeamId: teamA.id,
        items: [
          { fromTeamId: teamA.id, toTeamId: teamC.id, playerId: aSends },
          { fromTeamId: teamB.id, toTeamId: teamA.id, playerId: bSends },
          { fromTeamId: teamC.id, toTeamId: teamA.id, playerId: cSends },
        ],
      });

      const first = await serverInvoke('execute-trade', { proposal_id: proposalId });
      expect(first.error).toBeNull();
      expect(first.data?.pending_drops).toBe(true);

      const currentA = await getRosterPlayerIds(league.leagueId, teamA.id);
      const queuedDrop = currentA.find((p) => p !== aSends);
      if (!queuedDrop) throw new Error('No drop candidate on teamA');
      await setTeamDrops(proposalId, teamA.id, [queuedDrop]);

      const admin = adminClient();
      await admin
        .from('league_players')
        .delete()
        .eq('league_id', league.leagueId)
        .eq('player_id', queuedDrop);

      const second = await serverInvoke('execute-trade', { proposal_id: proposalId });
      expect(second.error).toBeNull();
      expect(second.data?.transaction_id).toBeTruthy();

      expect(await getPlayerOwner(league.leagueId, aSends)).toBe(teamC.id);
      expect(await getPlayerOwner(league.leagueId, bSends)).toBe(teamA.id);
      expect(await getPlayerOwner(league.leagueId, cSends)).toBe(teamA.id);
      expect(await getPlayerOwner(league.leagueId, queuedDrop)).toBeNull();

      expect(await getProposalStatus(proposalId)).toBe('completed');
    },
    TIMEOUT,
  );
});
