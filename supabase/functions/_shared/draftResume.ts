// Shared restore path for a paused draft, used by both resume-draft (manual
// commissioner resume) and manage-draft-quiet-hours (automatic quiet-window
// exit). The restore is subtle — remaining-clock computation, the
// pick-advanced-during-pause race, autopick-immediate, and the all-or-nothing
// "arm QStash BEFORE flipping status" ordering — so it lives in one place
// rather than being copy-pasted into the two callers where it would drift.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

import { effectiveTimeLimit } from './draftClock.ts';
import { scheduleAutodraft, schedulePickReminder } from './qstash.ts';

export interface RearmableDraft {
  id: string;
  current_pick_number: number;
  current_pick_timestamp: string | null;
  paused_at: string | null;
  paused_remaining_ms: number | null;
  time_limit: number;
  picks_per_round: number | null;
  accelerate_after_round: number | null;
  accelerated_time_limit: number | null;
}

export interface RearmResult {
  resumed: boolean;
  remainingSeconds: number;
  /** Team on the clock after resume — lets callers send a wake-up push. */
  onClockTeamId: string | null;
  /** True when the on-clock team's autopick fired immediately (no wake push
   *  needed — they'll get the autopick-made push instead). */
  autopickTriggered: boolean;
}

/**
 * Restore a paused draft's clock and flip it back to in_progress.
 *
 * Arms a fresh QStash autodraft timer (and, for slow clocks, the reminder)
 * BEFORE the status flip so the operation is all-or-nothing: if a publish
 * throws, the draft stays paused and the caller can retry — there is never an
 * in_progress draft with no clock. The atomic UPDATE is guarded by
 * `status='paused'` plus any `extraMatch` columns (the quiet-hours cron passes
 * `{ pause_reason: 'quiet_hours' }` so it only resumes freezes it created and
 * never a manual commissioner pause). Returns `resumed: false` when the guarded
 * update matched no row (a racer — e.g. the commissioner — resumed first).
 */
export async function rearmPausedDraft(
  supabaseAdmin: SupabaseClient,
  draft: RearmableDraft,
  extraMatch: Record<string, string | number | boolean> = {},
): Promise<RearmResult> {
  // Restore the clock. If an in-flight autodraft advanced the pick AFTER the
  // pause was recorded (a pause that raced a firing autopick), the snapshot is
  // for a pick that's already done — current_pick_timestamp will be newer than
  // paused_at. In that case give the now-current pick a fresh full clock rather
  // than the dead pick's leftover time. Otherwise continue from the snapshot
  // (at least 1s so QStash always re-arms).
  const pickAdvancedAfterPause =
    !!draft.current_pick_timestamp && !!draft.paused_at &&
    new Date(draft.current_pick_timestamp).getTime() > new Date(draft.paused_at).getTime();
  const remainingSeconds = pickAdvancedAfterPause
    ? effectiveTimeLimit(draft.current_pick_number, draft)
    : Math.max(1, Math.ceil((draft.paused_remaining_ms ?? draft.time_limit * 1000) / 1000));

  // If the team on the clock has autopick on, fire its pick immediately.
  let delay = remainingSeconds;
  let autopickTriggered = false;
  const { data: onClockPick } = await supabaseAdmin
    .from('draft_picks')
    .select('current_team_id')
    .eq('draft_id', draft.id)
    .eq('pick_number', draft.current_pick_number)
    .maybeSingle();
  const onClockTeamId = onClockPick?.current_team_id ?? null;
  if (onClockPick) {
    const { data: teamStatus } = await supabaseAdmin
      .from('draft_team_status')
      .select('autopick_on')
      .eq('draft_id', draft.id)
      .eq('team_id', onClockPick.current_team_id)
      .maybeSingle();
    if (teamStatus?.autopick_on) {
      delay = 1;
      autopickTriggered = true;
    }
  }

  await scheduleAutodraft(draft.id, draft.current_pick_number, delay, autopickTriggered);
  if (!autopickTriggered) {
    await schedulePickReminder(draft.id, draft.current_pick_number, remainingSeconds);
  }

  const now = new Date().toISOString();
  let query = supabaseAdmin
    .from('drafts')
    .update({
      status: 'in_progress',
      current_pick_timestamp: now,
      current_pick_time_limit: remainingSeconds,
      paused_at: null,
      paused_remaining_ms: null,
      pause_reason: null,
    })
    .eq('id', draft.id)
    .eq('status', 'paused');
  for (const [col, val] of Object.entries(extraMatch)) {
    query = query.eq(col, val);
  }
  const { data: updated, error: updateError } = await query.select('id');
  if (updateError) throw updateError;

  return {
    resumed: !!updated && updated.length > 0,
    remainingSeconds,
    onClockTeamId,
    autopickTriggered,
  };
}
