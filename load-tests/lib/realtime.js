// Thin Supabase Realtime (Phoenix v1.0.0 wire protocol) helpers for k6.
//
// vsn=1.0.0 messages are JSON objects: { topic, event, payload, ref }.
// Newer vsn=2.0.0 uses an array form; we stick with v1 here because the
// shape is easier to debug from raw frames.
//
// Channel topic format: `realtime:<channel-name>`.
// Heartbeat every 30s on topic 'phoenix' or the connection drops.

import ws from 'k6/ws';

import { WSS_URL } from './config.js';

// Channel naming rule from CLAUDE.md: postgres_changes / broadcast channels
// inside the app's useEffect MUST include `-${Date.now()}` to avoid collision
// on remount. We mirror that here so k6 traffic resembles real client patterns.
export function withTimestamp(name) {
  return `${name}-${Date.now()}`;
}

let refCounter = 1;
function nextRef() { return String(refCounter++); }

export function buildJoinPayload(opts) {
  const {
    accessToken,
    presenceKey = '',
    postgresChanges = [],
    broadcastSelf = false,
  } = opts;
  return {
    config: {
      broadcast: { ack: false, self: broadcastSelf },
      presence: { key: presenceKey },
      postgres_changes: postgresChanges,
    },
    access_token: accessToken,
  };
}

// Connect to the realtime WS and run the user-supplied lifecycle.
//
// run({ socket, send, joinChannel, sendBroadcast, trackPresence, close })
//   - send(msg): raw send
//   - joinChannel(name, payload): sends phx_join on `realtime:name`
//   - sendBroadcast(name, event, payload): pushes a broadcast event on a joined channel
//   - trackPresence(name, meta): emits presence track on a joined channel
//   - close(): closes the socket
//
// onMessage(msg) is called for every parsed JSON message (incoming).
//
// holdMs: how long to keep the socket open (k6/ws callbacks are blocking).
export function withRealtime({ run, onMessage, holdMs = 30000 }) {
  const url = WSS_URL;

  const res = ws.connect(url, null, (socket) => {
    const joined = new Set();

    const send = (msg) => socket.send(JSON.stringify(msg));

    const joinChannel = (name, payload) => {
      const topic = `realtime:${name}`;
      send({ topic, event: 'phx_join', payload, ref: nextRef() });
      joined.add(topic);
    };

    const sendBroadcast = (name, event, payload) => {
      send({
        topic: `realtime:${name}`,
        event: 'broadcast',
        payload: { type: 'broadcast', event, payload },
        ref: nextRef(),
      });
    };

    const trackPresence = (name, meta) => {
      send({
        topic: `realtime:${name}`,
        event: 'presence',
        payload: { type: 'presence', event: 'track', payload: meta },
        ref: nextRef(),
      });
    };

    const close = () => socket.close();

    socket.on('open', () => {
      // Phoenix heartbeat every 30s — keeps the connection alive.
      socket.setInterval(() => {
        send({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: nextRef() });
      }, 25000);

      // Auto-close after holdMs so iteration doesn't run forever.
      socket.setTimeout(() => close(), holdMs);

      run({ socket, send, joinChannel, sendBroadcast, trackPresence, close });
    });

    socket.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw);
        if (onMessage) onMessage(msg);
      } catch (_e) {
        // ignore non-JSON frames
      }
    });

    socket.on('error', (e) => {
      console.warn(`ws error: ${e.error()}`);
    });
  });

  return res;
}

// Convenience: build a postgres_changes subscription block.
export function pgChange({ event = '*', schema = 'public', table, filter }) {
  const block = { event, schema, table };
  if (filter) block.filter = filter;
  return block;
}
