import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { notifyTeams, notifyLeague } from './push.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Verify the caller's JWT
    const authHeader = req.headers.get('Authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader : `Bearer ${authHeader}`;
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: token ?? '' } } },
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { league_id, team_ids, category, title, body, data } = await req.json();
    if (!league_id || !category || !title || !body) {
      return new Response(JSON.stringify({ error: 'league_id, category, title, and body are required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Verify caller is a member of this league
    const { data: callerTeam } = await supabaseAdmin
      .from('teams')
      .select('id')
      .eq('league_id', league_id)
      .eq('user_id', user.id)
      .single();

    if (!callerTeam) {
      return new Response(JSON.stringify({ error: 'Not a member of this league' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Send to specific teams or entire league
    if (team_ids && Array.isArray(team_ids) && team_ids.length > 0) {
      await notifyTeams(supabaseAdmin, team_ids, category, title, body, data);
    } else {
      await notifyLeague(supabaseAdmin, league_id, category, title, body, data);
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('send-notification error:', err);
    return new Response(JSON.stringify({ error: err?.message ?? String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
