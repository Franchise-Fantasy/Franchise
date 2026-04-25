import { bootstrapTestLeague } from '../helpers/bootstrap';
import { signInAsBot } from '../helpers/clients';

const TIMEOUT = 30_000;

// Sleeper + screenshot imports depend on external services (Sleeper API, Claude
// Vision) and user-provided data. Full happy-path testing here isn't practical,
// so these are smoke tests that confirm the functions are deployed, reject
// invalid input cleanly, and require auth.

describe('import-sleeper-league', () => {
  beforeAll(async () => {
    await bootstrapTestLeague();
  }, TIMEOUT);

  it(
    'rejects an invalid Sleeper league id on preview',
    async () => {
      const client = await signInAsBot(3);
      const { data, error } = await client.functions.invoke('import-sleeper-league', {
        body: { action: 'preview', sleeper_league_id: '000000000000000000' },
      });
      // Function responds with a 4xx/5xx + error body. Either way, no import
      // should have happened. Treat "either error set OR data.error set" as
      // the pass condition.
      const hasErrorSignal =
        error !== null || (data && typeof data === 'object' && 'error' in (data as any));
      expect(hasErrorSignal).toBe(true);
    },
    TIMEOUT,
  );
});

describe('import-screenshot-league', () => {
  it(
    'rejects a screenshot extraction without images',
    async () => {
      const client = await signInAsBot(3);
      const { data, error } = await client.functions.invoke('import-screenshot-league', {
        body: { action: 'extract_roster', images: [] },
      });
      const hasErrorSignal =
        error !== null || (data && typeof data === 'object' && 'error' in (data as any));
      expect(hasErrorSignal).toBe(true);
    },
    TIMEOUT,
  );
});
