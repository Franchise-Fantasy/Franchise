// Single home for the QStash delayed-message publishers that drive the draft
// clock. start-draft, make-draft-pick, autodraft, resume-draft, and
// trigger-autopick used to each carry a private copy of scheduleAutodraft —
// consolidating them here means the delay header, target URL, and payload
// shape can't drift, and the slow-draft reminder rides the same publish path.
//
// QStash messages can NOT be cancelled. Every consumer (autodraft,
// draft-pick-reminder) is idempotent and no-ops on stale pick numbers /
// already-made picks / paused drafts, so publishing duplicates is always safe.

import { isSlowClock, reminderLeadSeconds } from '../../../utils/draft/pickClock.ts';

const QSTASH_PUBLISH_BASE = 'https://qstash-us-east-1.upstash.io/v2/publish';

async function publishDelayed(
  functionName: string,
  delaySeconds: number,
  body: Record<string, unknown>,
): Promise<string> {
  const targetUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/${functionName}`;
  const res = await fetch(`${QSTASH_PUBLISH_BASE}/${targetUrl}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${Deno.env.get('QSTASH_TOKEN')?.trim()}`,
      'Content-Type': 'application/json',
      'Upstash-Delay': `${delaySeconds}s`,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`QStash error ${res.status}: ${text}`);
  return text;
}

/** Arm the pick clock: autodraft fires for (draft_id, pick_number) after
 *  time_limit seconds. Throws on publish failure — callers that need
 *  all-or-nothing semantics (resume-draft) rely on that. */
export function scheduleAutodraft(
  draft_id: string,
  pick_number: number,
  time_limit: number,
  autopick_triggered = false,
): Promise<string> {
  return publishDelayed('autodraft', time_limit, { draft_id, pick_number, autopick_triggered });
}

/** Slow drafts only: schedule the "your clock is running out" push, fired at
 *  time_limit − lead (a quarter of the clock, capped at 6h — see pickClock).
 *  No-op for live clocks. Never throws — a missed reminder must not break the
 *  pick flow that scheduled it. */
export async function schedulePickReminder(
  draft_id: string,
  pick_number: number,
  time_limit: number,
): Promise<void> {
  if (!isSlowClock(time_limit)) return;
  const delay = time_limit - reminderLeadSeconds(time_limit);
  try {
    await publishDelayed('draft-pick-reminder', delay, { draft_id, pick_number });
  } catch (err) {
    console.warn('Failed to schedule pick reminder (non-fatal):', err);
  }
}
