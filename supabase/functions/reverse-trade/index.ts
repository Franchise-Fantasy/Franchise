import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsResponse } from '../_shared/cors.ts';
import { requireUser } from '../_shared/auth.ts';
import { HttpError, handleError, jsonResponse } from '../_shared/http.ts';
import { notifyTeams } from '../_shared/push.ts';
import { checkRateLimit } from '../_shared/rate-limit.ts';
import { parseBody, z } from '../_shared/validate.ts';

const Body = z.object({
  proposal_id: z.string().uuid(),
});

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return corsResponse();

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SB_SECRET_KEY') ?? ''
    );

    const user = await requireUser(req);

    const rateLimited = await checkRateLimit(supabaseAdmin, user.id, 'reverse-trade');
    if (rateLimited) return rateLimited;

    const { proposal_id } = parseBody(Body, await req.json());

    const { data: proposal, error: proposalError } = await supabaseAdmin
      .from('trade_proposals').select('*').eq('id', proposal_id).single();
    if (proposalError || !proposal) throw new HttpError('Trade proposal not found.', 404);
    if (proposal.status !== 'completed') {
      throw new HttpError(`Can only reverse completed trades. Current status: ${proposal.status}`);
    }

    const { data: league } = await supabaseAdmin
      .from('leagues').select('created_by, name').eq('id', proposal.league_id).single();
    if (league?.created_by !== user.id) {
      throw new HttpError('Only the commissioner can reverse trades.', 403);
    }

    // Every transfer, the pick-swap cleanup, the ledger, and the status flip to
    // 'reversed' commit together. Previously each was its own write, and a
    // failure part-way through left the trade HALF-reversed while still marked
    // 'completed' — and the retry made that permanent, because the per-player
    // step skips anyone "no longer on the receiving team", which is exactly what
    // the already-reversed players looked like.
    const { data: result, error: reverseError } = await supabaseAdmin.rpc('reverse_trade_transfers', {
      p_proposal_id: proposal_id,
    });
    if (reverseError) {
      if (reverseError.code === '23505') {
        throw new HttpError('This trade has already been reversed.', 409);
      }
      throw reverseError;
    }

    const warnings: string[] = result?.warnings ?? [];
    const allTeamIds: string[] = result?.team_ids ?? [];
    const notes = `Commissioner reversed trade` +
      (warnings.length > 0 ? ` (${warnings.length} item(s) skipped)` : '');

    // Notify all teams involved
    try {
      const ln = league?.name ?? 'Your League';
      await notifyTeams(supabaseAdmin, allTeamIds, 'commissioner',
        `${ln} — Trade Reversed`,
        notes,
        { screen: 'trades' }
      );
    } catch (notifyErr) {
      console.warn('Push notification failed (non-fatal):', notifyErr);
    }

    return jsonResponse({ message: 'Trade reversed successfully.', warnings });
  } catch (error) {
    return handleError(error, 'reverse-trade');
  }
});
