import http from 'k6/http';
import { check, fail } from 'k6';

import { SUPABASE_URL, ANON_KEY, BOT_EMAILS, BOT_PASSWORD, WATCHER_EMAIL } from './config.js';

// Per-VU JWT cache. Each VU runs in its own JS runtime, so this is naturally
// scoped to one VU. Sign in once per VU rather than per iteration.
const tokenCache = {};

function signIn(email, password) {
  const res = http.post(
    `${SUPABASE_URL}/auth/v1/token?grant_type=password`,
    JSON.stringify({ email, password }),
    {
      headers: {
        apikey: ANON_KEY,
        'Content-Type': 'application/json',
      },
      tags: { endpoint: 'auth_signin' },
    },
  );

  if (res.status !== 200) {
    fail(`signIn(${email}) → ${res.status} ${res.body}`);
  }

  const body = JSON.parse(res.body);
  return { access_token: body.access_token, user_id: body.user.id, email };
}

export function signInBot(n) {
  const email = BOT_EMAILS[n % BOT_EMAILS.length];
  if (!tokenCache[email]) tokenCache[email] = signIn(email, BOT_PASSWORD);
  return tokenCache[email];
}

export function signInWatcher(password) {
  if (!password) fail('signInWatcher requires WATCHER_PASSWORD env var');
  if (!tokenCache[WATCHER_EMAIL]) tokenCache[WATCHER_EMAIL] = signIn(WATCHER_EMAIL, password);
  return tokenCache[WATCHER_EMAIL];
}

// Helper for k6 setup() — runs once before VUs start. Returns a JWT for any
// shared lookups (resolving league_id, draft_id, etc.).
export function setupBotJwt(n = 0) {
  return signIn(BOT_EMAILS[n], BOT_PASSWORD);
}
