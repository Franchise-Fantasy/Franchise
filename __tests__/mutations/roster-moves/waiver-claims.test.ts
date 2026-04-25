import { bootstrapTestLeague, BootstrapResult } from '../helpers/bootstrap';
import { adminClient, signInAsBot } from '../helpers/clients';
import { getRosterPlayerIds, pickFreeAgentPlayer, restoreCanonicalRosters } from '../helpers/seed';

const TIMEOUT = 30_000;

describe('waiver-claims', () => {
  let league: BootstrapResult;
  let teamBot3: BootstrapResult['teams'][number];
  let teamBot4: BootstrapResult['teams'][number];

  beforeAll(async () => {
    league = await bootstrapTestLeague();
    await restoreCanonicalRosters(league.leagueId);
    const bots = league.teams
      .filter((t) => typeof t.botIndex === 'number')
      .sort((a, b) => (a.botIndex as number) - (b.botIndex as number));
    teamBot3 = bots[2];
    teamBot4 = bots[3];
  }, TIMEOUT);

  beforeEach(async () => {
    const admin = adminClient();
    await admin.from('waiver_claims').delete().eq('league_id', league.leagueId);
  }, TIMEOUT);

  afterAll(async () => {
    // Prevent leftover claims with drop_player_id set from blocking
    // subsequent trade tests (execute-trade's waiver-conflict check).
    const admin = adminClient();
    await admin.from('waiver_claims').delete().eq('league_id', league.leagueId);
  }, TIMEOUT);

  it(
    'creates a pending waiver claim for the user\'s own team',
    async () => {
      const fa = await pickFreeAgentPlayer(league.leagueId);
      const client = await signInAsBot(3);

      const { data, error } = await client
        .from('waiver_claims')
        .insert({
          league_id: league.leagueId,
          team_id: teamBot3.id,
          player_id: fa.id,
          priority: 1,
          status: 'pending',
        })
        .select('id, status')
        .single();

      expect(error).toBeNull();
      expect(data?.status).toBe('pending');
      expect(data?.id).toBeTruthy();
    },
    TIMEOUT,
  );

  it(
    'allows the owning team to cancel their own claim',
    async () => {
      const fa = await pickFreeAgentPlayer(league.leagueId);
      const client = await signInAsBot(3);

      const { data: created } = await client
        .from('waiver_claims')
        .insert({
          league_id: league.leagueId,
          team_id: teamBot3.id,
          player_id: fa.id,
          priority: 1,
          status: 'pending',
        })
        .select('id')
        .single();
      expect(created?.id).toBeTruthy();

      const { error } = await client
        .from('waiver_claims')
        .update({ status: 'cancelled' })
        .eq('id', created!.id);
      expect(error).toBeNull();

      const admin = adminClient();
      const { data: verified } = await admin
        .from('waiver_claims')
        .select('status')
        .eq('id', created!.id)
        .single();
      expect(verified?.status).toBe('cancelled');
    },
    TIMEOUT,
  );

  it(
    'rejects a claim submitted for another team (RLS)',
    async () => {
      const fa = await pickFreeAgentPlayer(league.leagueId);
      const client = await signInAsBot(3); // bot3 trying to claim for bot4's team

      const { data, error } = await client
        .from('waiver_claims')
        .insert({
          league_id: league.leagueId,
          team_id: teamBot4.id, // not bot3's team
          player_id: fa.id,
          priority: 1,
          status: 'pending',
        })
        .select('id')
        .maybeSingle();

      // RLS check_expr rejects the INSERT — either error is set, or data is
      // null because the returning row is hidden.
      expect(error || !data).toBeTruthy();

      const admin = adminClient();
      const { data: found } = await admin
        .from('waiver_claims')
        .select('id')
        .eq('league_id', league.leagueId)
        .eq('team_id', teamBot4.id)
        .eq('player_id', fa.id);
      expect(found ?? []).toHaveLength(0);
    },
    TIMEOUT,
  );

  it(
    'supports a claim with a drop_player_id (add-drop)',
    async () => {
      const fa = await pickFreeAgentPlayer(league.leagueId);
      const roster = await getRosterPlayerIds(league.leagueId, teamBot3.id);
      const dropId = roster[roster.length - 1];

      const client = await signInAsBot(3);
      const { data, error } = await client
        .from('waiver_claims')
        .insert({
          league_id: league.leagueId,
          team_id: teamBot3.id,
          player_id: fa.id,
          drop_player_id: dropId,
          priority: 1,
          status: 'pending',
        })
        .select('id, drop_player_id')
        .single();

      expect(error).toBeNull();
      expect(data?.drop_player_id).toBe(dropId);
    },
    TIMEOUT,
  );
});
