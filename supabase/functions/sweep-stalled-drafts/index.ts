import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { hasUnresolvedDeadLetter, recordDeadLetter } from '../_shared/adminAlerts.ts';
import { getArchivedLeagueIds } from '../_shared/archivedLeagues.ts';
import { handleError, jsonResponse, errorResponse } from '../_shared/http.ts';
import { notifyLeague } from '../_shared/push.ts';
import { scheduleAutodraft } from '../_shared/qstash.ts';
import type { Database } from '../../../types/database.types.ts';

/**
 * Watchdog for the QStash draft-clock chain. Each pick's timer is a single
 * QStash delayed message; if one publish fails (treated as non-fatal by
 * start-draft / make-draft-pick / autodraft), the chain dies and the draft
 * sits in_progress with an expired clock until a human notices. A 2-hour live
 * draft self-heals when someone picks; a slow draft (30 min – 1 day clocks)
 * spanning days does not. Called by pg_cron every 5 minutes: finds in_progress
 * drafts whose implicit deadline (current_pick_timestamp +
 * current_pick_time_limit) passed more than GRACE_MS ago and republishes the
 * autodraft message. autodraft is idempotent, so racing a slow-but-alive
 * QStash delivery is harmless.
 *
 * If a draft never recovers (an abandoned/orphaned draft, or a real bug in
 * autodraft that keeps it from ever advancing), re-arming every 5 minutes
 * forever would silently burn the QStash daily message quota — this is
 * exactly what a handful of abandoned test drafts did on 2026-07-25, exhausting
 * the quota and 500ing every function that arms the pick clock. Past
 * GIVE_UP_MS, stop re-arming and dead-letter instead (audit row + a push to the
 * affected league, once — hasUnresolvedDeadLetter guards against re-alerting
 * every tick).
 *
 * The give-up push is deliberately league-scoped, NOT recordDeadLetter's admin
 * push: one league's stalled draft is not an app-wide incident, and pushing
 * every is_admin profile meant unrelated people were told a draft they're not
 * in is stuck while that league's own commissioner heard nothing.
 */

// Past-deadline slack before we declare the chain dead. Covers QStash's normal
// delivery latency (~0.5–1.5s) plus retry backoff on transient 5xx.
const GRACE_MS = 120_000;

// How long past GRACE_MS to keep re-arming before giving up (~12 attempts at
// the 5-minute cron cadence) and paging an admin instead of retrying forever.
const GIVE_UP_MS = 3_600_000;

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
        .select('id, league_id, current_pick_number, current_pick_timestamp, current_pick_time_limit, time_limit')
        .eq('status', 'in_progress'),
      getArchivedLeagueIds(supabaseAdmin),
    ]);
    if (error) throw error;

    const now = Date.now();
    const stalled = (drafts ?? []).filter((d) => {
      if (archivedIds.has(d.league_id)) return false;
      if (!d.current_pick_timestamp) return false;
      const limitSeconds = d.current_pick_time_limit ?? d.time_limit;
      const deadline = new Date(d.current_pick_timestamp).getTime() + limitSeconds * 1000;
      return now > deadline + GRACE_MS;
    }).map((d) => {
      const limitSeconds = d.current_pick_time_limit ?? d.time_limit;
      const deadline = new Date(d.current_pick_timestamp!).getTime() + limitSeconds * 1000;
      return { draft: d, pastGraceMs: now - (deadline + GRACE_MS) };
    });

    let rearmed = 0;
    let deadLettered = 0;
    for (const { draft: d, pastGraceMs } of stalled) {
      if (pastGraceMs > GIVE_UP_MS) {
        if (await hasUnresolvedDeadLetter(supabaseAdmin, 'sweep-stalled-drafts', d.id)) continue;
        await recordDeadLetter(supabaseAdmin, {
          originalQueue: 'sweep-stalled-drafts',
          originalMsgId: d.current_pick_number,
          functionName: 'autodraft',
          reason: `Draft stalled >${Math.round(GIVE_UP_MS / 3_600_000)}h past grace at pick ${d.current_pick_number}; giving up automatic re-arm`,
          payload: { draft_id: d.id, league_id: d.league_id, pick_number: d.current_pick_number },
        });
        deadLettered++;

        // Non-fatal: the audit row above is the durable record, so a push
        // failure must not abort the sweep for the remaining drafts.
        try {
          const { data: league } = await supabaseAdmin
            .from('leagues')
            .select('name')
            .eq('id', d.league_id)
            .single();
          const ln = league?.name ?? 'Your League';
          await notifyLeague(supabaseAdmin, d.league_id, 'draft',
            `${ln} — Draft is stuck`,
            `Pick ${d.current_pick_number} hasn't advanced and the clock couldn't be restarted automatically. The commissioner can pause and resume the draft to get it moving.`,
            { screen: 'draft-room', draft_id: d.id },
          );
        } catch (err) {
          console.error(`sweep-stalled-drafts: give-up notify failed for draft ${d.id}:`, err);
        }
        continue;
      }
      try {
        // Re-fire the expired pick's autodraft immediately (2s delay). The
        // downstream chain re-arms itself: autodraft schedules the next pick's
        // clock + reminder after it advances. If the on-clock team picks a
        // fresh full clock in a race, the idempotency guards sort it out.
        await scheduleAutodraft(d.id, d.current_pick_number, 2);
        rearmed++;
        console.log(`sweep-stalled-drafts: re-armed draft ${d.id} pick ${d.current_pick_number}`);
      } catch (err) {
        console.error(`sweep-stalled-drafts: failed to re-arm draft ${d.id}:`, err);
      }
    }

    // A lost REMINDER (clock alive, reminder publish failed) is invisible from
    // here — we can't inspect QStash's queue. Deliberately not handled: the
    // reminder is best-effort by design; the autopick clock is the guarantee
    // this watchdog protects.
    return jsonResponse({ checked: drafts?.length ?? 0, stalled: stalled.length, rearmed, deadLettered });
  } catch (error) {
    return handleError(error, 'sweep-stalled-drafts');
  }
});
