// Post-run cleanup helpers. Each scenario calls into these from its
// k6 teardown() hook.
//
// Safety: every helper here scopes deletes to the LOADTEST_MARKER prefix
// so we can never wipe real data. If a scenario produces rows that don't
// carry the marker, add a dedicated helper rather than broadening these.

import { LOADTEST_MARKER } from './config.js';
import { adminDelete } from './supabase.js';

// DELETE chat_messages whose content starts with `__loadtest__`.
// Uses PostgREST's `like` operator with URL-encoded `*` wildcards.
export function purgeLoadtestChatMessages() {
  const filter = `content=like.${LOADTEST_MARKER}*`;
  const res = adminDelete('chat_messages', filter);
  return { status: res.status, body: res.body };
}
