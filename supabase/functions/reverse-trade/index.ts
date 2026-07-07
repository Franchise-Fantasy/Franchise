import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsResponse } from '../_shared/cors.ts';
import { requireUser } from '../_shared/auth.ts';
import { HttpError, handleError, jsonResponse } from '../_shared/http.ts';
import { notifyTeams } from '../_shared/push.ts';
import { checkRateLimit } from '../_shared/rate-limit.ts';
import { parseBody, z } from '../_shared/validate.ts';

const Body = z.object({
  proposal_id: z.string().uuid(),
});

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return corsResponse();

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SB_SECRET_KEY') ?? ''
    );

    const user = await requireUser(req);

    const rateLimited = await checkRateLimit(supabaseAdmin, user.id, 'reverse-trade');
    if (rateLimited) return rateLimited;

    const { proposal_id } = parseBody(Body, await req.json());

    const { data: proposal, error: proposalError } = await supabaseAdmin
      .from('trade_proposals').select('*').eq('id', proposal_id).single();
    if (proposalError || !proposal) throw new HttpError('Trade proposal not found.', 404);
    if (proposal.status !== 'completed') {
      throw new HttpError(`Can only reverse completed trades. Current status: ${proposal.status}`);
    }

    const { data: league } = await supabaseAdmin
      .from('leagues').select('created_by, name').eq('id', proposal.league_id).single();
    if (league?.created_by !== user.id) {
      throw new HttpError('Only the commissioner can reverse trades.', 403);
    }

    const { data: items, error: itemsError } = await supabaseAdmin
      .from('trade_proposal_items').select('*').eq('proposal_id', proposal_id);
    if (itemsError) throw itemsError;
    if (!items || items.length === 0) throw new HttpError('No items found for this trade.');

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
      if (error) throw error;
    }

    const pickItems = items.filter((i: any) => i.draft_pick_id != null);
    for (const item of pickItems) {
      const { data: pick } = await supabaseAdmin
        .from('draft_picks').select('id, player_id, season, round').eq('id', item.draft_pick_id).single();
      if (pick?.player_id) {
        warnings.push(`${pick.season} Rd ${pick.round} pick already used — skipped.`);
        continue;
      }
      // Only clear protection if THIS trade set it; preserve prior protection otherwise
      const tradeSetProtection = item.protection_threshold != null;
      const { error } = await supabaseAdmin.from('draft_picks')
        .update({
          current_team_id: item.from_team_id,
          ...(tradeSetProtection ? { protection_threshold: null, protection_owner_id: null } : {}),
        })
        .eq('id', item.draft_pick_id);
      if (error) throw error;
    }

    // Delete pick swaps created by this trade
    const { error: swapDelError } = await supabaseAdmin
      .from('pick_swaps')
      .delete()
      .eq('created_by_proposal_id', proposal_id);
    if (swapDelError) throw swapDelError;

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
      .from('league_transactions').insert({ league_id: proposal.league_id, type: 'commissioner', notes, team_id: proposal.proposed_by_team_id }).select('id').single();
    if (txnError) throw txnError;

    const txnItems = items.map((item: any) => ({
      transaction_id: txn.id, player_id: item.player_id, draft_pick_id: item.draft_pick_id,
      team_from_id: item.to_team_id, team_to_id: item.from_team_id,
    }));
    const { error: txnItemsError } = await supabaseAdmin.from('league_transaction_items').insert(txnItems);
    if (txnItemsError) throw txnItemsError;

    const { error: updateError } = await supabaseAdmin
      .from('trade_proposals').update({ status: 'reversed' }).eq('id', proposal_id);
    if (updateError) throw updateError;

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

    return jsonResponse({ message: 'Trade reversed successfully.', warnings });
  } catch (error) {
    return handleError(error, 'reverse-trade');
  }
});
