import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

import { getArchivedLeagueIds } from '../_shared/archivedLeagues.ts';
import { rearmPausedDraft } from '../_shared/draftResume.ts';
import { handleError, jsonResponse, errorResponse } from '../_shared/http.ts';
import { notifyTeams } from '../_shared/push.ts';
import { isSlowClock, pickDeadlineMs } from '../../../utils/draft/pickClock.ts';
import { isQuietNow } from '../../../utils/draft/quietHours.ts';
import type { Database } from '../../../types/database.types.ts';

/**
 * Quiet-hours driver for slow (async) drafts. Called by pg_cron every 5 minutes.
 *
 * A slow draft's pick clock runs for hours/days, so a team can land on the clock
 * at 3am and be auto-drafted while everyone sleeps. When a quiet-hours-enabled
 * draft is inside its nightly window this function FREEZES it — reusing the
 * commissioner-pause machinery (status='paused', pause_reason='quiet_hours',
 * remaining clock snapshotted into paused_remaining_ms) so the in-flight
 * autodraft/reminder QStash timers no-op and the stalled-draft sweeper ignores
 * it. When the window closes it RE-ARMS a fresh timer from the snapshot (shared
 * rearmPausedDraft, guarded to only resume its own freezes so it never fights a
 * manual commissioner pause) and pings the on-clock GM that they're up.
 *
 * Auth is the CRON_SECRET bearer (same as sweep-stalled-drafts) — deploy
 * --no-verify-jwt.
 */

Deno.serve(async (req) => {
  try {
    const cronSecret = Deno.env.get('CRON_SECRET') ?? '';
    const authHeader = req.headers.get('Authorization') ?? '';
    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
      return errorResponse('Unauthorized', 401);
    }

    const supabaseAdmin = createClient<Database>(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SB_SECRET_KEY') ?? ''
    );

    const [{ data: drafts, error }, archivedIds] = await Promise.all([
      supabaseAdmin
        .from('drafts')
        .select('id, league_id, status, pause_reason, current_pick_number, current_pick_timestamp, current_pick_time_limit, paused_at, paused_remaining_ms, time_limit, picks_per_round, accelerate_after_round, accelerated_time_limit, quiet_hours_enabled, quiet_hours_start_min, quiet_hours_end_min')
        .eq('quiet_hours_enabled', true)
        .in('status', ['in_progress', 'paused']),
      getArchivedLeagueIds(supabaseAdmin),
    ]);
    if (error) throw error;

    const now = new Date();
    let frozen = 0;
    let resumed = 0;

    for (const d of drafts ?? []) {
      // Archived (soft-deleted) leagues bypass leagues_select RLS — skip them so
      // we don't keep managing a draft whose UI is gone. Quiet hours is a
      // slow-draft-only feature; guard defensively in case a fast clock ever
      // carries the flag.
      if (archivedIds.has(d.league_id)) continue;
      if (!isSlowClock(d.time_limit)) continue;

      const quiet = isQuietNow(d, now);

      try {
        // ENTER: a running draft crossed into the window — freeze it. Snapshot
        // the remaining clock exactly like pause-draft. Atomic guard on
        // status='in_progress' so we never double-freeze or stomp a pick that
        // just landed.
        if (quiet && d.status === 'in_progress') {
          const limitSeconds = d.current_pick_time_limit ?? d.time_limit;
          const deadline = pickDeadlineMs(d.current_pick_timestamp, limitSeconds);
          const remainingMs = Math.max(0, deadline - now.getTime());
          const { data: updated, error: freezeErr } = await supabaseAdmin
            .from('drafts')
            .update({
              status: 'paused',
              pause_reason: 'quiet_hours',
              paused_at: now.toISOString(),
              paused_remaining_ms: remainingMs,
            })
            .eq('id', d.id)
            .eq('status', 'in_progress')
            .select('id');
          if (freezeErr) throw freezeErr;
          if (updated && updated.length > 0) frozen++;
          continue;
        }

        // EXIT: a quiet-hours freeze whose window has closed — re-arm the clock.
        // extraMatch pins pause_reason so a manual commissioner pause (or one a
        // commissioner already resumed) is left untouched.
        if (!quiet && d.status === 'paused' && d.pause_reason === 'quiet_hours') {
          const result = await rearmPausedDraft(supabaseAdmin, d, { pause_reason: 'quiet_hours' });
          if (!result.resumed) continue;
          resumed++;

          // Wake-up push to the GM now on the clock (autopick teams get the
          // autopick-made push instead, so skip those). Archived leagues are
          // already filtered above, so notifyTeams (no archived backstop) is safe.
          if (result.onClockTeamId && !result.autopickTriggered) {
            const { data: league } = await supabaseAdmin
              .from('leagues')
              .select('name')
              .eq('id', d.league_id)
              .single();
            const ln = league?.name ?? 'Your League';
            await notifyTeams(supabaseAdmin, [result.onClockTeamId], 'draft',
              `${ln} — Draft's back on!`,
              "Quiet hours are over — you're on the clock.",
              { screen: 'draft-room', draft_id: d.id }
            );
          }
        }
      } catch (err) {
        console.error(`manage-draft-quiet-hours: draft ${d.id} failed:`, err);
      }
    }

    return jsonResponse({ checked: drafts?.length ?? 0, frozen, resumed });
  } catch (error) {
    return handleError(error, 'manage-draft-quiet-hours');
  }
});
