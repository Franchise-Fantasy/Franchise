import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { notifyLeague } from '../_shared/push.ts';
import { corsResponse } from '../_shared/cors.ts';
import { checkRateLimit } from '../_shared/rate-limit.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return corsResponse();

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Auth
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('Missing authorization header');
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) throw new Error('Unauthorized');

    const rateLimited = await checkRateLimit(supabaseAdmin, user.id, 'finalize-keepers');
    if (rateLimited) return rateLimited;

    const { league_id } = await req.json();
    if (!league_id) throw new Error('league_id is required');

    // Fetch league
    const { data: league, error: leagueErr } = await supabaseAdmin
      .from('leagues')
      .select('created_by, name, season, league_type, offseason_step')
      .eq('id', league_id)
      .single();
    if (leagueErr || !league) throw new Error('League not found');
    if (league.created_by !== user.id) throw new Error('Only the commissioner can finalize keepers');
    if (league.league_type !== 'keeper') throw new Error('This action is only available for keeper leagues');
    if (league.offseason_step !== 'keeper_pending') throw new Error('League is not in the keeper declaration phase');

    // Get all kept player IDs
    const { data: declarations, error: declErr } = await supabaseAdmin
      .from('keeper_declarations')
      .select('player_id')
      .eq('league_id', league_id)
      .eq('season', league.season);
    if (declErr) throw new Error(`Failed to fetch keeper declarations: ${declErr.message}`);

    const keptPlayerIds = (declarations ?? []).map((d: any) => d.player_id);

    // Release non-kept players
    if (keptPlayerIds.length > 0) {
      await supabaseAdmin
        .from('league_players')
        .delete()
        .eq('league_id', league_id)
        .not('player_id', 'in', `(${keptPlayerIds.join(',')})`);
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
    if (updateErr) throw new Error(`Failed to update league: ${updateErr.message}`);

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

    return new Response(
      JSON.stringify({ message: 'Keepers finalized successfully', kept_count: keptPlayerIds.length }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('finalize-keepers error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});
