import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsResponse } from '../_shared/cors.ts';
import { notifyLeague } from '../_shared/push.ts';
import { checkRateLimit } from '../_shared/rate-limit.ts';

const BIDDING_WAR_WINDOW_DAYS = 7;

const AUTO_TEMPLATE = 'Multiple teams have made offers involving {player}. A bidding war may be developing.';
const TRADE_BLOCK_TEMPLATE = 'Sources say {player} is generating significant trade block interest from multiple teams';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return corsResponse();

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Verify caller JWT
    const authHeader = req.headers.get('Authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader : `Bearer ${authHeader}`;
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: token ?? '' } } }
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) throw new Error('Unauthorized');

    const rateLimited = await checkRateLimit(supabaseAdmin, user.id, 'check-bidding-wars');
    if (rateLimited) return rateLimited;

    const { proposal_id, league_id } = await req.json();
    if (!proposal_id || !league_id) throw new Error('proposal_id and league_id required');

    // Check if auto-rumors are enabled for this league
    const { data: league } = await supabaseAdmin
      .from('leagues')
      .select('auto_rumors_enabled, name')
      .eq('id', league_id)
      .single();

    if (!league?.auto_rumors_enabled) {
      return new Response(JSON.stringify({ skipped: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Get players in the new proposal
    const { data: proposalItems } = await supabaseAdmin
      .from('trade_proposal_items')
      .select('player_id')
      .eq('proposal_id', proposal_id)
      .not('player_id', 'is', null);

    const playerIds = (proposalItems ?? []).map((i: any) => i.player_id);
    if (playerIds.length === 0) {
      return new Response(JSON.stringify({ skipped: true, reason: 'no players' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Get the proposing team for this proposal
    const { data: proposal } = await supabaseAdmin
      .from('trade_proposals')
      .select('proposed_by_team_id')
      .eq('id', proposal_id)
      .single();

    const proposingTeamId = proposal?.proposed_by_team_id;
    const cutoffDate = new Date(Date.now() - BIDDING_WAR_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

    // Find league chat for posting rumors
    const { data: leagueChat } = await supabaseAdmin
      .from('chat_conversations')
      .select('id')
      .eq('league_id', league_id)
      .eq('type', 'league')
      .single();

    if (!leagueChat) {
      return new Response(JSON.stringify({ skipped: true, reason: 'no league chat' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Get player names for rumor text
    const { data: playerNames } = await supabaseAdmin
      .from('players')
      .select('id, name')
      .in('id', playerIds);
    const nameMap: Record<string, string> = {};
    for (const p of playerNames ?? []) nameMap[p.id] = p.name;

    const rumorsPosted: string[] = [];

    for (const playerId of playerIds) {
      // Check 1: General proposal overlap — 2+ teams proposing for same player in last 7 days
      const { data: overlapping } = await supabaseAdmin
        .from('trade_proposal_items')
        .select('trade_proposals!inner(proposed_by_team_id, proposed_at, status)')
        .eq('player_id', playerId)
        .neq('trade_proposals.proposed_by_team_id', proposingTeamId)
        .in('trade_proposals.status', ['pending', 'accepted', 'in_review'])
        .gte('trade_proposals.proposed_at', cutoffDate);

      if (overlapping && overlapping.length > 0) {
        // Check no existing auto rumor for this player
        const { count } = await supabaseAdmin
          .from('trade_rumors')
          .select('id', { count: 'exact', head: true })
          .eq('league_id', league_id)
          .eq('player_id', playerId)
          .eq('trigger_type', 'auto');

        if ((count ?? 0) === 0) {
          const playerName = nameMap[playerId] ?? 'Unknown';
          await supabaseAdmin.from('trade_rumors').insert({
            league_id,
            player_id: playerId,
            trigger_type: 'auto',
            template: AUTO_TEMPLATE,
          });
          await supabaseAdmin.from('chat_messages').insert({
            conversation_id: leagueChat.id,
            team_id: null,
            content: JSON.stringify({
              player_name: playerName,
              template: AUTO_TEMPLATE,
            }),
            type: 'rumor',
            league_id,
          });
          // Push notify the league about the auto-rumor
          const ln = league?.name ?? 'Your League';
          await notifyLeague(supabaseAdmin, league_id, 'trade_rumors',
            `${ln} — Trade Rumor`,
            `A bidding war may be developing for ${playerName}.`,
            { screen: 'chat' }
          ).catch(() => {});
          rumorsPosted.push(`auto:${playerName}`);
        }
      }

      // Check 2: Trade block interest — player is on trade block + 2+ teams targeting
      const { data: tradeBlockPlayer } = await supabaseAdmin
        .from('league_players')
        .select('on_trade_block')
        .eq('league_id', league_id)
        .eq('player_id', playerId)
        .eq('on_trade_block', true)
        .maybeSingle();

      if (tradeBlockPlayer) {
        // Count distinct teams (including current proposal) targeting this player in last 7 days
        const { data: allTargeting } = await supabaseAdmin
          .from('trade_proposal_items')
          .select('trade_proposals!inner(proposed_by_team_id, proposed_at, status)')
          .eq('player_id', playerId)
          .in('trade_proposals.status', ['pending', 'accepted', 'in_review'])
          .gte('trade_proposals.proposed_at', cutoffDate);

        const uniqueTeams = new Set(
          (allTargeting ?? []).map((r: any) => r.trade_proposals.proposed_by_team_id)
        );

        if (uniqueTeams.size >= 2) {
          const { count } = await supabaseAdmin
            .from('trade_rumors')
            .select('id', { count: 'exact', head: true })
            .eq('league_id', league_id)
            .eq('player_id', playerId)
            .eq('trigger_type', 'auto_block');

          if ((count ?? 0) === 0) {
            const playerName = nameMap[playerId] ?? 'Unknown';
            await supabaseAdmin.from('trade_rumors').insert({
              league_id,
              player_id: playerId,
              trigger_type: 'auto_block',
              template: TRADE_BLOCK_TEMPLATE,
            });
            await supabaseAdmin.from('chat_messages').insert({
              conversation_id: leagueChat.id,
              team_id: null,
              content: JSON.stringify({
                player_name: playerName,
                template: TRADE_BLOCK_TEMPLATE,
              }),
              type: 'rumor',
              league_id,
            });
            // Push notify the league about trade block interest
            const ln2 = league?.name ?? 'Your League';
            await notifyLeague(supabaseAdmin, league_id, 'trade_rumors',
              `${ln2} — Trade Rumor`,
              `${playerName} is generating significant trade block interest.`,
              { screen: 'chat' }
            ).catch(() => {});
            rumorsPosted.push(`auto_block:${playerName}`);
          }
        }
      }
    }

    return new Response(
      JSON.stringify({ rumors_posted: rumorsPosted }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('check-bidding-wars error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});
