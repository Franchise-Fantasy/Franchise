import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { notifyLeague, notifyTeams } from '../_shared/push.ts';
import { effectiveTimeLimit } from '../_shared/draftClock.ts';
import { CORS_HEADERS } from '../_shared/cors.ts';
import { HttpError, handleError, jsonResponse } from '../_shared/http.ts';
import { checkRateLimit } from '../_shared/rate-limit.ts';
import { parseBody, z } from '../_shared/validate.ts';

const Body = z.object({
  draft_id: z.string().uuid(),
});

async function scheduleAutodraft(draft_id: string, pick_number: number, time_limit: number) {
  const token = Deno.env.get('QSTASH_TOKEN')?.trim();
  const autodraftUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/autodraft`;

  const res = await fetch(`https://qstash-us-east-1.upstash.io/v2/publish/${autodraftUrl}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Upstash-Delay': `${time_limit}s`,
    },
    body: JSON.stringify({ draft_id, pick_number }),
  });

  const responseText = await res.text();

  if (!res.ok) throw new Error(`QStash error ${res.status}: ${responseText}`);
  return responseText;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SB_SECRET_KEY') ?? ''
    );

    // Two callers: pg_cron (Bearer ${CRON_SECRET}, no user) auto-starts drafts
    // whose scheduled time has passed; user JWT calls are the fast-path when
    // someone in the room beats the cron to it. The user-JWT path used to
    // require commissioner — but once draft_date has passed, the draft is
    // going to start regardless, so any league member can kick it off.
    const authHeader = req.headers.get('Authorization') ?? '';
    const cronSecret = Deno.env.get('CRON_SECRET') ?? '';
    const isCronCall = !!cronSecret && authHeader === `Bearer ${cronSecret}`;

    let userId: string | null = null;
    if (!isCronCall) {
      const token = authHeader.startsWith('Bearer ') ? authHeader : `Bearer ${authHeader}`;
      const userClient = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SB_PUBLISHABLE_KEY') ?? '',
        { global: { headers: { Authorization: token } } }
      );

      const { data: { user } } = await userClient.auth.getUser();
      if (!user) throw new HttpError('Unauthorized', 401);
      userId = user.id;

      const rateLimited = await checkRateLimit(supabaseAdmin, user.id, 'start-draft');
      if (rateLimited) return rateLimited;
    }

    const { draft_id } = parseBody(Body, await req.json());

    const { data: draft, error: draftError } = await supabaseAdmin
      .from('drafts')
      .select('status, draft_date, time_limit, picks_per_round, accelerate_after_round, accelerated_time_limit, current_pick_number, league_id')
      .eq('id', draft_id)
      .single();

    if (draftError || !draft) throw new HttpError('Draft not found', 404);

    // An archived (soft-deleted) league must never auto-start a draft. The
    // per-minute cron is blind to archive state, so guard here at the single
    // chokepoint both the cron and user fast-path pass through.
    const { data: draftLeague } = await supabaseAdmin
      .from('leagues').select('archived_at').eq('id', draft.league_id).single();
    if (draftLeague?.archived_at) {
      return jsonResponse({ message: 'League is archived; draft will not start' });
    }

    if (draft.status === 'in_progress') {
      return jsonResponse({ message: 'Draft already in progress' });
    }

    if (draft.status !== 'pending') {
      throw new HttpError(`Draft cannot be started from status: ${draft.status}`);
    }

    if (new Date(draft.draft_date).getTime() > Date.now()) {
      throw new HttpError('Draft has not reached its scheduled start time');
    }

    const { data: league } = await supabaseAdmin
      .from('leagues')
      .select('name')
      .eq('id', draft.league_id)
      .single();

    if (!league) throw new HttpError('League not found', 404);

    // For user-JWT calls, require league membership (any team in the league).
    // Cron-triggered calls bypass this — the scheduler is the authority once
    // draft_date has passed. We deliberately removed the old commissioner-only
    // gate here: the time check above is what governs whether a draft can be
    // started, not who's calling.
    if (!isCronCall) {
      const { data: membership } = await supabaseAdmin
        .from('teams')
        .select('id')
        .eq('league_id', draft.league_id)
        .eq('user_id', userId!)
        .maybeSingle();
      if (!membership) throw new HttpError('Not a league member', 403);
    }

    const now = new Date().toISOString();

    // Acceleration normally kicks in in later rounds, so pick #1 is the base
    // clock — but compute it the same way every other pick does so the rules
    // live in exactly one place.
    const firstLimit = effectiveTimeLimit(draft.current_pick_number, draft);

    // Conditional UPDATE atomically transitions pending→in_progress. If a
    // concurrent caller (e.g. cron and client racing) already won the
    // transition, this matches 0 rows — return early so we don't schedule a
    // duplicate QStash job for pick #1.
    const { data: updated, error: updateError } = await supabaseAdmin
      .from('drafts')
      .update({ status: 'in_progress', current_pick_timestamp: now, current_pick_time_limit: firstLimit })
      .eq('id', draft_id)
      .eq('status', 'pending')
      .select('id');

    if (updateError) throw updateError;
    if (!updated || updated.length === 0) {
      return jsonResponse({ message: 'Draft already starting' });
    }

    const qstashResult = await scheduleAutodraft(draft_id, draft.current_pick_number, firstLimit);

    // Notify all league members that draft started
    try {
      const ln = league?.name ?? 'Your League';

      await notifyLeague(supabaseAdmin, draft.league_id, 'draft',
        `${ln} — Draft Started!`,
        'The draft is live. Head to the draft room.',
        { screen: 'draft-room', draft_id }
      );

      // Also notify the first picker specifically
      const { data: firstPick } = await supabaseAdmin
        .from('draft_picks')
        .select('current_team_id')
        .eq('draft_id', draft_id)
        .eq('pick_number', draft.current_pick_number)
        .single();

      if (firstPick) {
        await notifyTeams(supabaseAdmin, [firstPick.current_team_id], 'draft',
          `${ln} — Your turn to pick!`,
          'You\'re on the clock. Make your first pick.',
          { screen: 'draft-room', draft_id }
        );
      }
    } catch (notifyErr) {
      console.warn('Push notification failed (non-fatal):', notifyErr);
    }

    return jsonResponse({ message: 'Draft started', qstash: qstashResult });
  } catch (error) {
    return handleError(error, 'start-draft');
  }
});
