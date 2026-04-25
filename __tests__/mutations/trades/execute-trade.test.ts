import { bootstrapTestLeague, BootstrapResult } from '../helpers/bootstrap';
import { adminClient, signInAsBot, serverInvoke } from '../helpers/clients';
import {
  createAcceptedOneForOneTrade,
  getPlayerOwner,
  restoreCanonicalRosters,
  getCanonicalRosterPlayerIds,
} from '../helpers/seed';
import { resetTrades, restorePlayerOwnership } from '../helpers/cleanup';

const TIMEOUT = 30_000;

describe('execute-trade', () => {
  let league: BootstrapResult;
  let teamA: BootstrapResult['teams'][number]; // bot1, commissioner
  let teamB: BootstrapResult['teams'][number]; // bot2, plain trade partner
  let watcher: BootstrapResult['teams'][number] | undefined; // jjspoels (if present)
  let playerA: string;
  let playerB: string;
  let playerW: string | undefined;

  beforeAll(async () => {
    league = await bootstrapTestLeague();
    await resetTrades(league.leagueId);
    await restoreCanonicalRosters(league.leagueId);
    const bots = league.teams
      .filter((t) => typeof t.botIndex === 'number')
      .sort((a, b) => (a.botIndex as number) - (b.botIndex as number));
    teamA = bots[0];
    teamB = bots[1];
    watcher = league.teams.find((t) => t.botIndex === 'watcher');

    const [rosterA, rosterB] = await Promise.all([
      getCanonicalRosterPlayerIds(league.leagueId, teamA.id),
      getCanonicalRosterPlayerIds(league.leagueId, teamB.id),
    ]);
    if (rosterA.length === 0 || rosterB.length === 0) {
      throw new Error('Test rosters empty — re-run bootstrap');
    }
    playerA = rosterA[0];
    playerB = rosterB[0];
    if (watcher) {
      const rosterW = await getCanonicalRosterPlayerIds(league.leagueId, watcher.id);
      if (rosterW.length > 0) playerW = rosterW[0];
    }
  }, TIMEOUT);

  beforeEach(async () => {
    await resetTrades(league.leagueId);
    await restoreCanonicalRosters(league.leagueId);
  }, TIMEOUT);

  it(
    'swaps player ownership and creates a transaction when commissioner executes',
    async () => {
      const trade = await createAcceptedOneForOneTrade(
        league.leagueId,
        teamA.id,
        teamB.id,
        playerA,
        playerB,
      );

      const { data, error } = await serverInvoke('execute-trade', {
        proposal_id: trade.proposalId,
      });

      expect(error).toBeNull();
      expect(data).toMatchObject({ message: expect.stringContaining('Trade completed') });
      expect(data.transaction_id).toBeTruthy();

      const [newOwnerA, newOwnerB] = await Promise.all([
        getPlayerOwner(league.leagueId, playerA),
        getPlayerOwner(league.leagueId, playerB),
      ]);
      expect(newOwnerA).toBe(teamB.id);
      expect(newOwnerB).toBe(teamA.id);

      const admin = adminClient();
      const { data: finalProposal } = await admin
        .from('trade_proposals')
        .select('transaction_id, status, trade_summary')
        .eq('id', trade.proposalId)
        .single();
      expect(finalProposal?.transaction_id).toBeTruthy();
      expect(finalProposal?.trade_summary).toBeTruthy();

      const { data: chatMsg } = await admin
        .from('chat_messages')
        .select('id, type, content')
        .eq('conversation_id', league.leagueChatId)
        .eq('type', 'trade')
        .eq('content', trade.proposalId)
        .maybeSingle();
      expect(chatMsg).toBeTruthy();
    },
    TIMEOUT,
  );

  it(
    'is idempotent — re-invoking on an executed trade returns success without re-swapping',
    async () => {
      const trade = await createAcceptedOneForOneTrade(
        league.leagueId,
        teamA.id,
        teamB.id,
        playerA,
        playerB,
      );
      await serverInvoke('execute-trade', { proposal_id: trade.proposalId });
      const { data, error } = await serverInvoke('execute-trade', {
        proposal_id: trade.proposalId,
      });

      expect(error).toBeNull();
      expect(data.message).toMatch(/already executed/i);

      expect(await getPlayerOwner(league.leagueId, playerA)).toBe(teamB.id);
      expect(await getPlayerOwner(league.leagueId, playerB)).toBe(teamA.id);
    },
    TIMEOUT,
  );

  it(
    'rejects execution by a non-commissioner who is not a trade party',
    async () => {
      const trade = await createAcceptedOneForOneTrade(
        league.leagueId,
        teamA.id,
        teamB.id,
        playerA,
        playerB,
      );

      const client = await signInAsBot(3);
      await client.functions.invoke('execute-trade', {
        body: { proposal_id: trade.proposalId },
      });

      expect(await getPlayerOwner(league.leagueId, playerA)).toBe(teamA.id);
      expect(await getPlayerOwner(league.leagueId, playerB)).toBe(teamB.id);
    },
    TIMEOUT,
  );

  // Showcase: runs last. Includes watcher (jjspoels) so they get a push
  // notification, and leaves the completed trade + chat card visible in-app.
  // No-ops if the watcher account wasn't found during bootstrap.
  it(
    'showcase — completes a bot↔watcher trade and leaves it visible in chat',
    async () => {
      if (!watcher || !playerW) {
        console.warn('[showcase] watcher team missing — skipping push-notification showcase');
        return;
      }

      const trade = await createAcceptedOneForOneTrade(
        league.leagueId,
        teamA.id,
        watcher.id,
        playerA,
        playerW,
      );
      const { data, error } = await serverInvoke('execute-trade', {
        proposal_id: trade.proposalId,
      });
      expect(error).toBeNull();
      expect(data.transaction_id).toBeTruthy();
    },
    TIMEOUT,
  );
});
