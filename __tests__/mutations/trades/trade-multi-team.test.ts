import { bootstrapTestLeague, BootstrapResult } from '../helpers/bootstrap';
import { resetTrades } from '../helpers/cleanup';
import { serverInvoke } from '../helpers/clients';
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

describe('execute-trade multi-team', () => {
  let league: BootstrapResult;
  let teamA: BootstrapResult['teams'][number]; // bot1
  let teamB: BootstrapResult['teams'][number]; // bot2
  let teamC: BootstrapResult['teams'][number]; // bot3
  let playerA: string;
  let playerB: string;
  let playerC: string;

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

    const [rA, rB, rC] = await Promise.all([
      getCanonicalRosterPlayerIds(league.leagueId, teamA.id),
      getCanonicalRosterPlayerIds(league.leagueId, teamB.id),
      getCanonicalRosterPlayerIds(league.leagueId, teamC.id),
    ]);
    playerA = rA[0];
    playerB = rB[0];
    playerC = rC[0];
  }, TIMEOUT);

  beforeEach(async () => {
    await resetTrades(league.leagueId);
    await restoreCanonicalRosters(league.leagueId);
  }, TIMEOUT);

  it(
    '3-team circular trade: A→B→C→A all rotate correctly',
    async () => {
      const { proposalId } = await createAcceptedTrade({
        leagueId: league.leagueId,
        proposedByTeamId: teamA.id,
        items: [
          { fromTeamId: teamA.id, toTeamId: teamB.id, playerId: playerA },
          { fromTeamId: teamB.id, toTeamId: teamC.id, playerId: playerB },
          { fromTeamId: teamC.id, toTeamId: teamA.id, playerId: playerC },
        ],
      });

      const resp = await serverInvoke('execute-trade', {
        proposal_id: proposalId,
      });
      expect(resp.error).toBeNull();
      expect(resp.data?.transaction_id).toBeTruthy();

      expect(await getPlayerOwner(league.leagueId, playerA)).toBe(teamB.id);
      expect(await getPlayerOwner(league.leagueId, playerB)).toBe(teamC.id);
      expect(await getPlayerOwner(league.leagueId, playerC)).toBe(teamA.id);
      expect(await getProposalStatus(proposalId)).toBe('completed');
    },
    TIMEOUT,
  );

  describe('with drops required on multiple teams', () => {
    let originalRosterSize: number;
    let cExtra1: string;
    let cExtra2: string;
    let cExtra3: string;

    beforeAll(async () => {
      // CRITICAL: restore canonical state BEFORE picking cExtras. Without this,
      // nested beforeAll runs right after the outer describe's last test (which
      // moved players around), so `getRosterPlayerIds(teamC.id)` returns a
      // mutated roster. We'd pick a cExtra that actually belongs to teamB,
      // which creates a "same player traded in two directions" item conflict.
      await resetTrades(league.leagueId);
      await restoreCanonicalRosters(league.leagueId);

      // Pick from canonical so they're always restorable between tests.
      const rC = await getCanonicalRosterPlayerIds(league.leagueId, teamC.id);
      if (rC.length < 4) throw new Error('teamC needs ≥ 4 players for multi-team drop test');
      const extras = rC.filter((p) => p !== playerC);
      if (extras.length < 3) throw new Error('teamC needs ≥ 3 extras beyond playerC');
      cExtra1 = extras[0];
      cExtra2 = extras[1];
      cExtra3 = extras[2];
      originalRosterSize = await setLeagueRosterSize(league.leagueId, 4);
    }, TIMEOUT);

    afterAll(async () => {
      await setLeagueRosterSize(league.leagueId, originalRosterSize);
    }, TIMEOUT);

    beforeEach(async () => {
      await restoreCanonicalRosters(league.leagueId);
    }, TIMEOUT);

    it(
      '3-team trade where 2 teams need drops — completes after each team submits a drop',
      async () => {
        // Nets: A = -1 + 2 = +1 (drops), B = -1 + 2 = +1 (drops), C = -4 + 2 = -2.
        const { proposalId } = await createAcceptedTrade({
          leagueId: league.leagueId,
          proposedByTeamId: teamA.id,
          items: [
            { fromTeamId: teamA.id, toTeamId: teamC.id, playerId: playerA },
            { fromTeamId: teamB.id, toTeamId: teamC.id, playerId: playerB },
            { fromTeamId: teamC.id, toTeamId: teamA.id, playerId: playerC },
            { fromTeamId: teamC.id, toTeamId: teamA.id, playerId: cExtra1 },
            { fromTeamId: teamC.id, toTeamId: teamB.id, playerId: cExtra2 },
            { fromTeamId: teamC.id, toTeamId: teamB.id, playerId: cExtra3 },
          ],
        });

        const first = await serverInvoke('execute-trade', {
          proposal_id: proposalId,
        });
        expect(first.error).toBeNull();
        expect(first.data?.pending_drops).toBe(true);
        expect(await getProposalStatus(proposalId)).toBe('pending_drops');

        const [currentA, currentB] = await Promise.all([
          getRosterPlayerIds(league.leagueId, teamA.id),
          getRosterPlayerIds(league.leagueId, teamB.id),
        ]);
        const dropA = currentA.find((p) => p !== playerA);
        const dropB = currentB.find((p) => p !== playerB);
        if (!dropA || !dropB) throw new Error('Could not pick drop candidates');
        await Promise.all([
          setTeamDrops(proposalId, teamA.id, [dropA]),
          setTeamDrops(proposalId, teamB.id, [dropB]),
        ]);

        const second = await serverInvoke('execute-trade', {
          proposal_id: proposalId,
        });
        expect(second.error).toBeNull();
        expect(second.data?.transaction_id).toBeTruthy();

        expect(await getPlayerOwner(league.leagueId, playerA)).toBe(teamC.id);
        expect(await getPlayerOwner(league.leagueId, playerB)).toBe(teamC.id);
        expect(await getPlayerOwner(league.leagueId, playerC)).toBe(teamA.id);
        expect(await getPlayerOwner(league.leagueId, cExtra1)).toBe(teamA.id);
        expect(await getPlayerOwner(league.leagueId, cExtra2)).toBe(teamB.id);
        expect(await getPlayerOwner(league.leagueId, cExtra3)).toBe(teamB.id);
        expect(await getPlayerOwner(league.leagueId, dropA)).toBeNull();
        expect(await getPlayerOwner(league.leagueId, dropB)).toBeNull();
      },
      TIMEOUT,
    );
  });
});
