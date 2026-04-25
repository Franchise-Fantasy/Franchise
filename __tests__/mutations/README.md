# Mutation integration tests

These tests exercise user-facing mutations (edge functions, RPCs, direct table writes) against the real dev Supabase project. Unlike the other tests in `__tests__/`, they are **not** pure unit tests — they create rows, call deployed edge functions, and trigger notifications.

## The test league

All mutations run inside a dedicated league named `__TEST__ Franchise Mutations` (season `2026-27`). If it doesn't exist, the first test run creates it, along with:

- **4 bot users** — `bot1@test.franchise.local` through `bot4@test.franchise.local`, password in [helpers/config.ts](helpers/config.ts). Bot 1 is the commissioner.
- **jjspoels@gmail.com** — added as a regular team owner so you receive push notifications when tests mutate state.
- **Rosters** — 4 real players per team, all on the bench slot, filtered to avoid players in live games (those auto-delay trades).
- **League chat** — so trade announcements have somewhere to post.

Bootstrap is idempotent. Subsequent runs reuse the existing league.

## Running

```bash
# Unit tests only (the existing suite — fast, no DB)
npm test

# Integration tests (this directory — hits dev Supabase)
npm run test:integration

# Nuke the test league and its children (if state gets corrupt)
npm run test:integration:nuke
```

Integration tests run serially (`--runInBand`) because they share state in the test league.

## Before running

**Deploy any local edge function changes.** Tests hit the deployed function URL (`https://iuqbossmnsezzgocpcbo.supabase.co/functions/v1/...`), not the files in this repo. If you've edited an edge function and not yet deployed, you'll be testing stale code.

```bash
supabase functions deploy execute-trade --no-verify-jwt --project-ref iuqbossmnsezzgocpcbo
```

## Structure

```
__tests__/mutations/
  globalSetup.ts          - jest globalSetup: runs bootstrap once
  helpers/
    config.ts             - env loading + constants (league name, bot emails, etc.)
    clients.ts            - admin (service role) + user (signed-in bot) Supabase clients
    bootstrap.ts          - idempotent setup of test league + bots + rosters + chat
    seed.ts               - per-test factories (createAcceptedOneForOneTrade, etc.)
    cleanup.ts            - resetTrades (per-test) + nukeTestLeague (CLI)
  trades/
    execute-trade.test.ts
  <phase 2+ feature folders go here>
```

## Adding a new test

1. Add a factory to `helpers/seed.ts` if you need new fixture shapes.
2. Add a cleanup helper to `helpers/cleanup.ts` if the test mutates new tables.
3. Write the test file under the appropriate feature folder.
4. Use `beforeEach` to reset state — tests should not depend on order.

## Known limitations

- **Push notifications fire for real.** jjspoels@gmail.com will get pinged every time a test completes a trade. That's intentional (so you can see things happening), but annoying if you run the suite often.
- **Chat messages are real.** Test runs spam the test league's chat with trade announcements. Run `npm run test:integration:cleanup` periodically to wipe it.
- **Cron can act on test data.** If a test crashes mid-way and leaves a row in `pending_transactions` or `waiver_claims`, cron will process it. Bias toward good teardown and be willing to nuke the league if things go weird.
- **Live games can delay trades.** The bootstrap filters out players with active games, but if a player's game starts *between* bootstrap and the test running, `execute-trade` will delay the trade instead of completing it. Re-run to recover.
