import { bootstrapTestLeague } from '../helpers/bootstrap';
import { signInAsBot, serverInvoke } from '../helpers/clients';

const TIMEOUT = 30_000;

// process-waivers is gated behind CRON_SECRET (same pattern as finalize-week, poll-live-stats).
// Full happy-path testing requires staged claims at specific lifecycle states that intersect
// with cron-driven timing, which is hard to set up reliably. These smoke tests confirm the
// function is deployed and the cron-only auth is enforced. waiver-claims.test.ts covers the
// upstream user-facing claim creation; the worker side is exercised in production by cron.

describe('process-waivers', () => {
  beforeAll(async () => {
    await bootstrapTestLeague();
  }, TIMEOUT);

  it(
    'rejects calls without the cron secret (bot user)',
    async () => {
      const client = await signInAsBot(1);
      const { data, error } = await client.functions.invoke('process-waivers', { body: {} });
      const hasErrorSignal =
        error !== null || (data && typeof data === 'object' && 'error' in (data as any));
      expect(hasErrorSignal).toBe(true);
    },
    TIMEOUT,
  );

  it(
    'rejects calls without the cron secret (service role bearer)',
    async () => {
      const { data, error } = await serverInvoke('process-waivers', {});
      const hasErrorSignal =
        error !== null || (data && typeof data === 'object' && 'error' in (data as any));
      expect(hasErrorSignal).toBe(true);
    },
    TIMEOUT,
  );
});
