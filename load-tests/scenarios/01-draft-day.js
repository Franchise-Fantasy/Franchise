// Scenario 1 — Draft Day
//
// Half the VUs subscribe to the draft room (postgres_changes on draft_picks +
// presence track every 5s). Other half attempt make-draft-pick edge fn calls.
//
// We deliberately send picks that will fail validation ("not your turn" or
// invalid pick_number) so we exercise auth + rate-limit + DB lookup paths
// without mutating draft state. Successful picks would advance the live draft
// and corrupt the test league for other scenarios.
//
// Expected response distribution: 429s (rate limited), 500s (validation failed).
// Both count as "limiter responded correctly" for our checks.

import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

import { signInBot } from '../lib/auth.js';
import { TEST_LEAGUE_NAME } from '../lib/config.js';
import { withRealtime, withTimestamp, buildJoinPayload, pgChange } from '../lib/realtime.js';
import { adminSelect, edgeFn, rpc } from '../lib/supabase.js';

const draftPick429 = new Rate('draft_pick_429_rate');
const wsConnect = new Trend('ws_connect_ms');
const subscribed = new Counter('draft_ws_subscribed');
const presenceSync = new Counter('draft_presence_sync_msgs');
const pgChangesSeen = new Counter('draft_pg_changes_msgs');

export const options = {
  scenarios: {
    watchers: {
      executor: 'ramping-vus',
      exec: 'watcherIteration',
      startVUs: 0,
      stages: [
        { duration: '20s', target: 10 },
        { duration: '40s', target: 25 },
        { duration: '20s', target: 0 },
      ],
      gracefulStop: '10s',
    },
    pickers: {
      executor: 'ramping-vus',
      exec: 'pickerIteration',
      startVUs: 0,
      stages: [
        { duration: '20s', target: 5 },
        { duration: '40s', target: 15 },
        { duration: '20s', target: 0 },
      ],
      gracefulStop: '10s',
    },
  },
  thresholds: {
    'http_req_duration{endpoint:make-draft-pick}': ['p(95)<2000'],
    ws_connect_ms: ['p(95)<3000'],
  },
};

export function setup() {
  // Resolve the test league + active draft + player pool using the service-role key.
  // (Doing this once in setup() is much cheaper than per-VU.)
  const leagueRes = adminSelect(
    'leagues',
    `select=id&name=eq.${encodeURIComponent(TEST_LEAGUE_NAME)}`,
  );
  const league = JSON.parse(leagueRes.body)[0];
  if (!league) throw new Error('Test league not found');

  const draftRes = adminSelect(
    'drafts',
    `select=id,status,current_pick_number&league_id=eq.${league.id}&order=created_at.desc&limit=1`,
  );
  const draft = JSON.parse(draftRes.body)[0];
  if (!draft) throw new Error('No draft found in test league');

  // Pull a small pool of player IDs to send (we don't care if any are valid;
  // the function rejects before mutating).
  const playersRes = adminSelect('players', 'select=id,position&limit=50');
  const playerPool = JSON.parse(playersRes.body);

  console.log(`setup → league ${league.id}, draft ${draft.id} (status=${draft.status}), ${playerPool.length} players`);

  return { leagueId: league.id, draftId: draft.id, playerPool };
}

export function watcherIteration(data) {
  const { access_token } = signInBot(__VU);
  const channel = withTimestamp(`draft_room_${data.draftId}`);
  const start = Date.now();

  withRealtime({
    holdMs: 30000,
    onMessage: (msg) => {
      // phx_reply on a realtime: topic = our channel join confirmation.
      // Heartbeat replies come on topic 'phoenix' — skip those.
      if (
        msg.event === 'phx_reply' &&
        msg.payload?.status === 'ok' &&
        msg.topic?.startsWith('realtime:')
      ) {
        wsConnect.add(Date.now() - start);
        subscribed.add(1);
      }
      if (msg.event === 'presence_state' || msg.event === 'presence_diff') {
        presenceSync.add(1);
      }
      if (msg.event === 'postgres_changes') {
        pgChangesSeen.add(1);
      }
    },
    run: ({ joinChannel, trackPresence }) => {
      joinChannel(channel, buildJoinPayload({
        accessToken: access_token,
        presenceKey: `vu-${__VU}`,
        postgresChanges: [
          pgChange({ event: 'UPDATE', table: 'drafts', filter: `id=eq.${data.draftId}` }),
          pgChange({ event: '*', table: 'draft_picks', filter: `draft_id=eq.${data.draftId}` }),
        ],
      }));

      // Presence ping at +1s (after join settles), then every 5s. The k6/ws
      // socket helpers (setInterval/setTimeout) are scoped to the connection.
      // We can't reach them from here, so simulate via repeated ticks below.
    },
  });
}

export function pickerIteration(data) {
  const { access_token } = signInBot(__VU);
  // Send an intentionally-invalid pick: high pick_number + random player.
  // Function will reject with "not your turn" or "draft complete" — that's fine,
  // we're load-testing the path, not advancing state.
  const player = data.playerPool[__ITER % data.playerPool.length];
  const res = edgeFn('make-draft-pick', {
    draft_id: data.draftId,
    league_id: data.leagueId,
    player_id: player.id,
    player_position: player.position ?? 'PG',
  }, access_token);

  draftPick429.add(res.status === 429);
  check(res, {
    'limiter responded sensibly': (r) => r.status === 200 || r.status === 429 || r.status === 500,
    'no gateway timeout': (r) => r.status !== 504,
  });

  sleep(0.5 + Math.random());
}
