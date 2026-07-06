import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsResponse } from '../_shared/cors.ts';
import { effectiveTimeLimit } from '../_shared/draftClock.ts';
import { HttpError, handleError, jsonResponse } from '../_shared/http.ts';
import { scheduleAutodraft, schedulePickReminder } from '../_shared/qstash.ts';
import { checkRateLimit } from '../_shared/rate-limit.ts';
import { parseBody, z } from '../_shared/validate.ts';

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

    const authHeader = req.headers.get('Authorization') ?? '';
    const token = authHeader.startsWith('Bearer ') ? authHeader : `Bearer ${authHeader}`;
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SB_PUBLISHABLE_KEY') ?? '',
      { global: { headers: { Authorization: token } } },
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) throw new HttpError('Unauthorized', 401);

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
      .select('created_by')
      .eq('id', draft.league_id)
      .single();
    if (!league || league.created_by !== user.id) {
      throw new HttpError('Only the commissioner can resume the draft.', 403);
    }

    if (draft.status !== 'paused') {
      throw new HttpError(`Draft is not paused (status: ${draft.status}).`, 409);
    }

    // Restore the clock. If an in-flight autodraft advanced the pick AFTER the
    // pause was recorded (a pause that raced a firing autopick), the snapshot is
    // for a pick that's already done — current_pick_timestamp will be newer than
    // paused_at. In that case give the now-current pick a fresh full clock
    // rather than the dead pick's leftover time. Otherwise continue from the
    // snapshot (at least 1s so QStash always re-arms).
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
      .eq('draft_id', draft_id)
      .eq('pick_number', draft.current_pick_number)
      .maybeSingle();
    if (onClockPick) {
      const { data: teamStatus } = await supabaseAdmin
        .from('draft_team_status')
        .select('autopick_on')
        .eq('draft_id', draft_id)
        .eq('team_id', onClockPick.current_team_id)
        .maybeSingle();
      if (teamStatus?.autopick_on) {
        delay = 1;
        autopickTriggered = true;
      }
    }

    // Arm the fresh QStash timer BEFORE flipping status, so resume is
    // all-or-nothing: if this throws, the draft stays paused and the
    // commissioner just retries — there is never an in_progress draft with no
    // clock. (QStash's min delay is 1s and the flip below is sub-millisecond, so
    // the timer can't fire before the flip. If the flip itself then fails, the
    // armed timer harmlessly no-ops via the autodraft pause guard.)
    await scheduleAutodraft(draft_id, draft.current_pick_number, delay, autopickTriggered);
    // Slow drafts: re-arm the reminder against the restored remaining clock
    // (only fires when the remainder itself is still slow-scale).
    if (!autopickTriggered) {
      await schedulePickReminder(draft_id, draft.current_pick_number, remainingSeconds);
    }

    const now = new Date().toISOString();
    // Atomic transition — only resume a draft that is still paused.
    const { data: updated, error: updateError } = await supabaseAdmin
      .from('drafts')
      .update({
        status: 'in_progress',
        current_pick_timestamp: now,
        current_pick_time_limit: remainingSeconds,
        paused_at: null,
        paused_remaining_ms: null,
      })
      .eq('id', draft_id)
      .eq('status', 'paused')
      .select('id');
    if (updateError) throw updateError;
    if (!updated || updated.length === 0) {
      throw new HttpError('Draft is no longer paused.', 409);
    }

    return jsonResponse({ message: 'Draft resumed', resumed_with_seconds: remainingSeconds });
  } catch (error) {
    return handleError(error, 'resume-draft');
  }
});
