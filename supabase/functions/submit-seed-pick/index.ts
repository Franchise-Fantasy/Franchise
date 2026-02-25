import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { notifyTeams } from './push.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const authHeader = req.headers.get('Authorization');
    const token = authHeader?.replace('Bearer ', '');
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: `Bearer ${token}` } } }
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: 'Unauthorized' }, 401);

    const { league_id, round, opponent_team_id } = await req.json();
    if (!league_id || !round || !opponent_team_id) {
      return json({ error: 'league_id, round, and opponent_team_id required' }, 400);
    }

    const { data: myTeam } = await supabase
      .from('teams').select('id').eq('league_id', league_id).eq('user_id', user.id).single();
    if (!myTeam) return json({ error: 'Team not found in league' }, 403);

    const { data: myPick } = await supabase
      .from('playoff_seed_picks').select('id, picking_seed')
      .eq('league_id', league_id).eq('round', round)
      .eq('picking_team_id', myTeam.id).is('picked_opponent_id', null).single();
    if (!myPick) return json({ error: 'No pending pick found for your team' }, 400);

    const { data: higherPicks } = await supabase
      .from('playoff_seed_picks').select('picking_seed, picked_opponent_id')
      .eq('league_id', league_id).eq('round', round)
      .lt('picking_seed', myPick.picking_seed);

    const allHigherDone = (higherPicks ?? []).every((p: any) => p.picked_opponent_id !== null);
    if (!allHigherDone) return json({ error: 'Not your turn yet \u2014 higher seeds must pick first' }, 400);

    const { data: takenPicks } = await supabase
      .from('playoff_seed_picks').select('picked_opponent_id')
      .eq('league_id', league_id).eq('round', round)
      .not('picked_opponent_id', 'is', null);

    const takenIds = new Set((takenPicks ?? []).map((p: any) => p.picked_opponent_id));
    if (takenIds.has(opponent_team_id)) {
      return json({ error: 'That opponent has already been picked by another team' }, 400);
    }

    const { error: updateErr } = await supabase
      .from('playoff_seed_picks')
      .update({ picked_opponent_id: opponent_team_id, picked_at: new Date().toISOString() })
      .eq('id', myPick.id);
    if (updateErr) return json({ error: 'Failed to save pick', detail: updateErr }, 500);

    const { data: remaining } = await supabase
      .from('playoff_seed_picks').select('id')
      .eq('league_id', league_id).eq('round', round)
      .is('picked_opponent_id', null);

    if (remaining && remaining.length === 0) {
      const url = `${Deno.env.get('SUPABASE_URL')}/functions/v1/generate-playoff-round`;
      await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
        },
        body: JSON.stringify({ league_id, round, from_seed_picks: true }),
      });
      return json({ success: true, all_picks_complete: true });
    }

    // Notify the next seed picker
    try {
      const { data: nextPick } = await supabase
        .from('playoff_seed_picks')
        .select('picking_team_id, picking_seed')
        .eq('league_id', league_id).eq('round', round)
        .is('picked_opponent_id', null)
        .order('picking_seed', { ascending: true })
        .limit(1)
        .maybeSingle();

      if (nextPick) {
        await notifyTeams(supabase, [nextPick.picking_team_id], 'playoffs',
          'Your Turn to Pick',
          `Seed #${nextPick.picking_seed}, choose your playoff opponent.`,
          { screen: 'playoff-bracket' }
        );
      }
    } catch (notifyErr) {
      console.warn('Push notification failed (non-fatal):', notifyErr);
    }

    return json({ success: true, all_picks_complete: false });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
