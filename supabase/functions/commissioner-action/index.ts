import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { notifyTeams } from '../_shared/push.ts';
import { corsResponse } from '../_shared/cors.ts';
import { checkRateLimit } from '../_shared/rate-limit.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return corsResponse();

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

    const rateLimited = await checkRateLimit(supabaseAdmin, user.id, 'commissioner-action');
    if (rateLimited) return rateLimited;

    const { action, league_id, team_id, player_id, position, target_slot } = await req.json();
    if (!action || !league_id || !team_id || !player_id) {
      throw new Error('action, league_id, team_id, and player_id are required');
    }

    const validActions = ['force_add', 'force_drop', 'force_move'];
    if (!validActions.includes(action)) {
      throw new Error(`Unknown action: ${action}. Must be one of: ${validActions.join(', ')}`);
    }

    const { data: league } = await supabaseAdmin
      .from('leagues')
      .select('created_by, name')
      .eq('id', league_id)
      .single();
    if (league?.created_by !== user.id) {
      throw new Error('Only the commissioner can perform this action.');
    }

    const { data: player } = await supabaseAdmin.from('players').select('name').eq('id', player_id).single();
    const { data: team } = await supabaseAdmin.from('teams').select('name, league_id').eq('id', team_id).single();
    if (!team || team.league_id !== league_id) {
      throw new Error('Team does not belong to this league.');
    }
    const playerName = player?.name ?? 'Unknown';
    const teamName = team?.name ?? 'Unknown';

    const timestamp = new Date().toISOString();
    let notes = '';
    let txnItemFrom: string | null = null;
    let txnItemTo: string | null = null;

    if (action === 'force_add') {
      if (!position) throw new Error('position is required for force_add');
      const { error } = await supabaseAdmin.from('league_players').insert({
        league_id, team_id, player_id, position, roster_slot: 'BE',
        acquired_via: 'commissioner', acquired_at: timestamp,
      });
      if (error) throw new Error(`Failed to add player: ${error.message}`);
      notes = `Commissioner added ${playerName} to ${teamName}`;
      txnItemTo = team_id;

    } else if (action === 'force_drop') {
      const { error } = await supabaseAdmin.from('league_players').delete()
        .eq('league_id', league_id).eq('team_id', team_id).eq('player_id', player_id);
      if (error) throw new Error(`Failed to drop player: ${error.message}`);
      await supabaseAdmin.from('daily_lineups').delete()
        .eq('team_id', team_id).eq('player_id', player_id)
        .gte('lineup_date', new Date().toISOString().split('T')[0]);
      notes = `Commissioner dropped ${playerName} from ${teamName}`;
      txnItemFrom = team_id;

    } else if (action === 'force_move') {
      if (!target_slot) throw new Error('target_slot is required for force_move');
      const { error } = await supabaseAdmin.from('league_players').update({ roster_slot: target_slot })
        .eq('league_id', league_id).eq('team_id', team_id).eq('player_id', player_id);
      if (error) throw new Error(`Failed to move player: ${error.message}`);
      const today = new Date().toISOString().split('T')[0];
      await supabaseAdmin.from('daily_lineups').upsert(
        { league_id, team_id, player_id, lineup_date: today, roster_slot: target_slot },
        { onConflict: 'team_id,player_id,lineup_date' }
      );
      notes = `Commissioner moved ${playerName} to ${target_slot} on ${teamName}`;
      txnItemFrom = team_id;
      txnItemTo = team_id;
    } else {
      throw new Error(`Unknown action: ${action}`);
    }

    const { data: txn, error: txnError } = await supabaseAdmin
      .from('league_transactions').insert({ league_id, type: 'commissioner', notes, team_id }).select('id').single();
    if (txnError) throw new Error(`Failed to create transaction: ${txnError.message}`);

    const { error: txnItemError } = await supabaseAdmin
      .from('league_transaction_items').insert({ transaction_id: txn.id, player_id, team_from_id: txnItemFrom, team_to_id: txnItemTo });
    if (txnItemError) throw new Error(`Failed to create transaction item: ${txnItemError.message}`);

    // Notify the affected team
    try {
      const ln = league?.name ?? 'Your League';
      await notifyTeams(supabaseAdmin, [team_id], 'commissioner',
        `${ln} — Commissioner Action`,
        notes,
        { screen: 'roster' }
      );
    } catch (notifyErr) {
      console.warn('Push notification failed (non-fatal):', notifyErr);
    }

    return new Response(
      JSON.stringify({ message: notes }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('commissioner-action error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});
