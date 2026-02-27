Allow point scoring to go to hundreths (.75)

Attempting to make a trade will sometimes result in a white screen.

Playoff team numbers don't always line up. When in a 4-team league, it gives the option for 4, 6, 8 playoff teams

"create rookie draft" the draft card does not appear without a refresh.

Clicking a notification won't switch you to that league, just the one

## Existing Bugs

- one person didn't get "draft is over" message
- venmo in league info

## Your Manual Steps (Tier 1 MVP)

### Deploy delete-account edge function

- Also create a `decrement_team_count` RPC in Supabase SQL editor if it doesn't exist:

```sql
CREATE OR REPLACE FUNCTION decrement_team_count(lid uuid)
RETURNS void AS $$
  UPDATE leagues SET current_teams = current_teams - 1 WHERE id = lid;
$$ LANGUAGE sql SECURITY DEFINER;
```

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

## Tier 2 — Should-Have (First Weeks)

- [x] **OTA update prompts** — `_layout.tsx` checks for updates on launch, prompts user to install
- [x] **Offline detection** — `OfflineBanner` component shows red bar when disconnected
- [x] **UI error states** — `ErrorState` component with retry button, applied to home/roster/matchup tabs
- [x] **Fix notification gap** — `push.ts` now parses Expo response, deletes `DeviceNotRegistered` tokens; `refreshPushToken()` re-registers on app foreground
- [ ] **Edge function input validation** — validate POST body schemas on `make-draft-pick`, `execute-trade`, `commissioner-action`, `submit-seed-pick`
- [ ] **Email verification** — enable "Confirm email" in Supabase Auth dashboard, show "Check your email" interstitial after sign-up

## Tier 3 — Nice-to-Have (Post-Launch)

- [x] League creation wizard state persistence (AsyncStorage — resumes on re-open)
- [ ] Analytics (PostHog — free 1M events/month, also has basic error tracking)
- [ ] Onboarding walkthrough (tooltip tour for draft, trades, waivers)
- [ ] Deep-linked invite URLs (`franchisev2://join?code=XXXX` + Universal Links / App Links)
- [ ] Rate limiting on edge functions
- [ ] Accessibility labels (zero a11y props exist currently)
- [ ] iPad-specific layouts
- [ ] QR codes for league invites
