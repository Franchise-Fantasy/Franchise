import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { notifyLeague } from '../_shared/push.ts';
import { corsResponse } from '../_shared/cors.ts';
import { HttpError, handleError, jsonResponse } from '../_shared/http.ts';
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
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new HttpError('Missing authorization header', 401);
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SB_PUBLISHABLE_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) throw new HttpError('Unauthorized', 401);

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

    // Get all kept player IDs
    const { data: declarations, error: declErr } = await supabaseAdmin
      .from('keeper_declarations')
      .select('player_id')
      .eq('league_id', league_id)
      .eq('season', league.season);
    if (declErr) throw declErr;

    const keptPlayerIds = (declarations ?? []).map((d: any) => d.player_id);

    // Release non-kept players
    if (keptPlayerIds.length > 0) {
      await supabaseAdmin
        .from('league_players')
        .delete()
        .eq('league_id', league_id)
        .not('player_id', 'in', `(${keptPlayerIds.map((id: string) => `"${id}"`).join(',')})`);
    } else {
      // No keepers declared — release everyone
      await supabaseAdmin
        .from('league_players')
        .delete()
        .eq('league_id', league_id);
    }

    // Clean up declarations for this season
    await supabaseAdmin
      .from('keeper_declarations')
      .delete()
      .eq('league_id', league_id)
      .eq('season', league.season);

    // Advance offseason step
    const { error: updateErr } = await supabaseAdmin
      .from('leagues')
      .update({ offseason_step: 'ready_for_new_season' })
      .eq('id', league_id);
    if (updateErr) throw updateErr;

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

    return jsonResponse({ message: 'Keepers finalized successfully', kept_count: keptPlayerIds.length });
  } catch (error) {
    return handleError(error, 'finalize-keepers');
  }
});
