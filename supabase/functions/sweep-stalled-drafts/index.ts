import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getArchivedLeagueIds } from '../_shared/archivedLeagues.ts';
import { handleError, jsonResponse, errorResponse } from '../_shared/http.ts';
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
 */

// Past-deadline slack before we declare the chain dead. Covers QStash's normal
// delivery latency (~0.5–1.5s) plus retry backoff on transient 5xx.
const GRACE_MS = 120_000;

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
    });

    let rearmed = 0;
    for (const d of stalled) {
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
    return jsonResponse({ checked: drafts?.length ?? 0, stalled: stalled.length, rearmed });
  } catch (error) {
    return handleError(error, 'sweep-stalled-drafts');
  }
});
