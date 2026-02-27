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
      .from('trade_proposals').select('*').eq('id', proposal_id).single();
    if (proposalError || !proposal) throw new Error('Trade proposal not found.');
    if (proposal.status !== 'completed') {
      throw new Error(`Can only reverse completed trades. Current status: ${proposal.status}`);
    }

    const { data: league } = await supabaseAdmin
      .from('leagues').select('created_by, name').eq('id', proposal.league_id).single();
    if (league?.created_by !== user.id) {
      throw new Error('Only the commissioner can reverse trades.');
    }

    const { data: items, error: itemsError } = await supabaseAdmin
      .from('trade_proposal_items').select('*').eq('proposal_id', proposal_id);
    if (itemsError) throw itemsError;
    if (!items || items.length === 0) throw new Error('No items found for this trade.');

    const warnings: string[] = [];
    const timestamp = new Date().toISOString();

    const playerItems = items.filter((i: any) => i.player_id != null);
    for (const item of playerItems) {
      const { data: currentEntry } = await supabaseAdmin
        .from('league_players').select('id')
        .eq('league_id', proposal.league_id).eq('player_id', item.player_id)
        .eq('team_id', item.to_team_id).maybeSingle();

      if (!currentEntry) {
        const { data: player } = await supabaseAdmin.from('players').select('name').eq('id', item.player_id).single();
        warnings.push(`${player?.name ?? 'Unknown player'} is no longer on the receiving team — skipped.`);
        continue;
      }

      const { error } = await supabaseAdmin.from('league_players').update({
        team_id: item.from_team_id, acquired_via: 'trade_reversal', acquired_at: timestamp, roster_slot: 'BE',
      }).eq('league_id', proposal.league_id).eq('player_id', item.player_id).eq('team_id', item.to_team_id);
      if (error) throw new Error(`Failed to reverse player ${item.player_id}: ${error.message}`);
    }

    const pickItems = items.filter((i: any) => i.draft_pick_id != null);
    for (const item of pickItems) {
      const { data: pick } = await supabaseAdmin
        .from('draft_picks').select('id, player_id, season, round').eq('id', item.draft_pick_id).single();
      if (pick?.player_id) {
        warnings.push(`${pick.season} Rd ${pick.round} pick already used — skipped.`);
        continue;
      }
      const { error } = await supabaseAdmin.from('draft_picks').update({ current_team_id: item.from_team_id }).eq('id', item.draft_pick_id);
      if (error) throw new Error(`Failed to reverse pick ${item.draft_pick_id}: ${error.message}`);
    }

    const playerIds = playerItems.map((i: any) => i.player_id);
    let playerNameMap: Record<string, string> = {};
    if (playerIds.length > 0) {
      const { data: players } = await supabaseAdmin.from('players').select('id, name').in('id', playerIds);
      if (players) playerNameMap = Object.fromEntries(players.map((p: any) => [p.id, p.name]));
    }

    const allTeamIds = [...new Set(items.flatMap((i: any) => [i.from_team_id, i.to_team_id]))];
    let teamNameMap: Record<string, string> = {};
    if (allTeamIds.length > 0) {
      const { data: teams } = await supabaseAdmin.from('teams').select('id, name').in('id', allTeamIds);
      if (teams) teamNameMap = Object.fromEntries(teams.map((t: any) => [t.id, t.name]));
    }

    const teamsInvolved = [...new Set(items.map((i: any) => teamNameMap[i.from_team_id] ?? 'Unknown'))];
    const notes = `Commissioner reversed trade between ${teamsInvolved.join(' & ')}` +
      (warnings.length > 0 ? ` (${warnings.length} item(s) skipped)` : '');

    const { data: txn, error: txnError } = await supabaseAdmin
      .from('league_transactions').insert({ league_id: proposal.league_id, type: 'commissioner', notes }).select('id').single();
    if (txnError) throw new Error(`Failed to create transaction: ${txnError.message}`);

    const txnItems = items.map((item: any) => ({
      transaction_id: txn.id, player_id: item.player_id, draft_pick_id: item.draft_pick_id,
      team_from_id: item.to_team_id, team_to_id: item.from_team_id,
    }));
    const { error: txnItemsError } = await supabaseAdmin.from('league_transaction_items').insert(txnItems);
    if (txnItemsError) throw new Error(`Failed to create transaction items: ${txnItemsError.message}`);

    const { error: updateError } = await supabaseAdmin
      .from('trade_proposals').update({ status: 'reversed' }).eq('id', proposal_id);
    if (updateError) throw new Error(`Failed to update proposal status: ${updateError.message}`);

    // Notify all teams involved
    try {
      const ln = league?.name ?? 'Your League';
      await notifyTeams(supabaseAdmin, allTeamIds, 'commissioner',
        `${ln} — Trade Reversed`,
        notes,
        { screen: 'trades' }
      );
    } catch (notifyErr) {
      console.warn('Push notification failed (non-fatal):', notifyErr);
    }

    return new Response(
      JSON.stringify({ message: 'Trade reversed successfully.', warnings }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('reverse-trade error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});
