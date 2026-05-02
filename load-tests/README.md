# Load tests (k6)

Local-only k6 load testing harness for franchise.v2. Targets the dev Supabase
project (`iuqbossmnsezzgocpcbo`) and reuses the `__TEST__ Franchise Mutations`
league + bot users seeded by `__tests__/mutations/`.

## Prerequisites

- k6 installed (`winget install GrafanaLabs.k6` on Windows; `brew install k6` on macOS).
- The mutations test bootstrap has been run at least once so the `__TEST__`
  league + bot users exist in the dev DB. See `__tests__/mutations/helpers/bootstrap.ts`.

## Env vars

All scripts read from `__ENV` (passed via `-e KEY=val`). The npm scripts source
`.env.local` automatically. To run k6 directly, you need:

| Var | Required | From |
|-----|----------|------|
| `SUPABASE_URL` | yes | `EXPO_PUBLIC_SUPABASE_URL` in `.env.local` |
| `ANON_KEY` | yes | `EXPO_PUBLIC_SB_PUBLISHABLE_KEY` in `.env.local` |
| `SB_SECRET_KEY` | scenarios 1,2,3 (admin reads + cleanup) | `SB_SECRET_KEY` in `.env.local` |

## Scripts

```bash
npm run loadtest:smoke      # 1 VU × 3 iterations, ~5s
npm run loadtest:draft      # ~80s, 25 watchers + 15 pickers peak
npm run loadtest:scoring    # ~140s, 50 broadcast subscribers + 2 publishers
npm run loadtest:chat       # ~100s, 30 lurkers + 8 senders, auto-cleanup
npm run loadtest:trade      # ~90s, 8 VUs hammering execute-trade
```

## Layout

```
load-tests/
  lib/
    config.js     # env + constants
    auth.js       # signInBot / signInWatcher (REST /auth/v1/token)
    supabase.js   # http wrappers: edgeFn, rpc, restFrom, restInsert, admin*
    realtime.js   # WS connect + Phoenix join helpers
    cleanup.js    # purgeLoadtestChatMessages
  smoke/
    auth.js       # sanity check
  scenarios/
    01-draft-day.js
    02-live-scoring.js
    03-league-chat.js
    04-trade-flow.js
```

## Safety notes

- Picks (scenario 1) are intentionally invalid (wrong pick_number) so they
  reject without mutating draft state. We measure auth + rate-limit cost.
- Chat senders (scenario 3) prefix every message body with `__loadtest__`;
  teardown deletes those rows via service-role REST.
- Trade attempts (scenario 4) use a non-existent proposal_id — no roster
  mutation occurs.
- All scenarios target the dev project. Do not run against production.

## Interpreting results

After each run, look at:
- `checks` — every check passing means the API behaved as expected
- `thresholds` — fails the run if breached, e.g. p95 latency exceeded
- Custom metrics (`broadcast_fanout_ms`, `chat_send_to_receive_ms`,
  `draft_pg_changes_msgs`) — measure realtime fanout under load
- 429 rates — confirm the rate limiter is responding under burst

If thresholds fail repeatedly, check:
- Supabase dashboard → Logs → API/Edge Functions for 5xx
- `pg_stat_activity` peak connection count during the run
- Realtime metrics in the Supabase dashboard for connection limits
