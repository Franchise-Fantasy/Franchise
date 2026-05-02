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

// When a team queues PlayerX as their drop on a pending_drops trade, then
// INDEPENDENTLY drops a *different* player (PlayerY) — freeing roster space
// without touching PlayerX — execute-trade should skip the now-unnecessary
// queued drop and post a trade_update chat message + push notification so
// the manager isn't surprised to see PlayerX still on their roster.
describe('execute-trade — swapped drops skip the unnecessary queued drop', () => {
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
    '2-team — different player dropped before re-execute: queued drop is skipped, trade completes',
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

      const first = await serverInvoke('execute-trade', { proposal_id: proposalId });
      expect(first.error).toBeNull();
      expect(first.data?.pending_drops).toBe(true);

      // Queue PlayerX as the drop. Pick something other than aSends.
      const currentA = await getRosterPlayerIds(league.leagueId, teamA.id);
      const others = currentA.filter((p) => p !== aSends);
      if (others.length < 2) throw new Error('Need at least 2 droppable candidates');
      const queuedDrop = others[0]; // PlayerX
      const independentlyDropped = others[1]; // PlayerY (different player)
      await setTeamDrops(proposalId, teamA.id, [queuedDrop]);

      // Drop a DIFFERENT player. teamA now has space without needing the
      // queued drop.
      const admin = adminClient();
      await admin
        .from('league_players')
        .delete()
        .eq('league_id', league.leagueId)
        .eq('player_id', independentlyDropped);

      const second = await serverInvoke('execute-trade', { proposal_id: proposalId });
      expect(second.error).toBeNull();
      expect(second.data?.transaction_id).toBeTruthy();

      // Trade transferred as expected.
      expect(await getPlayerOwner(league.leagueId, aSends)).toBe(teamB.id);
      expect(await getPlayerOwner(league.leagueId, bSends1)).toBe(teamA.id);
      expect(await getPlayerOwner(league.leagueId, bSends2)).toBe(teamA.id);
      expect(await getPlayerOwner(league.leagueId, independentlyDropped)).toBeNull();

      // The queued drop is skipped because space already existed. PlayerX
      // remains on teamA — confirms the "skip drop when not needed" path.
      expect(await getPlayerOwner(league.leagueId, queuedDrop)).toBe(teamA.id);

      // trade_proposal_teams.drop_player_ids should be cleaned up to reflect
      // what actually happened (no drop), so the post-trade audit trail is
      // truthful.
      const { data: proposalTeam } = await admin
        .from('trade_proposal_teams')
        .select('drop_player_ids')
        .eq('proposal_id', proposalId)
        .eq('team_id', teamA.id)
        .single();
      expect(proposalTeam?.drop_player_ids ?? []).toEqual([]);

      expect(await getProposalStatus(proposalId)).toBe('completed');
    },
    TIMEOUT,
  );

  it(
    '3-team — different player dropped before re-execute: queued drop is skipped, trade completes',
    async () => {
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
      const others = currentA.filter((p) => p !== aSends);
      if (others.length < 2) throw new Error('Need at least 2 droppable candidates on teamA');
      const queuedDrop = others[0];
      const independentlyDropped = others[1];
      await setTeamDrops(proposalId, teamA.id, [queuedDrop]);

      const admin = adminClient();
      await admin
        .from('league_players')
        .delete()
        .eq('league_id', league.leagueId)
        .eq('player_id', independentlyDropped);

      const second = await serverInvoke('execute-trade', { proposal_id: proposalId });
      expect(second.error).toBeNull();
      expect(second.data?.transaction_id).toBeTruthy();

      expect(await getPlayerOwner(league.leagueId, aSends)).toBe(teamC.id);
      expect(await getPlayerOwner(league.leagueId, bSends)).toBe(teamA.id);
      expect(await getPlayerOwner(league.leagueId, cSends)).toBe(teamA.id);
      expect(await getPlayerOwner(league.leagueId, independentlyDropped)).toBeNull();

      // Queued drop skipped because space already existed.
      expect(await getPlayerOwner(league.leagueId, queuedDrop)).toBe(teamA.id);

      expect(await getProposalStatus(proposalId)).toBe('completed');
    },
    TIMEOUT,
  );
});
