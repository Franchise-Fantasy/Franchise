import { bootstrapTestLeague, BootstrapResult } from '../helpers/bootstrap';
import { resetTrades } from '../helpers/cleanup';
import { adminClient } from '../helpers/clients';
import {
  createAcceptedTrade,
  setLeagueRosterSize,
  restoreCanonicalRosters,
  getCanonicalRosterPlayerIds,
} from '../helpers/seed';

const TIMEOUT = 30_000;

// Tests the assert_can_add_free_agent RPC: blocks a free-agent add when
// pending trades would push the team over its roster limit, and allows it
// when there's enough headroom. The TS wrapper in addFreeAgent.ts just maps
// the RPC error to a user-facing message; the RPC is the source of truth.
describe('assert_can_add_free_agent — pending-trade roster guard', () => {
  let league: BootstrapResult;
  let teamA: BootstrapResult['teams'][number];
  let teamB: BootstrapResult['teams'][number];
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

    // Capture the league's roster_size ONCE so afterAll restores to the
    // canonical value, not whatever the last test left it at.
    originalRosterSize = await setLeagueRosterSize(league.leagueId, 5);
  }, TIMEOUT);

  afterAll(async () => {
    await setLeagueRosterSize(league.leagueId, originalRosterSize);
    await resetTrades(league.leagueId);
  }, TIMEOUT);

  beforeEach(async () => {
    await resetTrades(league.leagueId);
    await restoreCanonicalRosters(league.leagueId);
  }, TIMEOUT);

  async function callGuard(teamId: string) {
    const admin = adminClient();
    return admin.rpc('assert_can_add_free_agent', {
      p_league_id: league.leagueId,
      p_team_id: teamId,
    });
  }

  it(
    'blocks add when pending +2 trade would overflow (1 open slot)',
    async () => {
      // teamA has 4 canonical players. Set roster_size = 5 so they have 1
      // open slot. Pending trade has teamA receiving 2 / sending 0 (a 2-for-0
      // gift), so after FA add (5) + trade resolution (+2) = 7 > 5.
      await setLeagueRosterSize(league.leagueId, 5);

      const rosterB = await getCanonicalRosterPlayerIds(league.leagueId, teamB.id);
      await createAcceptedTrade({
        leagueId: league.leagueId,
        proposedByTeamId: teamB.id,
        items: [
          { fromTeamId: teamB.id, toTeamId: teamA.id, playerId: rosterB[0] },
          { fromTeamId: teamB.id, toTeamId: teamA.id, playerId: rosterB[1] },
        ],
      });

      const { error } = await callGuard(teamA.id);
      expect(error).not.toBeNull();
      expect(error?.message).toMatch(/pending_trades_would_overflow_roster/);
    },
    TIMEOUT,
  );

  it(
    'allows add when there is headroom for both the FA and the pending trade',
    async () => {
      // roster_size = 7, teamA has 4 active = 3 open slots. Pending +1 trade.
      // After FA add (5) + trade (+1) = 6 ≤ 7. Should pass.
      await setLeagueRosterSize(league.leagueId, 7);

      const rosterB = await getCanonicalRosterPlayerIds(league.leagueId, teamB.id);
      await createAcceptedTrade({
        leagueId: league.leagueId,
        proposedByTeamId: teamB.id,
        items: [
          { fromTeamId: teamB.id, toTeamId: teamA.id, playerId: rosterB[0] },
        ],
      });

      const { error } = await callGuard(teamA.id);
      expect(error).toBeNull();
    },
    TIMEOUT,
  );

  it(
    'allows add when pending trade is net-outgoing (sends more than receives)',
    async () => {
      // roster_size = 5 → 1 open slot. teamA sends 2, receives 1 → net -1.
      // After FA add (5) + trade (-1) = 4 ≤ 5. Should pass.
      await setLeagueRosterSize(league.leagueId, 5);

      const [rosterA, rosterB] = await Promise.all([
        getCanonicalRosterPlayerIds(league.leagueId, teamA.id),
        getCanonicalRosterPlayerIds(league.leagueId, teamB.id),
      ]);
      await createAcceptedTrade({
        leagueId: league.leagueId,
        proposedByTeamId: teamA.id,
        items: [
          { fromTeamId: teamA.id, toTeamId: teamB.id, playerId: rosterA[0] },
          { fromTeamId: teamA.id, toTeamId: teamB.id, playerId: rosterA[1] },
          { fromTeamId: teamB.id, toTeamId: teamA.id, playerId: rosterB[0] },
        ],
      });

      const { error } = await callGuard(teamA.id);
      expect(error).toBeNull();
    },
    TIMEOUT,
  );

  it(
    'allows add when a +2 trade is cancelled (only active statuses count)',
    async () => {
      // Same overflow shape as test 1, but the trade is cancelled — so it
      // should not contribute to net incoming.
      await setLeagueRosterSize(league.leagueId, 5);

      const rosterB = await getCanonicalRosterPlayerIds(league.leagueId, teamB.id);
      const { proposalId } = await createAcceptedTrade({
        leagueId: league.leagueId,
        proposedByTeamId: teamB.id,
        items: [
          { fromTeamId: teamB.id, toTeamId: teamA.id, playerId: rosterB[0] },
          { fromTeamId: teamB.id, toTeamId: teamA.id, playerId: rosterB[1] },
        ],
      });
      const admin = adminClient();
      await admin
        .from('trade_proposals')
        .update({ status: 'cancelled' })
        .eq('id', proposalId);

      const { error } = await callGuard(teamA.id);
      expect(error).toBeNull();
    },
    TIMEOUT,
  );

  it(
    'allows add when queued drops on a pending +2 trade fully offset the incoming players',
    async () => {
      // roster_size = 5 → 1 open slot. Pending +2 trade. Manager has already
      // queued 2 drops for that trade. Net effect on roster is 0 → safe to
      // add a FA (final state would be 5/5 after FA + trade resolution).
      await setLeagueRosterSize(league.leagueId, 5);

      const [rosterA, rosterB] = await Promise.all([
        getCanonicalRosterPlayerIds(league.leagueId, teamA.id),
        getCanonicalRosterPlayerIds(league.leagueId, teamB.id),
      ]);
      const { proposalId } = await createAcceptedTrade({
        leagueId: league.leagueId,
        proposedByTeamId: teamB.id,
        items: [
          { fromTeamId: teamB.id, toTeamId: teamA.id, playerId: rosterB[0] },
          { fromTeamId: teamB.id, toTeamId: teamA.id, playerId: rosterB[1] },
        ],
      });
      // Queue 2 drops on teamA so net_incoming(2) - queued_drops(2) = 0.
      const admin = adminClient();
      await admin
        .from('trade_proposal_teams')
        .update({ drop_player_ids: [rosterA[0], rosterA[1]] })
        .eq('proposal_id', proposalId)
        .eq('team_id', teamA.id);

      const { error } = await callGuard(teamA.id);
      expect(error).toBeNull();
    },
    TIMEOUT,
  );
});
