import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { handleError, jsonResponse, errorResponse } from '../_shared/http.ts';
import { notifyTeams, notifyUsers } from '../_shared/push.ts';
import { parseBody, z } from '../_shared/validate.ts';

// Lightweight edge function called by database webhook triggers (pg_net).
// Uses Vault secrets for project URL + anon key auth from trigger.
// Authenticates callers via a shared webhook secret stored in Vault.

// Two payload shapes share this function, both authed by the webhook secret:
//   - table webhooks  ({ type: 'INSERT', table, record }) from AFTER INSERT triggers
//   - membership_change ({ type, event, league_id, team_id, target_user_id })
//     fired by the leave_league / remove_member / reassign_commissioner RPCs.
// Permissive shape: only validate what we read.
const Body = z.object({
  type: z.string(),
  table: z.string().optional(),
  record: z.record(z.unknown()).nullable().optional(),
  event: z.string().optional(),
  league_id: z.string().uuid().optional(),
  team_id: z.string().uuid().nullable().optional(),
  target_user_id: z.string().uuid().nullable().optional(),
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

    const { type, table, record, event, league_id, team_id, target_user_id } = parseBody(Body, await req.json());

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SB_SECRET_KEY')!,
    );

    if (type === 'membership_change') {
      await handleMembershipChange(supabaseAdmin, { event, league_id, team_id, target_user_id });
      return jsonResponse({ ok: true });
    }

    if (type !== 'INSERT' || !record || !table) {
      return jsonResponse({ ok: true, skipped: true });
    }

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

// Member/commissioner lifecycle notices, fired by the leave_league /
// remove_member / reassign_commissioner RPCs. Each is addressed by user_id
// (notifyUsers) because the affected team may already be vacated (user_id NULL),
// so team-based token resolution would miss the recipient. All ride the
// `commissioner` category (default-on) — they're authority/access changes.
async function handleMembershipChange(
  supabase: any,
  { event, league_id, team_id, target_user_id }:
    { event?: string; league_id?: string; team_id?: string | null; target_user_id?: string | null },
) {
  if (!league_id) return;

  const { data: league } = await supabase
    .from('leagues')
    .select('name, created_by')
    .eq('id', league_id)
    .single();
  const leagueName = league?.name ?? 'Your League';

  switch (event) {
    case 'left': {
      // Tell the commissioner a slot opened up and needs reassigning.
      const commishUserId = league?.created_by;
      if (!commishUserId) return;
      let teamName = 'A member';
      if (team_id) {
        const { data: leaverTeam } = await supabase.from('teams').select('name').eq('id', team_id).single();
        teamName = leaverTeam?.name ?? teamName;
      }
      await notifyUsers(
        supabase, [commishUserId], league_id, 'commissioner',
        `${leagueName} — Member Left`,
        `${teamName} left the league. Their team is now unclaimed — reassign it to a new owner.`,
        { screen: 'league-info', league_id },
      );
      break;
    }
    case 'removed': {
      // Tell the kicked member they lost access.
      if (!target_user_id) return;
      await notifyUsers(
        supabase, [target_user_id], league_id, 'commissioner',
        `${leagueName} — Removed`,
        `You've been removed from ${leagueName} by the commissioner.`,
        { screen: 'home', league_id },
      );
      break;
    }
    case 'commissioner_assigned': {
      // Tell the new commissioner they now hold the gavel.
      if (!target_user_id) return;
      await notifyUsers(
        supabase, [target_user_id], league_id, 'commissioner',
        `${leagueName} — You're the Commissioner`,
        `You're now the commissioner of ${leagueName}. You have full control of the league.`,
        { screen: 'league-info', league_id },
      );
      break;
    }
    default:
      console.warn(`Unhandled membership_change event: ${event}`);
  }
}
