Code quality:

- Prefer simple, readable code over clever one-liners
- No premature abstraction — don't create utilities or helpers until you actually need them twice (unless we have an anticipated need in the near future)
- Functions should do one thing; if you have to use "and" to describe what it does, split it.
- Delete dead code rather than commenting it out, unless is will be useful for futureproofing.
- Write comments only if it helps future coders understand what is happening.
- Create Edge functions wherever it would speed things up.

- If there is something I've told you to remember, or something that you think will be needed in future sessions, please write a rule in this file under the "Iterations" section.

- Accessibility labelling needs to be added to an changes or new files by default.

Iterations:

- When adding/removing/renaming pages, hooks, edge functions, database tables, RPCs, or real-time subscriptions, update the relevant notes in the Obsidian wiki at `C:/Users/Joe/Desktop/Franchise Wiki/Franchise Wiki/`. Don't stress about perfection — just keep the affected notes roughly in sync.

- Supabase realtime channel names created inside a `useEffect` MUST include a `-${Date.now()}` (or equivalent unique) suffix. Deterministic names like `` `draft_status_${leagueId}` `` collide when React reconnects passive effects (tab switch, auth transition, concurrent re-render) because `supabase.removeChannel()` is async — the old channel is still in `joined` state when the new effect re-registers `postgres_changes` callbacks, Supabase throws, and Hermes crashes natively. Match the existing convention (see `useAnnouncements.ts`, `useWeekScores.ts`, etc.).

- Supabase edge functions MUST always be deployed with `--no-verify-jwt`. Every function in this project handles its own auth (via `auth.getUser()`, webhook signing secrets, or `isServerCall === Bearer ${SB_SECRET_KEY}` checks), and many are called by webhook senders / cron / function-to-function fetches that don't carry a Supabase session JWT. The CLI default is `verify_jwt: true`, which silently breaks every non-user-initiated call path. Always run `supabase functions deploy --no-verify-jwt --project-ref iuqbossmnsezzgocpcbo` (or pass `--no-verify-jwt` to a single-function deploy).

- EAS cloud builds DO NOT read `.env.local`. They only see env vars from EAS Secrets (managed via `eas env:create` / `eas env:list` / `eas env:delete` for the appropriate `--environment` of preview, development, or production) and any inline `env` blocks in `eas.json`. Local expo dev (metro) reads `.env.local` directly, so a missing EAS env var won't show up until you ship a binary. When adding/renaming any `EXPO_PUBLIC_*` var in `.env.local`, mirror the change in EAS via `eas env:create --name <NAME> --value <VALUE> --visibility sensitive --environment preview --environment development --environment production`. Note: EAS rejects `--visibility secret` for `EXPO_PUBLIC_*` because they end up in the JS bundle anyway.

- `CRON_SECRET` lives in TWO independent storage locations and they MUST stay in sync: (1) Supabase Edge Function Secrets (`supabase secrets set CRON_SECRET=…`), accessed by the function code via `Deno.env.get('CRON_SECRET')`, and (2) Postgres Vault (`vault.decrypted_secrets` where `name='cron_secret'`), read by pg_cron schedules in [supabase/migrations/20260412_enable_pgmq_queues.sql](supabase/migrations/20260412_enable_pgmq_queues.sql) when calling `net.http_post(... Authorization: Bearer …)`. If they drift, every cron-triggered function (`poll-live-stats`, `poll-news`, `poll-injuries`, `queue-worker`, etc.) silently 401s and you only notice when something downstream of them visibly breaks (live stats, processed waivers, etc.). To rotate: generate a fresh value, run `supabase secrets set CRON_SECRET=<new>` AND `SELECT vault.update_secret((SELECT id FROM vault.secrets WHERE name='cron_secret'), '<new>');` in the same session. To verify alignment, compare SHA256 of both: edge function digest is shown in `supabase secrets list`, vault digest from `SELECT encode(sha256(decrypted_secret::bytea), 'hex') FROM vault.decrypted_secrets WHERE name='cron_secret';` — they should be identical.
