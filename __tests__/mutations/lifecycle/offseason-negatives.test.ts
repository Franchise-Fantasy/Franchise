// Negative-path coverage for the lifecycle functions that previously had
// only happy-path tests (or none at all). These verify the state and role
// guards return the right status + message — the kind of contract a client
// relies on to render "Cannot do that yet" UX instead of a generic crash.
//
// The functions exercised here are difficult to test happy-path against the
// shared test league (run-lottery wants a specific offseason state;
// generate-playoff-round needs a real playoff schedule seeded). The dynasty
// lifecycle league covers run-lottery's happy path indirectly via
// start-lottery, and finalize-week's happy path lands in PR 10 alongside
// the function's decomposition. The gaps left here are negative paths only.

import { bootstrapTestLeague, BootstrapResult } from '../helpers/bootstrap';
import { signInAsBot } from '../helpers/clients';
import { expectHttpError } from '../helpers/expect';
import { clearRateLimits } from '../helpers/lifecycle';

const TIMEOUT = 30_000;

describe('run-lottery (state + role guards)', () => {
  let league: BootstrapResult;
  let bot1: BootstrapResult['teams'][number];
  let bot3: BootstrapResult['teams'][number];

  beforeAll(async () => {
    league = await bootstrapTestLeague();
    const bots = league.teams
      .filter((t) => typeof t.botIndex === 'number')
      .sort((a, b) => (a.botIndex as number) - (b.botIndex as number));
    bot1 = bots[0];
    bot3 = bots[2];
  }, TIMEOUT);

  beforeEach(async () => {
    await clearRateLimits(bot1.userId, ['run-lottery']);
    await clearRateLimits(bot3.userId, ['run-lottery']);
  }, TIMEOUT);

  it(
    'rejects non-commissioner with 403',
    async () => {
      const client = await signInAsBot(3);
      const result = await client.functions.invoke('run-lottery', {
        body: { league_id: league.leagueId, season: '2026-27' },
      });
      await expectHttpError(result, { status: 403, messageMatch: /commissioner/i });
    },
    TIMEOUT,
  );

  it(
    'rejects an unknown league_id with 404',
    async () => {
      const client = await signInAsBot(1);
      const result = await client.functions.invoke('run-lottery', {
        body: { league_id: '00000000-0000-0000-0000-000000000000', season: '2026-27' },
      });
      await expectHttpError(result, { status: 404, messageMatch: /league not found/i });
    },
    TIMEOUT,
  );
});

describe('generate-playoff-round (state + role guards)', () => {
  let league: BootstrapResult;
  let bot1: BootstrapResult['teams'][number];
  let bot3: BootstrapResult['teams'][number];

  beforeAll(async () => {
    league = await bootstrapTestLeague();
    const bots = league.teams
      .filter((t) => typeof t.botIndex === 'number')
      .sort((a, b) => (a.botIndex as number) - (b.botIndex as number));
    bot1 = bots[0];
    bot3 = bots[2];
  }, TIMEOUT);

  beforeEach(async () => {
    await clearRateLimits(bot1.userId, ['generate-playoff-round']);
    await clearRateLimits(bot3.userId, ['generate-playoff-round']);
  }, TIMEOUT);

  it(
    'rejects non-commissioner with 403',
    async () => {
      const client = await signInAsBot(3);
      const result = await client.functions.invoke('generate-playoff-round', {
        body: { league_id: league.leagueId, round: 1 },
      });
      await expectHttpError(result, { status: 403, messageMatch: /commissioner/i });
    },
    TIMEOUT,
  );

  it(
    'rejects when the league has no playoff weeks scheduled',
    async () => {
      // Test league bootstrap doesn't seed a schedule, so playoff weeks are absent.
      const client = await signInAsBot(1);
      const result = await client.functions.invoke('generate-playoff-round', {
        body: { league_id: league.leagueId, round: 1 },
      });
      await expectHttpError(result, { status: 400, messageMatch: /no playoff weeks/i });
    },
    TIMEOUT,
  );

  it(
    'rejects a league_id that does not exist',
    async () => {
      const client = await signInAsBot(1);
      const result = await client.functions.invoke('generate-playoff-round', {
        body: { league_id: '00000000-0000-0000-0000-000000000000', round: 1 },
      });
      // The non-commissioner check runs first against the missing league row
      // (commCheck is null → 403 "Only the commissioner"). Treat both 403 and
      // 404 as acceptable here — what matters is it's a 4xx, not a crash.
      expect([403, 404]).toContain((result.error?.context as Response | undefined)?.status);
    },
    TIMEOUT,
  );
});
