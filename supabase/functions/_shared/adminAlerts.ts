// Shared dead-letter path: a dead_letter_alerts audit row, optionally plus an
// Expo push to every admin profile. Originally built for queue-worker's pgmq
// dead-letter path; reused by any cron that needs to give up on an
// unrecoverable retry loop (sweep-stalled-drafts, manage-draft-quiet-hours)
// instead of retrying forever and silently burning downstream resources
// (QStash quota, etc).
//
// The admin push is for GLOBAL infrastructure failures only. A failure scoped
// to one league must NOT use it: pushAdmins fans out to every is_admin profile
// regardless of league membership and bypasses per-user notification
// preferences, so a single league's stalled draft paged admins who weren't in
// that league — while the league's own commissioner, the only person who could
// act, got nothing. Those callers omit pushTitle/pushBody (audit row only) and
// send their own league-scoped notifyLeague/notifyTeams push instead.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

export async function pushAdmins(supabase: SupabaseClient, title: string, body: string): Promise<void> {
  const { data: admins } = await supabase.from('profiles').select('id').eq('is_admin', true);
  if (!admins || admins.length === 0) return;

  const adminIds = (admins as { id: string }[]).map((a) => a.id);
  const { data: tokens } = await supabase.from('push_tokens').select('token').in('user_id', adminIds);
  if (!tokens || tokens.length === 0) return;

  const messages = (tokens as { token: string }[]).map((t) => ({
    to: t.token,
    title,
    body,
    sound: 'default',
    priority: 'high',
    data: { screen: 'activity', channelId: 'commissioner' },
    channelId: 'commissioner',
  }));

  // Expo accepts up to 100 per request.
  for (let i = 0; i < messages.length; i += 100) {
    const batch = messages.slice(i, i + 100);
    try {
      await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(batch),
      });
    } catch (err) {
      console.warn('Expo push (admin) failed:', err);
    }
  }
}

/**
 * Records a dead_letter_alerts audit row, and pages admins when pushTitle and
 * pushBody are supplied. Used both for real pgmq dead-letters (originalMsgId is
 * the pgmq message id) and for crons that give up on an unrecoverable retry
 * loop (originalMsgId is a synthetic number — the identifying context belongs
 * in `payload` instead, e.g. `{ draft_id }`). Failures here must never block the
 * caller's own recovery path, so both calls are independently try/catch'd.
 *
 * Omit pushTitle/pushBody for a league-scoped failure and notify that league
 * yourself — see the header note.
 */
export async function recordDeadLetter(
  supabase: SupabaseClient,
  params: {
    originalQueue: string;
    originalMsgId: number;
    functionName?: string | null;
    reason: string;
    payload?: unknown;
    pushTitle?: string;
    pushBody?: string;
  },
): Promise<void> {
  try {
    await supabase.from('dead_letter_alerts').insert({
      original_queue: params.originalQueue,
      original_msg_id: params.originalMsgId,
      function_name: params.functionName ?? null,
      reason: params.reason,
      payload: params.payload ?? null,
    });
  } catch (e) {
    console.warn('dead_letter_alerts insert failed:', e instanceof Error ? e.message : e);
  }

  if (!params.pushTitle || !params.pushBody) return;
  try {
    await pushAdmins(supabase, params.pushTitle, params.pushBody);
  } catch (e) {
    console.warn('admin push failed:', e instanceof Error ? e.message : e);
  }
}

/** True when a dead-letter for this queue+draft has already been recorded and
 *  not yet resolved — callers should skip re-alerting (and re-attempting) in
 *  that case rather than spamming admins every cron tick. */
export async function hasUnresolvedDeadLetter(
  supabase: SupabaseClient,
  originalQueue: string,
  draftId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from('dead_letter_alerts')
    .select('id')
    .eq('original_queue', originalQueue)
    .contains('payload', { draft_id: draftId })
    .is('resolved_at', null)
    .limit(1);
  return !!data && data.length > 0;
}
