import { bootstrapTestLeague, BootstrapResult } from '../helpers/bootstrap';
import { resetTrades, restorePlayerOwnership } from '../helpers/cleanup';
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

describe('execute-trade with drops', () => {
  let league: BootstrapResult;
  let teamA: BootstrapResult['teams'][number]; // bot1 (commissioner)
  let teamB: BootstrapResult['teams'][number]; // bot2
  let originalRosterSize: number;
  // Players: A sends 1, B sends 2. A net +1 → needs drop.
  let aSends: string;
  let bSends1: string;
  let bSends2: string;

  beforeAll(async () => {
    league = await bootstrapTestLeague();
    await resetTrades(league.leagueId);
    await restoreCanonicalRosters(league.leagueId);
    const bots = league.teams
      .filter((t) => typeof t.botIndex === 'number')
      .sort((a, b) => (a.botIndex as number) - (b.botIndex as number));
    teamA = bots[0];
    teamB = bots[1];

    // Pick from canonical (not current roster) so these players are guaranteed
    // to be restored between tests by restoreCanonicalRosters.
    const [rosterA, rosterB] = await Promise.all([
      getCanonicalRosterPlayerIds(league.leagueId, teamA.id),
      getCanonicalRosterPlayerIds(league.leagueId, teamB.id),
    ]);
    if (rosterA.length < 1 || rosterB.length < 2) {
      throw new Error('Need teamA ≥ 1 and teamB ≥ 2 players to test drops');
    }
    aSends = rosterA[0];
    bSends1 = rosterB[0];
    bSends2 = rosterB[1];

    // Shrink roster cap so the 2-for-1 triggers pending_drops on teamA.
    // teamA: 4 - 1 + 2 = 5 > 4 → drops required.
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
    'sets status to pending_drops when roster would overflow, then completes after drops are submitted',
    async () => {
      const { proposalId } = await createAcceptedTrade({
        leagueId: league.leagueId,
        proposedByTeamId: teamA.id,
        items: [
          { fromTeamId: teamA.id, toTeamId: teamB.id, playerId: aSends },
          { fromTeamId: teamB.id, toTeamId: teamA.id, playerId: bSends1 },
          { fromTeamId: teamB.id, toTeamId: teamA.id, playerId: bSends2 },
        ],
      });

      // First execute: should detect overflow and set pending_drops.
      const firstResp = await serverInvoke('execute-trade', {
        proposal_id: proposalId,
      });
      expect(firstResp.error).toBeNull();
      expect(firstResp.data?.pending_drops).toBe(true);
      expect(await getProposalStatus(proposalId)).toBe('pending_drops');

      // No ownership changes yet.
      expect(await getPlayerOwner(league.leagueId, aSends)).toBe(teamA.id);
      expect(await getPlayerOwner(league.leagueId, bSends1)).toBe(teamB.id);

      // User submits the drop selection on teamA.
      const rosterA = await getRosterPlayerIds(league.leagueId, teamA.id);
      const dropCandidate = rosterA.find((p) => p !== aSends);
      if (!dropCandidate) throw new Error('No drop candidate on teamA');
      await setTeamDrops(proposalId, teamA.id, [dropCandidate]);

      // Re-execute: should now complete.
      const secondResp = await serverInvoke('execute-trade', {
        proposal_id: proposalId,
      });
      expect(secondResp.error).toBeNull();
      expect(secondResp.data?.transaction_id).toBeTruthy();

      // Ownership transferred.
      expect(await getPlayerOwner(league.leagueId, aSends)).toBe(teamB.id);
      expect(await getPlayerOwner(league.leagueId, bSends1)).toBe(teamA.id);
      expect(await getPlayerOwner(league.leagueId, bSends2)).toBe(teamA.id);
      // The dropped player is off the roster entirely.
      expect(await getPlayerOwner(league.leagueId, dropCandidate)).toBeNull();

      expect(await getProposalStatus(proposalId)).toBe('completed');
    },
    TIMEOUT,
  );

  it(
    'cancelling a pending_drops trade unblocks the involved players for a new trade',
    async () => {
      const { proposalId: firstId } = await createAcceptedTrade({
        leagueId: league.leagueId,
        proposedByTeamId: teamA.id,
        items: [
          { fromTeamId: teamA.id, toTeamId: teamB.id, playerId: aSends },
          { fromTeamId: teamB.id, toTeamId: teamA.id, playerId: bSends1 },
          { fromTeamId: teamB.id, toTeamId: teamA.id, playerId: bSends2 },
        ],
      });

      await serverInvoke('execute-trade', { proposal_id: firstId });
      expect(await getProposalStatus(firstId)).toBe('pending_drops');

      // Cancel the pending_drops trade.
      const admin = adminClient();
      await admin.from('trade_proposals').update({ status: 'cancelled' }).eq('id', firstId);
      expect(await getProposalStatus(firstId)).toBe('cancelled');

      // Now a NEW 1-for-1 trade with one of the previously-locked players
      // should be allowed — the locked-asset check excludes cancelled trades.
      const { proposalId: secondId } = await createAcceptedTrade({
        leagueId: league.leagueId,
        proposedByTeamId: teamA.id,
        items: [
          { fromTeamId: teamA.id, toTeamId: teamB.id, playerId: aSends },
          { fromTeamId: teamB.id, toTeamId: teamA.id, playerId: bSends1 },
        ],
      });
      const resp = await serverInvoke('execute-trade', {
        proposal_id: secondId,
      });
      expect(resp.error).toBeNull();
      expect(resp.data?.transaction_id).toBeTruthy();
      expect(await getPlayerOwner(league.leagueId, aSends)).toBe(teamB.id);
      expect(await getPlayerOwner(league.leagueId, bSends1)).toBe(teamA.id);
    },
    TIMEOUT,
  );
});
