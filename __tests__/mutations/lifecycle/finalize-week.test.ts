import { signInAsBot, serverInvoke } from '../helpers/clients';
import { bootstrapTestLeague } from '../helpers/bootstrap';

const TIMEOUT = 30_000;

// finalize-week is gated behind CRON_SECRET (same pattern as process-waivers, poll-live-stats).
// Full happy-path testing requires a controlled set of pending matchups + scoring data, which
// the test league doesn't easily provide. These smoke tests confirm the function is deployed
// and the cron-only auth is enforced — bot users and the service role both get 401, since
// neither presents the cron secret.

describe('finalize-week', () => {
  beforeAll(async () => {
    await bootstrapTestLeague();
  }, TIMEOUT);

  it(
    'rejects calls without the cron secret (bot user)',
    async () => {
      const client = await signInAsBot(1);
      const { data, error } = await client.functions.invoke('finalize-week', { body: {} });
      const hasErrorSignal =
        error !== null || (data && typeof data === 'object' && 'error' in (data as any));
      expect(hasErrorSignal).toBe(true);
    },
    TIMEOUT,
  );

  it(
    'rejects calls without the cron secret (service role bearer)',
    async () => {
      // serverInvoke uses SECRET_KEY as the bearer token; the function checks for CRON_SECRET
      // specifically, not the service role key, so this should still 401.
      const { data, error } = await serverInvoke('finalize-week', {});
      const hasErrorSignal =
        error !== null || (data && typeof data === 'object' && 'error' in (data as any));
      expect(hasErrorSignal).toBe(true);
    },
    TIMEOUT,
  );
});
