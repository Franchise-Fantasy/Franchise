import { bootstrapTestLeague, BootstrapResult } from '../helpers/bootstrap';
import { resetTrades } from '../helpers/cleanup';
import { adminClient, serverInvoke } from '../helpers/clients';
import {
  createAcceptedTrade,
  ensureDraftPicks,
  getPlayerOwner,
  getPickCurrentOwner,
  getProposalStatus,
  restoreCanonicalRosters,
  getCanonicalRosterPlayerIds,
} from '../helpers/seed';

const TIMEOUT = 30_000;

describe('execute-trade with draft picks', () => {
  let league: BootstrapResult;
  let teamA: BootstrapResult['teams'][number];
  let teamB: BootstrapResult['teams'][number];
  let playerA: string;
  let playerB: string;
  let pickA: string; // A 2027 R1
  let pickB: string; // B 2027 R1

  beforeAll(async () => {
    league = await bootstrapTestLeague();
    await resetTrades(league.leagueId);
    await restoreCanonicalRosters(league.leagueId);
    const bots = league.teams
      .filter((t) => typeof t.botIndex === 'number')
      .sort((a, b) => (a.botIndex as number) - (b.botIndex as number));
    teamA = bots[0];
    teamB = bots[1];

    const [rA, rB] = await Promise.all([
      getCanonicalRosterPlayerIds(league.leagueId, teamA.id),
      getCanonicalRosterPlayerIds(league.leagueId, teamB.id),
    ]);
    playerA = rA[0];
    playerB = rB[0];

    await ensureDraftPicks({
      leagueId: league.leagueId,
      teamIds: league.teams.map((t) => t.id),
    });

    const admin = adminClient();
    const { data: picks } = await admin
      .from('draft_picks')
      .select('id, season, round, current_team_id')
      .eq('league_id', league.leagueId)
      .eq('season', '2027-28')
      .eq('round', 1);
    const picksByTeam = new Map<string, string>(
      (picks ?? []).map((p) => [p.current_team_id, p.id]),
    );
    pickA = picksByTeam.get(teamA.id)!;
    pickB = picksByTeam.get(teamB.id)!;
    if (!pickA || !pickB) throw new Error('Expected one 2027-28 R1 pick per team');
  }, TIMEOUT);

  beforeEach(async () => {
    await resetTrades(league.leagueId); // also restores draft_pick ownership
    await restoreCanonicalRosters(league.leagueId);
  }, TIMEOUT);

  it(
    'pick-for-pick swap transfers current_team_id on both picks',
    async () => {
      const { proposalId } = await createAcceptedTrade({
        leagueId: league.leagueId,
        proposedByTeamId: teamA.id,
        items: [
          { fromTeamId: teamA.id, toTeamId: teamB.id, draftPickId: pickA },
          { fromTeamId: teamB.id, toTeamId: teamA.id, draftPickId: pickB },
        ],
      });

      const resp = await serverInvoke('execute-trade', {
        proposal_id: proposalId,
      });
      expect(resp.error).toBeNull();
      expect(resp.data?.transaction_id).toBeTruthy();

      expect(await getPickCurrentOwner(pickA)).toBe(teamB.id);
      expect(await getPickCurrentOwner(pickB)).toBe(teamA.id);
      expect(await getProposalStatus(proposalId)).toBe('completed');
    },
    TIMEOUT,
  );

  it(
    'pick-for-player trade transfers both asset types',
    async () => {
      const { proposalId } = await createAcceptedTrade({
        leagueId: league.leagueId,
        proposedByTeamId: teamA.id,
        items: [
          // A gives up playerA for B's 2027 R1 pick
          { fromTeamId: teamA.id, toTeamId: teamB.id, playerId: playerA },
          { fromTeamId: teamB.id, toTeamId: teamA.id, draftPickId: pickB },
        ],
      });

      const resp = await serverInvoke('execute-trade', {
        proposal_id: proposalId,
      });
      expect(resp.error).toBeNull();
      expect(resp.data?.transaction_id).toBeTruthy();

      expect(await getPlayerOwner(league.leagueId, playerA)).toBe(teamB.id);
      expect(await getPickCurrentOwner(pickB)).toBe(teamA.id);
      expect(await getProposalStatus(proposalId)).toBe('completed');
    },
    TIMEOUT,
  );

  it(
    'pick trade with protection_threshold preserves the protection on the new owner',
    async () => {
      const { proposalId } = await createAcceptedTrade({
        leagueId: league.leagueId,
        proposedByTeamId: teamA.id,
        items: [
          { fromTeamId: teamA.id, toTeamId: teamB.id, draftPickId: pickA, protectionThreshold: 5 },
          { fromTeamId: teamB.id, toTeamId: teamA.id, draftPickId: pickB },
        ],
      });

      const resp = await serverInvoke('execute-trade', {
        proposal_id: proposalId,
      });
      expect(resp.error).toBeNull();
      expect(resp.data?.transaction_id).toBeTruthy();

      const admin = adminClient();
      const { data: pickARow } = await admin
        .from('draft_picks')
        .select('current_team_id, protection_threshold, protection_owner_id')
        .eq('id', pickA)
        .single();
      expect(pickARow?.current_team_id).toBe(teamB.id);
      expect(pickARow?.protection_threshold).toBe(5);
      // protection_owner_id should point at the original team (teamA) so if the
      // pick lands in the protected range it reverts to them.
      expect(pickARow?.protection_owner_id).toBe(teamA.id);
    },
    TIMEOUT,
  );
});
