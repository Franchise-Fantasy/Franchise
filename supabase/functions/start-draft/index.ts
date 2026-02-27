import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { notifyLeague, notifyTeams } from './push.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function scheduleAutodraft(draft_id: string, pick_number: number, time_limit: number) {
  const token = Deno.env.get('QSTASH_TOKEN')?.trim();
  const autodraftUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/autodraft`;

  console.log('Publishing to:', `https://qstash.upstash.io/v2/publish/${autodraftUrl}`);

  const res = await fetch(`https://qstash-us-east-1.upstash.io/v2/publish/${autodraftUrl}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Upstash-Delay': `${time_limit}s`,
    },
    body: JSON.stringify({ draft_id, pick_number }),
  });

  console.log('sending to qstash')
  const responseText = await res.text();
  console.log('QStash status:', res.status, '| body:', responseText);

  if (!res.ok) throw new Error(`QStash error ${res.status}: ${responseText}`);
  return responseText;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const authHeader = req.headers.get('Authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader : `Bearer ${authHeader}`;
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: token ?? '' } } }
    );

    const { data: { user } } = await userClient.auth.getUser();
    if (!user) throw new Error('Unauthorized');

    const { draft_id } = await req.json();

    const { data: draft, error: draftError } = await supabaseAdmin
      .from('drafts')
      .select('status, draft_date, time_limit, current_pick_number, league_id')
      .eq('id', draft_id)
      .single();

    if (draftError || !draft) throw new Error('Draft not found');

    if (draft.status === 'in_progress') {
      return new Response(JSON.stringify({ message: 'Draft already in progress' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (draft.status !== 'pending') {
      throw new Error(`Draft cannot be started from status: ${draft.status}`);
    }

    if (new Date(draft.draft_date).getTime() > Date.now()) {
      throw new Error('Draft has not reached its scheduled start time');
    }

    // Verify user is commissioner of this league
    const { data: league } = await supabaseAdmin
      .from('leagues')
      .select('created_by, name')
      .eq('id', draft.league_id)
      .single();

    if (!league || league.created_by !== user.id) {
      throw new Error('Only the commissioner can start the draft');
    }

    const now = new Date().toISOString();

    const { error: updateError } = await supabaseAdmin
      .from('drafts')
      .update({ status: 'in_progress', current_pick_timestamp: now })
      .eq('id', draft_id)
      .eq('status', 'pending');

    if (updateError) throw updateError;

    const qstashResult = await scheduleAutodraft(draft_id, draft.current_pick_number, draft.time_limit);

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

    return new Response(JSON.stringify({ message: 'Draft started', qstash: qstashResult }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('start-draft error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
