// Smoke test: 1 VU, signs in as a bot and exercises one RPC + one REST read.
// Run: npm run loadtest:smoke

import { check, sleep } from 'k6';

import { signInBot } from '../lib/auth.js';
import { restFrom } from '../lib/supabase.js';
import { TEST_LEAGUE_NAME } from '../lib/config.js';

export const options = {
  vus: 1,
  iterations: 3,
  thresholds: {
    http_req_failed: ['rate<0.01'],
    'http_req_duration{endpoint:auth_signin}': ['p(95)<1000'],
  },
};

export default function () {
  const { access_token } = signInBot(0);

  // REST: read the test league row by name
  const leagueRes = restFrom(
    'leagues',
    `select=id,name&name=eq.${encodeURIComponent(TEST_LEAGUE_NAME)}`,
    access_token,
  );
  check(leagueRes, {
    'league fetch 200': (r) => r.status === 200,
    'league fetch returns row': (r) => {
      try { return JSON.parse(r.body).length === 1; } catch { return false; }
    },
  });

  const league = JSON.parse(leagueRes.body)[0];
  if (!league) throw new Error('Test league not found — run __tests__/mutations setup first');

  // REST: read this user's team in the league (exercises RLS path on teams table)
  const teamsRes = restFrom(
    'teams',
    `select=id,name,user_id&league_id=eq.${league.id}&limit=10`,
    access_token,
  );
  check(teamsRes, {
    'teams fetch 200': (r) => r.status === 200,
    'teams fetch returns rows': (r) => {
      try { return JSON.parse(r.body).length > 0; } catch { return false; }
    },
  });

  sleep(0.5);
}
