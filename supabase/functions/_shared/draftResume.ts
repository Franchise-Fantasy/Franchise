// Shared restore path for a paused draft, used by both resume-draft (manual
// commissioner resume) and manage-draft-quiet-hours (automatic quiet-window
// exit). The restore is subtle — remaining-clock computation, the
// pick-advanced-during-pause race, autopick-immediate, and the all-or-nothing
// "arm QStash BEFORE flipping status" ordering — so it lives in one place
// rather than being copy-pasted into the two callers where it would drift.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

import { effectiveTimeLimit } from './draftClock.ts';
import { notifyTeams } from './push.ts';
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
 * never a manual commissioner pause). QStash duplicate publishes are safe (see
 * qstash.ts), so if the guarded update matches no row because a racer resumed
 * first, that's treated as a successful resume rather than an error — we
 * re-check the draft's live status and only report `resumed: false` if it's
 * genuinely still paused (extraMatch rejected it, e.g. commissioner vs.
 * quiet-hours-only cron).
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

  let resumed = !!updated && updated.length > 0;
  if (!resumed && Object.keys(extraMatch).length === 0) {
    // Unscoped caller (the manual commissioner resume) with 0 rows matched —
    // a racer (e.g. the quiet-hours cron) already resumed it first, which is
    // fine since QStash duplicates are safe. Re-read the live status: if it's
    // now in_progress, report success instead of a false "still paused" error.
    // Scoped callers (extraMatch, e.g. the cron itself) keep strict semantics
    // — 0 rows there means "someone else already handled this, don't re-fire."
    const { data: current } = await supabaseAdmin
      .from('drafts')
      .select('status')
      .eq('id', draft.id)
      .maybeSingle();
    resumed = current?.status === 'in_progress';
  }

  return {
    resumed,
    remainingSeconds,
    onClockTeamId,
    autopickTriggered,
  };
}

/**
 * Wake-up push to the GM who is now on the clock after a resume.
 *
 * Both resume paths (manual commissioner resume, quiet-window exit) need the
 * identical guard — skip when no team resolved, and skip when the team's
 * autopick already fired, since they get the autopick-made push instead — so it
 * lives here beside `rearmPausedDraft` rather than being duplicated. Callers
 * supply their own copy; `title` is prefixed with the league name by the
 * caller, matching every other draft push.
 *
 * `notifyTeams` has no archived-league backstop, so callers must already have
 * excluded archived leagues (the quiet-hours cron filters its working set; the
 * manual resume is only reachable from a league whose UI exists).
 */
export async function notifyOnClockAfterResume(
  supabaseAdmin: SupabaseClient,
  draftId: string,
  result: RearmResult,
  title: string,
  body: string,
): Promise<void> {
  if (!result.onClockTeamId || result.autopickTriggered) return;
  await notifyTeams(supabaseAdmin, [result.onClockTeamId], 'draft', title, body, {
    screen: 'draft-room',
    draft_id: draftId,
  });
}
