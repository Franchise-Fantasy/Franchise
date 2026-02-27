import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { notifyLeague } from './push.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      },
    });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('Missing authorization header');
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) throw new Error('Unauthorized');

    const { league_id } = await req.json();
    if (!league_id) throw new Error('league_id is required');

    const { data: league, error: leagueErr } = await supabaseAdmin
      .from('leagues')
      .select('created_by, name, season, teams, current_teams, rookie_draft_rounds, offseason_step')
      .eq('id', league_id)
      .single();
    if (leagueErr || !league) throw new Error('League not found');
    if (league.created_by !== user.id) throw new Error('Only the commissioner can create a rookie draft');

    // Validate offseason state
    const validSteps = ['lottery_complete', 'rookie_draft_pending'];
    if (!validSteps.includes(league.offseason_step ?? '')) {
      throw new Error(`Cannot create rookie draft in current state: ${league.offseason_step}`);
    }

    // Check if a rookie draft already exists for this season
    const { data: existingDraft } = await supabaseAdmin
      .from('drafts')
      .select('id')
      .eq('league_id', league_id)
      .eq('season', league.season)
      .eq('type', 'rookie')
      .limit(1);

    if (existingDraft && existingDraft.length > 0) {
      throw new Error('A rookie draft already exists for this season');
    }

    const numTeams = league.current_teams ?? league.teams;
    const rounds = league.rookie_draft_rounds ?? 2;

    // Create the drafts row
    const { data: draft, error: draftErr } = await supabaseAdmin
      .from('drafts')
      .insert({
        league_id,
        season: league.season,
        type: 'rookie',
        status: 'unscheduled',
        rounds,
        picks_per_round: numTeams,
        time_limit: 120,
        draft_type: 'linear',
        current_pick_number: 1,
      })
      .select('id')
      .single();
    if (draftErr || !draft) throw new Error(`Failed to create draft: ${draftErr?.message}`);

    // Link existing future draft_picks to this draft
    const { error: linkErr } = await supabaseAdmin
      .from('draft_picks')
      .update({ draft_id: draft.id })
      .eq('league_id', league_id)
      .eq('season', league.season)
      .is('draft_id', null);
    if (linkErr) throw new Error(`Failed to link draft picks: ${linkErr.message}`);

    // Update offseason step
    await supabaseAdmin
      .from('leagues')
      .update({ offseason_step: 'rookie_draft_pending' })
      .eq('id', league_id);

    // Notify league
    try {
      const ln = league.name ?? 'Your League';
      await notifyLeague(supabaseAdmin, league_id, 'draft',
        `${ln} — Rookie Draft Created`,
        'The rookie draft has been set up. The commissioner will schedule the date soon.',
        { screen: 'home' }
      );
    } catch (notifyErr) {
      console.warn('Push notification failed (non-fatal):', notifyErr);
    }

    return new Response(
      JSON.stringify({ message: 'Rookie draft created', draft_id: draft.id }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('create-rookie-draft error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});
