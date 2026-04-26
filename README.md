# Franchise

Multi-sport fantasy app (NBA, WNBA, with NFL/NHL/MLB scaffolds in place). Built on **Expo + React Native + TypeScript** for the client and **Supabase** (Postgres, RLS, Edge Functions) for the backend. iOS and Android are first-class targets; a basic web build exists but is not the primary surface.

A separate Next.js landing site lives in [`landing/`](landing/) and is published at [franchisefantasy.co](https://franchisefantasy.co).

## Prerequisites

- **Node**: 20+ (see [`.nvmrc`](.nvmrc))
- **Expo CLI**: invoked via `npx expo` (no global install required)
- **Supabase CLI**: only needed for edge function / migration work — `brew install supabase/tap/supabase` or platform equivalent
- **EAS CLI** (for cloud builds): `npm i -g eas-cli`

## Setup

```bash
npm install
# Create .env.local with the EXPO_PUBLIC_* values for Supabase, RevenueCat,
# Sentry, etc. — see "Environment variables" below for what's required.
npx expo start
```

Press `i` for iOS simulator, `a` for Android emulator, or scan the QR with the Expo Go app on a device.

### Environment variables

The client reads `EXPO_PUBLIC_*` vars from `.env.local` in dev. **EAS cloud builds do NOT read `.env.local`** — keep EAS Secrets in sync via `eas env:create --name <NAME> --value <VALUE> --visibility sensitive --environment preview --environment development --environment production`. See the iteration notes in [`CLAUDE.md`](CLAUDE.md) for the full list of gotchas.

Edge functions read their own secrets via `supabase secrets set NAME=value`. The pgmq cron-triggered functions also depend on a `cron_secret` row in Postgres `vault.secrets` — both must stay in sync (see CLAUDE.md `CRON_SECRET dual storage` note).

## Common commands

```bash
npm run check                # typecheck (app + edge fns) + lint + realtime-channel scan
npm run typecheck            # tsc --noEmit on the app only
npm run lint                 # eslint with --fix-friendly defaults
npm run test                 # jest unit tests (10 suites)
npm run test:integration     # mutation tests against the dev Supabase project
npm run gen-types            # regenerate types/database.types.ts from the live schema
```

`npm run check` is also enforced by lefthook on `pre-push` — failed runs block the push rather than asking nicely.

## Project layout

| Path | What lives here |
|---|---|
| [`app/`](app/) | Expo Router screens — file-based routing, `(tabs)` and grouped flows |
| [`components/`](components/) | Feature-grouped UI; **never** add new files at the root, use a subfolder |
| [`hooks/`](hooks/) | TanStack Query hooks + view-state hooks |
| [`utils/`](utils/) | Domain-grouped helpers (`roster/`, `scoring/`, `nba/`, `league/`, `format/`); root only for cross-cutting primitives |
| [`supabase/`](supabase/) | Edge functions (`functions/`) + migrations |
| [`__tests__/`](__tests__/) | Jest unit + mutation/integration tests |
| [`landing/`](landing/) | Next.js marketing site, deploys independently |

## Conventions

The full guide lives in [`CLAUDE.md`](CLAUDE.md). The short version:

- **Imports**: enforced by ESLint `import/order` — don't fight the auto-fix.
- **Realtime channels**: names created inside a `useEffect` MUST include `-${Date.now()}` to survive remounts (Hermes crashes natively otherwise). The pre-commit scanner enforces this.
- **Edge function deploys**: always `--no-verify-jwt`. Functions handle their own auth.
- **Type safety**: `as any` is a smell — strict mode is on, use it.
- **Logging**: import `{ logger }` from `@/utils/logger` instead of `console.*`.

## Testing

Unit tests run under jest with `--silent` by default. Integration tests at `__tests__/mutations/` hit a real dev Supabase project and exercise the user-facing edge functions, RPCs, and realtime broadcasts end-to-end. They are slower and not part of `npm run check` — run them ad-hoc when touching the data layer.

## Deploying

- **Mobile builds**: `eas build --platform ios|android --profile preview|production`. Profiles are defined in `eas.json`.
- **Edge functions**: `supabase functions deploy <name> --no-verify-jwt --project-ref iuqbossmnsezzgocpcbo`.
- **Migrations**: `supabase db push --linked` after committing the migration file.

## Wiki

Architectural decisions, schema notes, and feature explainers live in an Obsidian vault at `C:/Users/Joe/Desktop/Franchise Wiki/Franchise Wiki/`. Keep affected pages roughly in sync when changing pages, hooks, edge functions, tables, RPCs, or realtime subscriptions.
