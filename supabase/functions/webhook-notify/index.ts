import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { notifyTeams } from '../_shared/push.ts';

// Lightweight edge function called by database webhook triggers (pg_net).
// Uses Vault secrets for project URL + anon key auth from trigger.
// Authenticates callers via a shared webhook secret stored in Vault.

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200 });
  }

  try {
    // Verify the webhook secret to ensure this is an internal call
    const webhookSecret = req.headers.get('x-webhook-secret');
    if (webhookSecret !== Deno.env.get('WEBHOOK_SECRET')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    }

    const payload = await req.json();
    const { type, table, record } = payload;

    if (type !== 'INSERT' || !record) {
      return new Response(JSON.stringify({ ok: true, skipped: true }), { status: 200 });
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SB_SECRET_KEY')!,
    );

    switch (table) {
      case 'trade_proposals':
        await handleTradeProposed(supabaseAdmin, record);
        break;

      case 'chat_messages':
        await handleChatMessage(supabaseAdmin, record);
        break;

      default:
        console.warn(`Unhandled table: ${table}`);
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (err: any) {
    console.error('webhook-notify error:', err);
    return new Response(JSON.stringify({ error: err?.message ?? String(err) }), { status: 500 });
  }
});

async function handleTradeProposed(
  supabase: any,
  record: { id: string; league_id: string; proposed_by_team_id: string },
) {
  const { id: proposalId, league_id, proposed_by_team_id } = record;

  // Get league name and proposing team name
  const [{ data: league }, { data: proposer }] = await Promise.all([
    supabase.from('leagues').select('name').eq('id', league_id).single(),
    supabase.from('teams').select('name').eq('id', proposed_by_team_id).single(),
  ]);

  // Get the other teams involved (exclude the proposer)
  const { data: otherTeams } = await supabase
    .from('trade_proposal_teams')
    .select('team_id')
    .eq('proposal_id', proposalId)
    .neq('team_id', proposed_by_team_id);

  if (!otherTeams || otherTeams.length === 0) return;

  const teamIds = otherTeams.map((t: any) => t.team_id);
  const leagueName = league?.name ?? 'Your League';
  const proposerName = proposer?.name ?? 'A team';

  await notifyTeams(
    supabase,
    teamIds,
    'trades',
    `${leagueName} — Trade Proposed`,
    `${proposerName} has proposed a trade. Review it now.`,
    { screen: 'trades', league_id },
  );
}

async function handleChatMessage(
  supabase: any,
  record: { id: string; conversation_id: string; team_id: string; league_id: string; type?: string },
) {
  // Poll and trade messages are notified by their own edge functions — skip to avoid duplicates
  if (record.type === 'poll' || record.type === 'trade') return;

  const { conversation_id, team_id, league_id } = record;

  // Get conversation members who haven't read recently (offline threshold: 2 minutes)
  const threshold = new Date(Date.now() - 2 * 60 * 1000).toISOString();

  const { data: offlineMembers } = await supabase
    .from('chat_members')
    .select('team_id')
    .eq('conversation_id', conversation_id)
    .neq('team_id', team_id)
    .lt('last_read_at', threshold);

  if (!offlineMembers || offlineMembers.length === 0) return;

  // Get sender team name and league name
  const [{ data: sender }, { data: league }, { data: conversation }] = await Promise.all([
    supabase.from('teams').select('name').eq('id', team_id).single(),
    supabase.from('leagues').select('name').eq('id', league_id).single(),
    supabase.from('chat_conversations').select('type').eq('id', conversation_id).single(),
  ]);

  const senderName = sender?.name ?? 'Someone';
  const leagueName = league?.name ?? 'Your League';
  const isDm = conversation?.type === 'dm';

  const teamIds = offlineMembers.map((m: any) => m.team_id);

  await notifyTeams(
    supabase,
    teamIds,
    'chat',
    `${leagueName} — ${isDm ? 'New Message' : 'League Chat'}`,
    `${senderName}: New message`,
    { screen: `chat/${conversation_id}`, league_id },
  );
}
