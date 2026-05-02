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
      Deno.env.get('SB_SECRET_KEY') ?? ''
    );

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('Missing authorization header');
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SB_PUBLISHABLE_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) throw new Error('Unauthorized');

    const rateLimited = await checkRateLimit(supabaseAdmin, user.id, 'create-rookie-draft');
    if (rateLimited) return rateLimited;

    const { league_id } = await req.json();
    if (!league_id) throw new Error('league_id is required');

    const { data: league, error: leagueErr } = await supabaseAdmin
      .from('leagues')
      .select('created_by, name, season, teams, current_teams, rookie_draft_rounds, offseason_step')
      .eq('id', league_id)
      .single();
    if (leagueErr || !league) throw new Error('League not found');
    if (league.created_by !== user.id) throw new Error('Only the commissioner can create a rookie draft');

    // Validate offseason state. `lottery_revealing` is accepted because the
    // lottery-room "Done" button now bundles the ceremony close + draft
    // creation into a single click, skipping the intermediate
    // `lottery_complete` state.
    const validSteps = ['lottery_revealing', 'lottery_complete', 'rookie_draft_pending'];
    if (!validSteps.includes(league.offseason_step ?? '')) {
      throw new Error(`Cannot create rookie draft in current state: ${league.offseason_step}`);
    }

    // Idempotent: if a rookie draft already exists for this season, reuse it
    // and just make sure offseason_step is advanced. Lets the lottery-room
    // "Done" button be safely re-tapped without erroring on a leftover draft
    // from a prior run.
    const { data: existingDraft } = await supabaseAdmin
      .from('drafts')
      .select('id')
      .eq('league_id', league_id)
      .eq('season', league.season)
      .eq('type', 'rookie')
      .limit(1)
      .maybeSingle();

    let draftId: string;
    let createdNew = false;

    if (existingDraft) {
      draftId = existingDraft.id;
    } else {
      const numTeams = league.current_teams ?? league.teams;
      const rounds = league.rookie_draft_rounds ?? 2;

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
      draftId = draft.id;
      createdNew = true;

      // Link existing future draft_picks to this draft
      const { error: linkErr } = await supabaseAdmin
        .from('draft_picks')
        .update({ draft_id: draftId })
        .eq('league_id', league_id)
        .eq('season', league.season)
        .is('draft_id', null);
      if (linkErr) throw new Error(`Failed to link draft picks: ${linkErr.message}`);
    }

    // Advance offseason step if it isn't already past creation. Idempotent —
    // safe whether we just created the draft or reused an existing one.
    if (league.offseason_step !== 'rookie_draft_pending' && league.offseason_step !== 'rookie_draft_complete') {
      await supabaseAdmin
        .from('leagues')
        .update({ offseason_step: 'rookie_draft_pending' })
        .eq('id', league_id);
    }

    // Notify league only on actual creation
    if (createdNew) {
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
    }

    return new Response(
      JSON.stringify({
        message: createdNew ? 'Rookie draft created' : 'Rookie draft already exists',
        draft_id: draftId,
        created: createdNew,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    // Surface the real error message so clients (and supabase logs) can see
    // *why* it failed, rather than a generic 'Internal server error'.
    console.error('create-rookie-draft error:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});
