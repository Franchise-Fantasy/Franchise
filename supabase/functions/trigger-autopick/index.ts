import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsResponse } from '../_shared/cors.ts';
import { checkRateLimit } from '../_shared/rate-limit.ts';

/**
 * Trigger an immediate autopick for the calling user's team.
 * Called when a user toggles autopick ON while it's their turn.
 * Publishes to QStash with a 1s delay — the autodraft function
 * is idempotent so duplicate/stale triggers are harmless.
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return corsResponse();

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    // Authenticate caller
    const authHeader = req.headers.get('Authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader : `Bearer ${authHeader}`;
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: token ?? '' } } },
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) throw new Error('Unauthorized');

    const rateLimited = await checkRateLimit(supabaseAdmin, user.id, 'trigger-autopick');
    if (rateLimited) return rateLimited;

    const { draft_id } = await req.json();
    if (!draft_id) throw new Error('draft_id is required');

    // Fetch draft state
    const { data: draft, error: draftError } = await supabaseAdmin
      .from('drafts')
      .select('current_pick_number, status, league_id')
      .eq('id', draft_id)
      .single();
    if (draftError || !draft) throw new Error('Draft not found');
    if (draft.status !== 'in_progress') {
      return new Response(JSON.stringify({ message: 'Draft not in progress' }), { status: 200 });
    }

    // Verify the caller owns the team currently on the clock
    const { data: currentPick } = await supabaseAdmin
      .from('draft_picks')
      .select('current_team_id')
      .eq('draft_id', draft_id)
      .eq('pick_number', draft.current_pick_number)
      .single();
    if (!currentPick) throw new Error('Current pick not found');

    const { data: team } = await supabaseAdmin
      .from('teams')
      .select('id')
      .eq('id', currentPick.current_team_id)
      .eq('user_id', user.id)
      .single();
    if (!team) throw new Error('Not your turn');

    // Schedule immediate autopick via QStash
    const autodraftUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/autodraft`;
    const res = await fetch(`https://qstash-us-east-1.upstash.io/v2/publish/${autodraftUrl}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('QSTASH_TOKEN')?.trim()}`,
        'Content-Type': 'application/json',
        'Upstash-Delay': '1s',
      },
      body: JSON.stringify({ draft_id, pick_number: draft.current_pick_number, autopick_triggered: true }),
    });
    if (!res.ok) throw new Error(`QStash error: ${await res.text()}`);

    return new Response(JSON.stringify({ message: 'Autopick triggered' }), { status: 200 });
  } catch (error) {
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 400 });
  }
});
