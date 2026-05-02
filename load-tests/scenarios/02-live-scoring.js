// Scenario 2 — Live Scoring (broadcast fanout)
//
// What this measures: Supabase Realtime's broadcast pipeline under fanout.
// Subscribers connect to N synthetic channels (round-robin); publishers POST
// to the Realtime HTTP broadcast endpoint, which fans the message out to all
// connected subscribers of that channel. We tag every payload with sent_at_ms
// so subscribers can compute fanout latency.
//
// We use synthetic channel names (week-scores-loadtest-N) so the test is
// independent of whether the dev league actually has scheduled weeks. Real
// production traffic would use week-scores-${scheduleId} but the wire shape
// and server load profile are identical.

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';

import { signInBot } from '../lib/auth.js';
import { ANON_KEY, SB_SECRET_KEY, SUPABASE_URL } from '../lib/config.js';
import { withRealtime, buildJoinPayload } from '../lib/realtime.js';

const broadcastReceived = new Counter('broadcast_msgs_received');
const broadcastFanout = new Trend('broadcast_fanout_ms');
const wsJoined = new Counter('scoring_ws_joined');
const publishOk = new Counter('broadcast_publish_ok');

const SYNTH_CHANNELS = 5;
const channelName = (i) => `week-scores-loadtest-${i}`;

export const options = {
  scenarios: {
    subscribers: {
      executor: 'ramping-vus',
      exec: 'subscribe',
      startVUs: 0,
      stages: [
        { duration: '20s', target: 30 },
        { duration: '60s', target: 50 },
        { duration: '20s', target: 0 },
      ],
      gracefulStop: '15s',
    },
    publishers: {
      executor: 'constant-vus',
      exec: 'publish',
      vus: 2,
      duration: '100s',
    },
  },
  thresholds: {
    broadcast_fanout_ms: ['p(95)<2000'],
    'http_req_failed{endpoint:realtime_broadcast}': ['rate<0.05'],
  },
};

export function setup() {
  if (!SB_SECRET_KEY) throw new Error('SB_SECRET_KEY env var required for publishers');
  console.log(`setup → using ${SYNTH_CHANNELS} synthetic channels for broadcast fanout test`);
  return {};
}

export function subscribe() {
  const { access_token } = signInBot(__VU);
  // Deterministic name (no -${Date.now()} suffix) so publisher and subscriber
  // hit the same topic. The CLAUDE.md rule about timestamp suffixes applies to
  // postgres_changes channels in app code (where useEffect remount races); for
  // a load-test broadcast where subscribers and publishers are decoupled, both
  // sides need to agree on the topic, so we use the bare name.
  const channelIdx = __VU % SYNTH_CHANNELS;
  const channel = channelName(channelIdx);

  withRealtime({
    holdMs: 60000,
    onMessage: (msg) => {
      if (
        msg.event === 'phx_reply' &&
        msg.payload?.status === 'ok' &&
        msg.topic?.startsWith('realtime:')
      ) {
        wsJoined.add(1);
      }
      if (msg.event === 'broadcast') {
        broadcastReceived.add(1);
        const sentAt = msg.payload?.payload?.sent_at_ms;
        if (sentAt) broadcastFanout.add(Date.now() - sentAt);
      }
    },
    run: ({ joinChannel }) => {
      joinChannel(channel, buildJoinPayload({
        accessToken: access_token,
        presenceKey: '',
        postgresChanges: [],
      }));
    },
  });
}

export function publish() {
  const channelIdx = Math.floor(Math.random() * SYNTH_CHANNELS);
  const channel = channelName(channelIdx);

  const sentAt = Date.now();
  const res = http.post(
    `${SUPABASE_URL}/realtime/v1/api/broadcast`,
    JSON.stringify({
      messages: [{
        topic: channel,
        event: 'score_update',
        payload: { sent_at_ms: sentAt, vu: __VU, iter: __ITER },
      }],
    }),
    {
      headers: {
        apikey: SB_SECRET_KEY,
        Authorization: `Bearer ${SB_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
      tags: { endpoint: 'realtime_broadcast' },
    },
  );

  check(res, {
    'broadcast publish accepted': (r) => r.status === 202 || r.status === 200,
  });
  if (res.status === 200 || res.status === 202) publishOk.add(1);

  sleep(2 + Math.random());
}
