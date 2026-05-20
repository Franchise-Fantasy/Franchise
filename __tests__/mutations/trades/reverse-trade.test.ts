import { bootstrapTestLeague, BootstrapResult } from '../helpers/bootstrap';
import { resetTrades } from '../helpers/cleanup';
import { adminClient, signInAsBot, serverInvoke } from '../helpers/clients';
import { expectHttpError } from '../helpers/expect';
import {
  createAcceptedOneForOneTrade,
  getCanonicalRosterPlayerIds,
  getPlayerOwner,
  restoreCanonicalRosters,
} from '../helpers/seed';

const TIMEOUT = 45_000;

describe('reverse-trade', () => {
  let league: BootstrapResult;
  let teamA: BootstrapResult['teams'][number]; // bot1, commissioner
  let teamB: BootstrapResult['teams'][number]; // bot2, trade partner
  let playerA: string;
  let playerB: string;

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
  }, TIMEOUT);

  beforeEach(async () => {
    await resetTrades(league.leagueId);
    await restoreCanonicalRosters(league.leagueId);
  }, TIMEOUT);

  // Helper: create + execute a trade, return its completed proposal_id.
  async function createAndExecute(): Promise<string> {
    const trade = await createAcceptedOneForOneTrade(
      league.leagueId,
      teamA.id,
      teamB.id,
      playerA,
      playerB,
    );
    const exec = await serverInvoke('execute-trade', { proposal_id: trade.proposalId });
    expect(exec.error).toBeNull();
    return trade.proposalId;
  }

  it(
    'swaps player ownership back to the original teams when commissioner reverses',
    async () => {
      const proposalId = await createAndExecute();

      // After execute: playerA is on teamB, playerB is on teamA.
      expect(await getPlayerOwner(league.leagueId, playerA)).toBe(teamB.id);
      expect(await getPlayerOwner(league.leagueId, playerB)).toBe(teamA.id);

      const commissioner = await signInAsBot(1);
      const result = await commissioner.functions.invoke('reverse-trade', {
        body: { proposal_id: proposalId },
      });
      expect(result.error).toBeNull();
      expect(result.data?.message).toMatch(/reversed/i);

      // Ownership must be restored.
      expect(await getPlayerOwner(league.leagueId, playerA)).toBe(teamA.id);
      expect(await getPlayerOwner(league.leagueId, playerB)).toBe(teamB.id);

      // Proposal status flipped to 'reversed', and a commissioner transaction
      // was filed with both player items in the right direction.
      const admin = adminClient();
      const { data: prop } = await admin
        .from('trade_proposals')
        .select('status')
        .eq('id', proposalId)
        .single();
      expect(prop?.status).toBe('reversed');

      const { data: txns } = await admin
        .from('league_transactions')
        .select('id, type')
        .eq('league_id', league.leagueId)
        .eq('type', 'commissioner')
        .order('created_at', { ascending: false })
        .limit(1);
      expect((txns ?? []).length).toBe(1);
      const txnId = txns![0].id;
      const { data: txnItems } = await admin
        .from('league_transaction_items')
        .select('player_id, team_from_id, team_to_id')
        .eq('transaction_id', txnId);
      expect((txnItems ?? []).length).toBe(2);
      // The reversal transaction items should record the swap in the OPPOSITE
      // direction from the original trade (to → from). playerA went A→B, so
      // the reversal item shows from=B, to=A.
      const reverseA = txnItems!.find((t) => t.player_id === playerA);
      const reverseB = txnItems!.find((t) => t.player_id === playerB);
      expect(reverseA).toMatchObject({ team_from_id: teamB.id, team_to_id: teamA.id });
      expect(reverseB).toMatchObject({ team_from_id: teamA.id, team_to_id: teamB.id });
    },
    TIMEOUT,
  );

  it(
    'rejects reversal from a non-commissioner',
    async () => {
      const proposalId = await createAndExecute();

      const bot2 = await signInAsBot(2);
      const result = await bot2.functions.invoke('reverse-trade', {
        body: { proposal_id: proposalId },
      });
      await expectHttpError(result, { status: 403, messageMatch: /commissioner/i });

      // Defense-in-depth: ownership did NOT revert.
      expect(await getPlayerOwner(league.leagueId, playerA)).toBe(teamB.id);
      expect(await getPlayerOwner(league.leagueId, playerB)).toBe(teamA.id);
    },
    TIMEOUT,
  );

  it(
    'rejects reversal of a non-completed trade',
    async () => {
      // Create an accepted-but-not-executed trade — status='accepted'.
      const trade = await createAcceptedOneForOneTrade(
        league.leagueId,
        teamA.id,
        teamB.id,
        playerA,
        playerB,
      );

      const commissioner = await signInAsBot(1);
      const result = await commissioner.functions.invoke('reverse-trade', {
        body: { proposal_id: trade.proposalId },
      });
      await expectHttpError(result, { status: 400, messageMatch: /completed trades/i });
    },
    TIMEOUT,
  );
});
