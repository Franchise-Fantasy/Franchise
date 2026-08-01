import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { notifyLeague } from '../_shared/push.ts';
import { corsResponse } from '../_shared/cors.ts';
import { requireUser } from '../_shared/auth.ts';
import { HttpError, handleError, jsonResponse } from '../_shared/http.ts';
import { kickOpenDraftSeason } from '../_shared/openDraftSeason.ts';
import { checkRateLimit } from '../_shared/rate-limit.ts';
import { parseBody, z } from '../_shared/validate.ts';

const Body = z.object({
  league_id: z.string().uuid(),
});

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return corsResponse();

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SB_SECRET_KEY') ?? ''
    );

    // Auth
    const user = await requireUser(req);

    const rateLimited = await checkRateLimit(supabaseAdmin, user.id, 'finalize-keepers');
    if (rateLimited) return rateLimited;

    const { league_id } = parseBody(Body, await req.json());

    // Fetch league
    const { data: league, error: leagueErr } = await supabaseAdmin
      .from('leagues')
      .select('created_by, name, season, league_type, offseason_step')
      .eq('id', league_id)
      .single();
    if (leagueErr || !league) throw new HttpError('League not found', 404);
    if (league.created_by !== user.id) throw new HttpError('Only the commissioner can finalize keepers', 403);
    if (league.league_type !== 'keeper') throw new HttpError('This action is only available for keeper leagues');
    if (league.offseason_step !== 'keeper_pending') throw new HttpError('League is not in the keeper declaration phase');

    // Release non-kept players, clear this season's declarations, and advance
    // the offseason step in ONE transaction. Running these as three separate
    // writes risked an unrecoverable wipe: if the declarations delete landed
    // but the step advance failed, a commissioner retry saw zero keepers and
    // released the entire league. See finalize_keepers_atomic.
    // Keepers are declared during the dormant offseason — you're keeping
    // players you already have, so it needs no rookie class. The DRAFT that
    // fills the rest of the roster still does, so finalizing drops the league
    // back to 'offseason' and open-draft-season decides when it opens.
    const { data: result, error: rpcErr } = await supabaseAdmin.rpc('finalize_keepers_atomic', {
      p_league_id: league_id,
      p_season: league.season,
      p_next_step: 'offseason',
    });
    if (rpcErr) throw rpcErr;

    const keptCount = (result as { kept_count: number } | null)?.kept_count ?? 0;

    // A keeper league that finalizes after its gate has already passed should
    // land straight in draft season rather than waiting for tomorrow's sweep.
    // Awaited because it decides the step the client renders on return; a
    // failure is non-fatal since the daily sweep opens the league anyway.
    try {
      await kickOpenDraftSeason(league_id);
    } catch (openErr) {
      console.warn('open-draft-season kick failed (non-fatal):', openErr);
    }

    // Notify league
    try {
      await notifyLeague(
        supabaseAdmin,
        league_id,
        'league_activity',
        `${league.name ?? 'Your League'} — Keepers Finalized`,
        'Keepers have been locked in. Non-kept players are now free agents.',
        { screen: 'home' }
      );
    } catch (notifyErr) {
      console.warn('Push notification failed (non-fatal):', notifyErr);
    }

    return jsonResponse({ message: 'Keepers finalized successfully', kept_count: keptCount });
  } catch (error) {
    return handleError(error, 'finalize-keepers');
  }
});
