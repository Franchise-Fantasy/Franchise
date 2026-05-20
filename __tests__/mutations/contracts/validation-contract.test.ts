// Validation contract sweep — confirms every edge function that takes a JSON
// body rejects an empty body with HTTP 400 and a field-level error message.
//
// Why this matters: PR 5 moved all functions to HttpError-based error
// responses, and PR 6 added Zod schemas to drive validation. A regression
// that silently removes a schema, swaps to a 200/500 response shape, or drops
// the auth gate won't be caught by feature-specific tests — those exercise
// happy paths. This sweep is the safety net.
//
// Strategy: sign in as bot1 (so every function passes its `auth.getUser`
// gate), POST `{}`, and assert the response is a 400 whose body's error
// message mentions one of the function's required fields. The exact path
// matters less than "Zod's path-prefixed message is reaching the client".

import { bootstrapTestLeague, BootstrapResult } from '../helpers/bootstrap';
import { signInAsBot } from '../helpers/clients';
import { expectHttpError } from '../helpers/expect';

const TIMEOUT = 45_000;

/**
 * Each case: a function name and a regex that should match the 400's error
 * message. The regex is a substring search using a field name the schema
 * declares as required, so empty-body parse failure ends up surfacing that
 * field path in the message.
 *
 * Functions excluded:
 * - Cron-only (no JSON body): poll-*, sync-*, update-*, process-*, queue-worker,
 *   check-bidding-wars, backfill-historical-stats, finalize-week, delete-account
 * - Webhook-signed (different auth path): handle-subscription-webhook,
 *   webhook-notify, sync-prospect, sync-subscription, moderate-messages (cron)
 * - Admin-gated functions that 403 before body parse: manage-subscription,
 *   send-notification (the admin gate uses ADMIN_USER_IDS env, not user role)
 */
const cases: Array<{ fn: string; field: RegExp }> = [
  { fn: 'vote-poll', field: /poll_id|selections/ },
  { fn: 'create-poll', field: /league_id|conversation_id|question|options/ },
  { fn: 'create-survey', field: /league_id|title|questions/ },
  { fn: 'create-rookie-draft', field: /league_id/ },
  { fn: 'commissioner-action', field: /action|league_id|team_id|player_id/ },
  { fn: 'mark-payment', field: /league_id|team_id|season|action/ },
  { fn: 'make-draft-pick', field: /draft_id|player_id|player_position|league_id/ },
  { fn: 'execute-trade', field: /proposal_id/ },
  { fn: 'reverse-trade', field: /proposal_id/ },
  { fn: 'advance-season', field: /league_id/ },
  { fn: 'start-lottery', field: /league_id/ },
  { fn: 'start-draft', field: /draft_id/ },
  { fn: 'run-lottery', field: /league_id|season/ },
  { fn: 'finalize-keepers', field: /league_id/ },
  { fn: 'generate-playoff-round', field: /league_id/ },
  { fn: 'generate-schedule', field: /league_id/ },
  { fn: 'submit-seed-pick', field: /league_id|round|opponent_team_id/ },
  { fn: 'submit-survey', field: /survey_id|answers/ },
  { fn: 'trigger-autopick', field: /draft_id/ },
  { fn: 'upload-chat-media', field: /league_id|team_id|image_base64/ },
  { fn: 'upload-team-logo', field: /team_id|image_base64/ },
  { fn: 'report-message', field: /message_id|reason/ },
  // push-live-activity auths via CRON_SECRET / SB_SECRET_KEY, not user JWT —
  // bot1's call returns 401 before body parsing. Excluded.
  { fn: 'import-sleeper-league', field: /action/ },
  { fn: 'import-screenshot-league', field: /action/ },
];

// get-week-scores has both fields optional (cron mode sends `{}`), so an
// empty body falls through to the cron-secret check and returns 401, not 400.
// Excluded from the sweep — its validation contract is best tested
// alongside scoring math in PR 8.

describe('Validation contract sweep', () => {
  let league: BootstrapResult;
  let client: Awaited<ReturnType<typeof signInAsBot>>;

  beforeAll(async () => {
    league = await bootstrapTestLeague();
    client = await signInAsBot(1);
  }, TIMEOUT);

  // Reference `league` so tsc keeps it useful (each function rejects on
  // missing fields regardless, but the bootstrap ensures the test runs in a
  // valid DB state in case any function reaches further than body parsing).
  it('test league bootstrap available', () => {
    expect(league.leagueId).toBeTruthy();
  });

  it.each(cases)(
    '$fn rejects empty body with a 400 + field-level error',
    async ({ fn, field }) => {
      const result = await client.functions.invoke(fn, { body: {} });
      await expectHttpError(result, { status: 400, messageMatch: field });
    },
    TIMEOUT,
  );
});
