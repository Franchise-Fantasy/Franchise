## Your Manual Steps (Tier 1 MVP)

### Password reset - configure Supabase Auth

1. Go to Supabase Dashboard > Authentication > URL Configuration
2. Add `franchisev2://reset-password` to the Redirect URLs list
3. This allows the magic link email to deep link back into the app

### Sentry (for production builds only)

1. Create a project at https://sentry.io (free tier: 5K errors/month)
2. Add `EXPO_PUBLIC_SENTRY_DSN=https://your-dsn@sentry.io/xxx` to `.env.local`
3. Before doing `eas build`, re-add to `app.json` plugins: `"@sentry/react-native"`
4. Uncomment in `_layout.tsx`:
   - `import * as Sentry from '@sentry/react-native';`
   - `Sentry.init({ dsn: process.env.EXPO_PUBLIC_SENTRY_DSN });`
5. Does NOT work in Expo Go — only in custom dev builds / production

### DB schema backup (requires Docker)

1. Install and start Docker Desktop
2. Run: `npx supabase db dump -f supabase/migrations/00000000000000_baseline.sql`
3. Commit the file to git

### Terms of Service / Privacy Policy

- Template content is in `app/legal.tsx` — review and customize the text
- Update contact info, company name, specific data practices as needed

### Error boundary (re-add later)

- The `+error.tsx` file caused a white screen — needs investigation on correct Expo Router v4 API
- Re-add once you have a custom dev build where you can debug it properly

## Tier 1 — Now

- [ ] Integrate PostHog Analytics — instrument before real users
- [ ] Implement Email Verification — Supabase toggle + interstitial
- [ ] Set up rate limiting on edge functions
- [ ] Build Onboarding Walkthrough — tooltip tour, scaffold now, polish closer to launch
- [ ] League import tooling - ESPN and Yahoo (probably csv's or screenshots)
- [ ] Deep-Linked Invite URL's (Needs dev build)
- [ ] Google Login support

## Tier 2 — Analytics/Design-Dependent Premium Features

- [ ] Build Roster Efficiency — needs methodology defined first
- [ ] Build Luck Index + All-Play Record — needs thresholds defined first
- [ ] Build Strength of Schedule — needs projection method defined first
- [ ] Build Contender Score / Dynasty Power Rankings — needs weighting defined first
- [ ] Build "What If" Trade Simulator — blocked by Contender Score
- [ ] Build Age Curve Visualization — needs visual design first
- [ ] Build Draft Pick Value Tracker — needs design.
- [ ] Manager Report card - end-of-season grades: lineup accuracy, trade wins, waiver pickups, draft hits/misses. Awards ceremony UI.

## Tier 3 - Awaiting Team Discussion

- [ ] Build AI Trade Advisor — alignment needed on AI-in-app approach
- [ ] Build Weekly Recap Narratives — LLM-related, pending AI-in-app discussion
- [ ] Build Trade Value Chart — commissioner-editable tiers. Low priority
- [ ] Prospect Scouting / Rookie Rankings - blurbs + ratings for incoming rookies before rookie draft. Commissioner-written initially, AI-generated later?
- [ ] AI-generated yearly redrafts with overpick/underpick analysis

## Tier 4 — Future

- [ ] Venmo API integration (upgrade from simple ledger)
- [ ] iPad/Tablet-specific layouts
- [ ] Player News Feed — aggregated updates for rostered players
- [ ] In-season tournament option
- [ ] Build League Constitution Builder — structured, searchable, versioned rules doc
