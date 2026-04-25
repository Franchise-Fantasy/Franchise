import { adminClient, signInAsBot } from '../helpers/clients';
import { bootstrapTestLeague, BootstrapResult } from '../helpers/bootstrap';

const TIMEOUT = 30_000;

// Live Activity tokens are registered by native iOS code. The server-side
// mutations are plain inserts/updates on activity_tokens. This covers the
// DB-level contract; device-native behavior is out of scope.

describe('activity_tokens', () => {
  let league: BootstrapResult;
  let bot3Team: BootstrapResult['teams'][number];
  let bot3UserId: string;

  beforeAll(async () => {
    league = await bootstrapTestLeague();
    const bots = league.teams
      .filter((t) => typeof t.botIndex === 'number')
      .sort((a, b) => (a.botIndex as number) - (b.botIndex as number));
    bot3Team = bots[2];
    const bot3 = await signInAsBot(3);
    bot3UserId = (await bot3.auth.getUser()).data.user!.id;
  }, TIMEOUT);

  beforeEach(async () => {
    const admin = adminClient();
    await admin.from('activity_tokens').delete().eq('user_id', bot3UserId);
  }, TIMEOUT);

  it(
    'user inserts their own activity token',
    async () => {
      const client = await signInAsBot(3);
      const { data, error } = await client
        .from('activity_tokens')
        .insert({
          user_id: bot3UserId,
          team_id: bot3Team.id,
          league_id: league.leagueId,
          activity_type: 'matchup',
          push_token: `ios-test-${Date.now()}`,
        })
        .select('id, activity_type')
        .single();
      expect(error).toBeNull();
      expect(data?.activity_type).toBe('matchup');
    },
    TIMEOUT,
  );

  it(
    'user can delete their own stale token',
    async () => {
      const admin = adminClient();
      const { data: inserted } = await admin
        .from('activity_tokens')
        .insert({
          user_id: bot3UserId,
          team_id: bot3Team.id,
          league_id: league.leagueId,
          activity_type: 'matchup',
          push_token: `ios-test-${Date.now()}`,
        })
        .select('id')
        .single();

      const client = await signInAsBot(3);
      const { error } = await client.from('activity_tokens').delete().eq('id', inserted!.id);
      expect(error).toBeNull();

      const { data: check } = await admin
        .from('activity_tokens')
        .select('id')
        .eq('id', inserted!.id)
        .maybeSingle();
      expect(check).toBeNull();
    },
    TIMEOUT,
  );
});
