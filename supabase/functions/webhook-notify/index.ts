import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { handleError, jsonResponse, errorResponse } from '../_shared/http.ts';
import { notifyTeams } from '../_shared/push.ts';
import { parseBody, z } from '../_shared/validate.ts';

// Lightweight edge function called by database webhook triggers (pg_net).
// Uses Vault secrets for project URL + anon key auth from trigger.
// Authenticates callers via a shared webhook secret stored in Vault.

// Supabase database webhook payload — permissive shape: only validate what we read.
const Body = z.object({
  type: z.string(),
  table: z.string().optional(),
  record: z.record(z.unknown()).nullable().optional(),
});

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200 });
  }

  try {
    // Verify the webhook secret to ensure this is an internal call
    const webhookSecret = req.headers.get('x-webhook-secret');
    if (webhookSecret !== Deno.env.get('WEBHOOK_SECRET')) {
      return errorResponse('Unauthorized', 401);
    }

    const { type, table, record } = parseBody(Body, await req.json());

    if (type !== 'INSERT' || !record || !table) {
      return jsonResponse({ ok: true, skipped: true });
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SB_SECRET_KEY')!,
    );

    switch (table) {
      case 'trade_proposals':
        await handleTradeProposed(supabaseAdmin, record as any);
        break;

      case 'chat_messages':
        await handleChatMessage(supabaseAdmin, record as any);
        break;

      default:
        console.warn(`Unhandled table: ${table}`);
    }

    return jsonResponse({ ok: true });
  } catch (error) {
    return handleError(error, 'webhook-notify');
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
    { screen: 'trades', league_id, proposal_id: proposalId },
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
