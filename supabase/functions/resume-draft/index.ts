import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { deferWork } from '../_shared/background.ts';
import { corsResponse } from '../_shared/cors.ts';
import { notifyOnClockAfterResume, rearmPausedDraft } from '../_shared/draftResume.ts';
import { requireUser } from '../_shared/auth.ts';
import { HttpError, handleError, jsonResponse } from '../_shared/http.ts';
import { notifyLeague } from '../_shared/push.ts';
import { checkRateLimit } from '../_shared/rate-limit.ts';
import { parseBody, z } from '../_shared/validate.ts';
import { formatPickClock, isSlowClock } from '../../../utils/draft/pickClock.ts';

const Body = z.object({
  draft_id: z.string().uuid(),
});

// Commissioner resumes a paused draft: restore the snapshotted remaining clock,
// flip back to in_progress, and publish a fresh autodraft timer. If the team on
// the clock has autopick on, fire its pick immediately (delay 1s).
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return corsResponse();

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SB_SECRET_KEY') ?? '',
    );

    const user = await requireUser(req);

    const rateLimited = await checkRateLimit(supabaseAdmin, user.id, 'resume-draft');
    if (rateLimited) return rateLimited;

    const { draft_id } = parseBody(Body, await req.json());

    const { data: draft, error: draftError } = await supabaseAdmin
      .from('drafts')
      .select('status, current_pick_number, current_pick_timestamp, paused_at, paused_remaining_ms, time_limit, picks_per_round, accelerate_after_round, accelerated_time_limit, league_id')
      .eq('id', draft_id)
      .single();
    if (draftError || !draft) throw new HttpError('Draft not found.', 404);

    // Commissioner-only.
    const { data: league } = await supabaseAdmin
      .from('leagues')
      .select('created_by, name')
      .eq('id', draft.league_id)
      .single();
    if (!league || league.created_by !== user.id) {
      throw new HttpError('Only the commissioner can resume the draft.', 403);
    }

    if (draft.status !== 'paused') {
      throw new HttpError(`Draft is not paused (status: ${draft.status}).`, 409);
    }

    // Restore the clock + flip back to in_progress (arms QStash before the flip
    // for all-or-nothing semantics). A commissioner can resume any pause,
    // including a quiet-hours freeze — no extraMatch guard. Note: if this is
    // still inside the quiet window, the manage-draft-quiet-hours cron will
    // re-freeze within ~5 min; that's the documented v1 behavior.
    const result = await rearmPausedDraft(supabaseAdmin, {
      id: draft_id,
      current_pick_number: draft.current_pick_number,
      current_pick_timestamp: draft.current_pick_timestamp,
      paused_at: draft.paused_at,
      paused_remaining_ms: draft.paused_remaining_ms,
      time_limit: draft.time_limit,
      picks_per_round: draft.picks_per_round,
      accelerate_after_round: draft.accelerate_after_round,
      accelerated_time_limit: draft.accelerated_time_limit,
    });
    if (!result.resumed) {
      throw new HttpError('Draft is no longer paused.', 409);
    }

    // The pause pushed to the whole league, so the resume has to as well —
    // otherwise managers who backed out of a paused draft never learn the clock
    // restarted. The GM now on the clock gets the actionable second push (same
    // league-wide + on-clock pairing start-draft uses).
    const leagueName = league.name ?? 'Your League';
    const { remainingSeconds } = result;
    deferWork((async () => {
      await notifyLeague(supabaseAdmin, draft.league_id, 'draft',
        `${leagueName} — Draft Resumed`,
        'The commissioner resumed the draft. The clock is running again.',
        { screen: 'draft-room', draft_id },
        [user.id],
      );
      await notifyOnClockAfterResume(supabaseAdmin, draft_id, result,
        `${leagueName} — You're on the clock!`,
        // Slowness is a property of the draft's clock setting; the amount left
        // is what's restored from the pause snapshot.
        isSlowClock(draft.time_limit)
          ? `The draft is back on — you have ${formatPickClock(remainingSeconds)} to pick.`
          : 'The draft is back on. Make your pick.',
      );
    })(), 'resume-draft notify');

    return jsonResponse({ message: 'Draft resumed', resumed_with_seconds: remainingSeconds });
  } catch (error) {
    return handleError(error, 'resume-draft');
  }
});
