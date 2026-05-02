// Scenario 3 — League Chat
//
// Lurkers subscribe to chat_messages postgres_changes (INSERT events).
// Senders INSERT chat_messages tagged with __loadtest__ prefix into the
// `content` column (NOT body — that was a draft-plan typo).
// Cleanup deletes tagged rows in teardown().

import { check, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';

import { signInBot } from '../lib/auth.js';
import { LOADTEST_MARKER, TEST_LEAGUE_NAME } from '../lib/config.js';
import { purgeLoadtestChatMessages } from '../lib/cleanup.js';
import { withRealtime, withTimestamp, buildJoinPayload, pgChange } from '../lib/realtime.js';
import { adminSelect, restInsert, rpc } from '../lib/supabase.js';

const messagesReceived = new Counter('chat_msgs_received');
const messagesSent = new Counter('chat_msgs_sent');
const sendToReceiveLatency = new Trend('chat_send_to_receive_ms');
const presenceMsgs = new Counter('chat_presence_msgs');

export const options = {
  scenarios: {
    lurkers: {
      executor: 'ramping-vus',
      exec: 'lurk',
      startVUs: 0,
      stages: [
        { duration: '20s', target: 15 },
        { duration: '60s', target: 30 },
        { duration: '20s', target: 0 },
      ],
      gracefulStop: '15s',
    },
    senders: {
      executor: 'ramping-vus',
      exec: 'send',
      startVUs: 0,
      stages: [
        { duration: '20s', target: 4 },
        { duration: '60s', target: 8 },
        { duration: '20s', target: 0 },
      ],
      gracefulStop: '10s',
    },
  },
  thresholds: {
    'http_req_duration{endpoint:rpc:get_messages_page}': ['p(95)<1000'],
    'http_req_duration{endpoint:rpc:get_total_unread}': ['p(95)<800'],
    'http_req_failed{endpoint:rest_insert:chat_messages}': ['rate<0.05'],
  },
};

export function setup() {
  const leagueRes = adminSelect(
    'leagues',
    `select=id&name=eq.${encodeURIComponent(TEST_LEAGUE_NAME)}`,
  );
  const league = JSON.parse(leagueRes.body)[0];
  if (!league) throw new Error('Test league not found');

  const convRes = adminSelect(
    'chat_conversations',
    `select=id&league_id=eq.${league.id}&type=eq.league&limit=1`,
  );
  const conversation = JSON.parse(convRes.body)[0];
  if (!conversation) throw new Error('League chat conversation not found');

  // Build user_id → team_id map so senders can post under their bot's team.
  const teamsRes = adminSelect(
    'teams',
    `select=id,user_id&league_id=eq.${league.id}`,
  );
  const teams = JSON.parse(teamsRes.body);
  const userToTeam = {};
  for (const t of teams) userToTeam[t.user_id] = t.id;

  console.log(`setup → league ${league.id}, conversation ${conversation.id}, ${teams.length} teams`);
  return {
    leagueId: league.id,
    conversationId: conversation.id,
    userToTeam,
    // Pick the first team_id as a fallback so the get_total_unread RPC has valid args
    sampleTeamId: teams[0]?.id,
  };
}

export function lurk(data) {
  const { access_token } = signInBot(__VU);
  const channel = withTimestamp(`chat_sub_${data.conversationId}`);

  withRealtime({
    holdMs: 45000,
    onMessage: (msg) => {
      if (msg.event === 'postgres_changes') {
        messagesReceived.add(1);
        const newRow = msg.payload?.data?.record ?? msg.payload?.record;
        if (newRow?.content) {
          const m = String(newRow.content).match(/\|sent_at_ms=(\d+)/);
          if (m) sendToReceiveLatency.add(Date.now() - Number(m[1]));
        }
      }
      if (msg.event === 'presence_state' || msg.event === 'presence_diff') {
        presenceMsgs.add(1);
      }
    },
    run: ({ joinChannel }) => {
      joinChannel(channel, buildJoinPayload({
        accessToken: access_token,
        presenceKey: `vu-${__VU}`,
        postgresChanges: [
          pgChange({
            event: 'INSERT',
            table: 'chat_messages',
            filter: `conversation_id=eq.${data.conversationId}`,
          }),
        ],
      }));
    },
  });

  // Periodic RPC pings (mimics chat list screen behavior).
  if (data.sampleTeamId) {
    const unreadRes = rpc('get_total_unread', {
      p_league_id: data.leagueId,
      p_team_id: data.sampleTeamId,
    }, access_token);
    check(unreadRes, { 'unread 200': (r) => r.status === 200 });
  }

  const pageRes = rpc('get_messages_page', {
    p_conversation_id: data.conversationId,
    p_limit: 30,
  }, access_token);
  check(pageRes, { 'messages page 200': (r) => r.status === 200 });
}

export function send(data) {
  const bot = signInBot(__VU);
  const teamId = data.userToTeam[bot.user_id];
  if (!teamId) {
    // No team for this bot in the test league — bail iteration cleanly.
    sleep(2);
    return;
  }

  const sentAt = Date.now();
  const content = `${LOADTEST_MARKER} VU${__VU} iter${__ITER} |sent_at_ms=${sentAt}`;

  const res = restInsert('chat_messages', {
    conversation_id: data.conversationId,
    team_id: teamId,
    content,
    type: 'text',
    league_id: data.leagueId,
  }, bot.access_token);

  messagesSent.add(1);
  check(res, {
    'message inserted': (r) => r.status === 201 || r.status === 200,
  });

  if (res.status >= 400) {
    // Surface failures in console once per VU for debugging.
    if (__ITER === 0) console.warn(`insert failed: ${res.status} ${res.body}`);
  }

  sleep(2 + Math.random() * 3);
}

export function teardown(_data) {
  console.log('teardown → purging loadtest chat messages...');
  const res = purgeLoadtestChatMessages();
  console.log(`teardown → purge status ${res.status}`);
}
