import { bootstrapTestLeague, BootstrapResult } from '../helpers/bootstrap';
import { resetTrades } from '../helpers/cleanup';
import { adminClient, signInAsBot } from '../helpers/clients';
import {
  createAcceptedTrade,
  getCanonicalRosterPlayerIds,
  restoreCanonicalRosters,
} from '../helpers/seed';

const TIMEOUT = 30_000;

describe('leak_trade_rumor', () => {
  let league: BootstrapResult;
  let teamA: BootstrapResult['teams'][number];
  let teamB: BootstrapResult['teams'][number];
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
    // Wipe any prior rumors for these test players.
    const admin = adminClient();
    await admin
      .from('trade_rumors')
      .delete()
      .eq('league_id', league.leagueId);
  }, TIMEOUT);

  it(
    'leak_trade_rumor posts a rumor from the caller\'s own team',
    async () => {
      // Need an active proposal to leak about.
      const { proposalId } = await createAcceptedTrade({
        leagueId: league.leagueId,
        proposedByTeamId: teamA.id,
        items: [
          { fromTeamId: teamA.id, toTeamId: teamB.id, playerId: playerA },
          { fromTeamId: teamB.id, toTeamId: teamA.id, playerId: playerB },
        ],
      });

      const bot1 = await signInAsBot(1);
      const { error } = await bot1.rpc('leak_trade_rumor', {
        p_league_id: league.leagueId,
        p_team_id: teamA.id,
        p_player_id: playerA,
        p_proposal_id: proposalId,
        p_template: 'source_says',
        p_player_name: 'Test Player',
      });
      expect(error).toBeNull();

      const admin = adminClient();
      const { data: rumors } = await admin
        .from('trade_rumors')
        .select('id, player_id')
        .eq('league_id', league.leagueId)
        .eq('player_id', playerA);
      expect((rumors ?? []).length).toBe(1);
    },
    TIMEOUT,
  );

  it(
    'rejects when caller does not own the claimed team',
    async () => {
      const { proposalId } = await createAcceptedTrade({
        leagueId: league.leagueId,
        proposedByTeamId: teamA.id,
        items: [
          { fromTeamId: teamA.id, toTeamId: teamB.id, playerId: playerA },
          { fromTeamId: teamB.id, toTeamId: teamA.id, playerId: playerB },
        ],
      });

      // bot4 tries to leak as teamA (not their team).
      const bot4 = await signInAsBot(4);
      const { error } = await bot4.rpc('leak_trade_rumor', {
        p_league_id: league.leagueId,
        p_team_id: teamA.id,
        p_player_id: playerA,
        p_proposal_id: proposalId,
        p_template: 'source_says',
        p_player_name: 'Test Player',
      });
      expect(error).toBeTruthy();

      const admin = adminClient();
      const { data: rumors } = await admin
        .from('trade_rumors')
        .select('id')
        .eq('league_id', league.leagueId);
      expect(rumors ?? []).toHaveLength(0);
    },
    TIMEOUT,
  );
});
