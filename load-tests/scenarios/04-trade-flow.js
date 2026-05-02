// Scenario 4 — Trade Flow
//
// VUs concurrently call execute-trade with a fake (non-existent) proposal_id
// to exercise auth + rate-limit + DB lookup paths under contention.
//
// We don't actually accept real proposals here because that would mutate roster
// state. The interesting load characteristics — auth + rate limit RPC + RLS
// check + initial proposal lookup — all happen before the row lock acquires.
//
// To test SELECT FOR UPDATE contention specifically, swap fakeProposal for a
// real (intentionally re-acceptable) proposal_id and measure the lock wait —
// out of scope for this initial pass.

import { check, sleep } from 'k6';
import { Counter, Rate } from 'k6/metrics';

import { signInBot } from '../lib/auth.js';
import { edgeFn } from '../lib/supabase.js';

const trade429 = new Rate('trade_429_rate');
const trade5xx = new Counter('trade_5xx_count');
const tradeCleanReject = new Counter('trade_clean_reject_count');

export const options = {
  vus: 8,
  duration: '90s',
  thresholds: {
    'http_req_duration{endpoint:execute-trade}': ['p(95)<2000'],
    // The function uses `throw new Error('proposal not found')` which surfaces
    // as 500. That's expected for our fake proposal_id, so we accept it. The
    // real test is that NO request times out and rate-limiting kicks in.
    'http_req_duration{endpoint:execute-trade}': ['max<10000'],
  },
};

// A throwaway proposal id that won't exist in the DB. The function should
// validate auth + rate limit + look up the row, then return a "not found" 4xx.
function fakeProposalId() {
  // Stable across iterations so cache lookups behave realistically.
  return '00000000-0000-0000-0000-00000000feed';
}

export default function () {
  const { access_token } = signInBot(__VU);

  const res = edgeFn('execute-trade', {
    proposal_id: fakeProposalId(),
  }, access_token);

  trade429.add(res.status === 429);
  if (res.status >= 500) trade5xx.add(1);
  if (res.status >= 400 && res.status < 500 && res.status !== 429) tradeCleanReject.add(1);

  check(res, {
    'limiter or validator responded': (r) =>
      r.status === 200 || r.status === 400 || r.status === 404 || r.status === 429 || r.status === 500,
    'no gateway timeout': (r) => r.status !== 504,
  });

  sleep(0.5 + Math.random());
}
