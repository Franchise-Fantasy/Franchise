import { bootstrapTestLeague, BootstrapResult } from '../helpers/bootstrap';
import { adminClient, signInAsBot } from '../helpers/clients';

const TIMEOUT = 30_000;

describe('teams direct mutations', () => {
  let league: BootstrapResult;
  let bot3Team: BootstrapResult['teams'][number];
  let originalName: string;

  beforeAll(async () => {
    league = await bootstrapTestLeague();
    const bots = league.teams
      .filter((t) => typeof t.botIndex === 'number')
      .sort((a, b) => (a.botIndex as number) - (b.botIndex as number));
    bot3Team = bots[2];
    originalName = bot3Team.name;
  }, TIMEOUT);

  afterAll(async () => {
    // Restore the team name so the test league looks clean.
    const admin = adminClient();
    await admin.from('teams').update({ name: originalName }).eq('id', bot3Team.id);
  }, TIMEOUT);

  it(
    'team owner can update their own team name',
    async () => {
      const bot3 = await signInAsBot(3);
      const newName = `Renamed ${Date.now()}`;
      const { error } = await bot3.from('teams').update({ name: newName }).eq('id', bot3Team.id);
      expect(error).toBeNull();

      const admin = adminClient();
      const { data: check } = await admin
        .from('teams')
        .select('name')
        .eq('id', bot3Team.id)
        .single();
      expect(check?.name).toBe(newName);
    },
    TIMEOUT,
  );

  it(
    'user cannot rename another user\'s team (RLS)',
    async () => {
      const bot4 = await signInAsBot(4);
      await bot4
        .from('teams')
        .update({ name: 'hacked' })
        .eq('id', bot3Team.id);

      // Verify it didn't change.
      const admin = adminClient();
      const { data: check } = await admin
        .from('teams')
        .select('name')
        .eq('id', bot3Team.id)
        .single();
      expect(check?.name).not.toBe('hacked');
    },
    TIMEOUT,
  );
});
