import { bootstrapTestLeague, BootstrapResult } from '../helpers/bootstrap';
import { signInAsBot } from '../helpers/clients';

const TIMEOUT = 30_000;

describe('delete-account', () => {
  let league: BootstrapResult;

  beforeAll(async () => {
    league = await bootstrapTestLeague();
  }, TIMEOUT);

  // Actually destroying a bot user would break subsequent tests that use them,
  // so only the rejection path is exercised here. The full deletion flow is
  // manually verified in the app.
  it(
    'blocks account deletion when the caller is a league commissioner',
    async () => {
      const bot1 = await signInAsBot(1); // bot1 is commissioner of the test league
      const { data } = await bot1.functions.invoke('delete-account', { body: {} });
      // Function returns 400 with an error body. supabase-js stashes the body
      // on `data` when the status is non-2xx? No — 4xx becomes `error`, but
      // the body is readable via context.json(). Verify the commissioner
      // guard fired by confirming bot1 still has a team.
      const probe = await bot1.from('teams').select('id').eq('user_id', (await bot1.auth.getUser()).data.user!.id);
      expect((probe.data ?? []).length).toBeGreaterThan(0);
    },
    TIMEOUT,
  );
});
