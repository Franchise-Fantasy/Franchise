import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsResponse } from '../_shared/cors.ts';
import { HttpError, handleError, jsonResponse } from '../_shared/http.ts';
import { checkRateLimit } from '../_shared/rate-limit.ts';
import { parseBody, z } from '../_shared/validate.ts';

const Body = z.object({
  draft_id: z.string().uuid(),
});

// Commissioner pauses a live draft. The pick clock is a QStash delayed message
// that can't be cancelled, so we flip the draft to status='paused' (the
// in-flight autodraft no-ops on that) and snapshot how many ms were left on the
// on-the-clock pick. resume-draft restores that snapshot.
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

    const rateLimited = await checkRateLimit(supabaseAdmin, user.id, 'pause-draft');
    if (rateLimited) return rateLimited;

    const { draft_id } = parseBody(Body, await req.json());

    const { data: draft, error: draftError } = await supabaseAdmin
      .from('drafts')
      .select('status, current_pick_timestamp, current_pick_time_limit, time_limit, league_id')
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
      throw new HttpError('Only the commissioner can pause the draft.', 403);
    }

    if (draft.status !== 'in_progress') {
      throw new HttpError(`Draft cannot be paused from status: ${draft.status}`, 409);
    }

    // Remaining ms on the current pick = its clock minus elapsed since it started.
    const limitSeconds = draft.current_pick_time_limit ?? draft.time_limit;
    const startedAt = draft.current_pick_timestamp
      ? new Date(draft.current_pick_timestamp).getTime()
      : Date.now();
    const remainingMs = Math.max(0, limitSeconds * 1000 - (Date.now() - startedAt));

    // Atomic transition — only pause a draft that is still in_progress, so two
    // commissioners (or a double-tap) can't both win.
    const { data: updated, error: updateError } = await supabaseAdmin
      .from('drafts')
      .update({
        status: 'paused',
        paused_at: new Date().toISOString(),
        paused_remaining_ms: remainingMs,
      })
      .eq('id', draft_id)
      .eq('status', 'in_progress')
      .select('id');
    if (updateError) throw updateError;
    if (!updated || updated.length === 0) {
      throw new HttpError('Draft is no longer in progress.', 409);
    }

    return jsonResponse({ message: 'Draft paused', remaining_ms: remainingMs });
  } catch (error) {
    return handleError(error, 'pause-draft');
  }
});
