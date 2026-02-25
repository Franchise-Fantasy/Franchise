import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { notifyTeams } from './push.ts';

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
    const token = authHeader?.startsWith('Bearer ') ? authHeader : `Bearer ${authHeader}`;
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: token ?? '' } } }
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) throw new Error('Unauthorized');

    const { proposal_id } = await req.json();
    if (!proposal_id) throw new Error('proposal_id is required');

    const { data: proposal, error: proposalError } = await supabaseAdmin
      .from('trade_proposals')
      .select('*')
      .eq('id', proposal_id)
      .single();
    if (proposalError || !proposal) throw new Error('Trade proposal not found.');

    if (proposal.status !== 'accepted' && proposal.status !== 'in_review') {
      throw new Error(`Cannot execute trade with status: ${proposal.status}`);
    }

    const { data: league } = await supabaseAdmin
      .from('leagues')
      .select('created_by')
      .eq('id', proposal.league_id)
      .single();

    const isCommissioner = league?.created_by === user.id;

    if (!isCommissioner) {
      const { data: userTeamInTrade } = await supabaseAdmin
        .from('trade_proposal_teams')
        .select('id')
        .eq('proposal_id', proposal_id)
        .eq('team_id', (
          await supabaseAdmin
            .from('teams')
            .select('id')
            .eq('league_id', proposal.league_id)
            .eq('user_id', user.id)
            .single()
        ).data?.id ?? '')
        .single();

      if (!userTeamInTrade) {
        throw new Error('Only trade parties or the commissioner can execute a trade.');
      }
    }

    const { data: items, error: itemsError } = await supabaseAdmin
      .from('trade_proposal_items')
      .select('*')
      .eq('proposal_id', proposal_id);
    if (itemsError) throw itemsError;
    if (!items || items.length === 0) throw new Error('No items in this trade proposal.');

    const timestamp = new Date().toISOString();
    const playerItems = items.filter((i: any) => i.player_id != null);
    const pickItems = items.filter((i: any) => i.draft_pick_id != null);

    for (const item of playerItems) {
      const { error } = await supabaseAdmin
        .from('league_players')
        .update({
          team_id: item.to_team_id,
          acquired_via: 'trade',
          acquired_at: timestamp,
          roster_slot: 'BE',
        })
        .eq('league_id', proposal.league_id)
        .eq('player_id', item.player_id)
        .eq('team_id', item.from_team_id);
      if (error) throw new Error(`Failed to transfer player ${item.player_id}: ${error.message}`);
    }

    for (const item of pickItems) {
      const { error } = await supabaseAdmin
        .from('draft_picks')
        .update({ current_team_id: item.to_team_id })
        .eq('id', item.draft_pick_id);
      if (error) throw new Error(`Failed to transfer pick ${item.draft_pick_id}: ${error.message}`);
    }

    const playerIds = playerItems.map((i: any) => i.player_id);
    let playerNameMap: Record<string, string> = {};
    if (playerIds.length > 0) {
      const { data: players } = await supabaseAdmin.from('players').select('id, name').in('id', playerIds);
      if (players) playerNameMap = Object.fromEntries(players.map((p: any) => [p.id, p.name]));
    }

    const pickIds = pickItems.map((i: any) => i.draft_pick_id);
    let pickInfoMap: Record<string, string> = {};
    if (pickIds.length > 0) {
      const { data: picks } = await supabaseAdmin.from('draft_picks').select('id, season, round').in('id', pickIds);
      if (picks) pickInfoMap = Object.fromEntries(picks.map((p: any) => [p.id, `${p.season} Rd ${p.round}`]));
    }

    const allTeamIds = [...new Set(items.flatMap((i: any) => [i.from_team_id, i.to_team_id]))];
    let teamNameMap: Record<string, string> = {};
    if (allTeamIds.length > 0) {
      const { data: teams } = await supabaseAdmin.from('teams').select('id, name').in('id', allTeamIds);
      if (teams) teamNameMap = Object.fromEntries(teams.map((t: any) => [t.id, t.name]));
    }

    const notesParts = items.map((item: any) => {
      const asset = item.player_id
        ? playerNameMap[item.player_id] ?? 'Unknown Player'
        : pickInfoMap[item.draft_pick_id] ?? 'Unknown Pick';
      const from = teamNameMap[item.from_team_id] ?? 'Unknown';
      const to = teamNameMap[item.to_team_id] ?? 'Unknown';
      return `${asset} (${from} -> ${to})`;
    });
    const notes = `Trade completed: ${notesParts.join(', ')}`;

    const { data: txn, error: txnError } = await supabaseAdmin
      .from('league_transactions')
      .insert({ league_id: proposal.league_id, type: 'trade', notes })
      .select('id')
      .single();
    if (txnError) throw new Error(`Failed to create transaction: ${txnError.message}`);

    const txnItems = items.map((item: any) => ({
      transaction_id: txn.id,
      player_id: item.player_id,
      draft_pick_id: item.draft_pick_id,
      team_from_id: item.from_team_id,
      team_to_id: item.to_team_id,
    }));
    const { error: txnItemsError } = await supabaseAdmin.from('league_transaction_items').insert(txnItems);
    if (txnItemsError) throw new Error(`Failed to create transaction items: ${txnItemsError.message}`);

    const { error: completeError } = await supabaseAdmin
      .from('trade_proposals')
      .update({ status: 'completed', completed_at: timestamp, transaction_id: txn.id })
      .eq('id', proposal_id);
    if (completeError) throw new Error(`Failed to update proposal: ${completeError.message}`);

    // Notify all teams involved in the trade
    try {
      await notifyTeams(supabaseAdmin, allTeamIds, 'trades',
        'Trade Completed!',
        notes,
        { screen: 'trades', proposal_id }
      );
    } catch (notifyErr) {
      console.warn('Push notification failed (non-fatal):', notifyErr);
    }

    return new Response(
      JSON.stringify({ message: 'Trade completed!', transaction_id: txn.id }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('execute-trade error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});
