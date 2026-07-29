import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { requireUser } from '../_shared/auth.ts';
import { handleError, jsonResponse, errorResponse } from '../_shared/http.ts';
import { checkRateLimit } from '../_shared/rate-limit.ts';

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
      Deno.env.get('SB_SECRET_KEY') ?? ''
    );

    // Verify the user's JWT
    const user = await requireUser(req);

    const rateLimited = await checkRateLimit(supabaseAdmin, user.id, 'delete-account');
    if (rateLimited) return rateLimited;

    const userId = user.id;

    // Block deletion if user is commissioner of any LIVE league. Archived
    // leagues are excluded: their UI is hidden by RLS so the user can't reach
    // the reassign/archive remediation, and `leagues.created_by` is set NULL
    // by the FK when the auth user is deleted — so an archived league they
    // created must not dead-end their deletion (Apple 5.1.1(v)).
    const { data: commissionerLeagues } = await supabaseAdmin
      .from('leagues')
      .select('id, name')
      .eq('created_by', userId)
      .is('archived_at', null);

    if (commissionerLeagues && commissionerLeagues.length > 0) {
      const names = commissionerLeagues.map((l: any) => l.name).join(', ');
      return errorResponse(
        `You are the commissioner of: ${names}. Open each league's info screen to reassign the commissioner (Make Someone Commissioner) or archive the league, then try again.`,
        400
      );
    }

    // Get all teams owned by this user
    const { data: teams } = await supabaseAdmin
      .from('teams')
      .select('id, league_id')
      .eq('user_id', userId);

    const teamIds = teams?.map((t: any) => t.id) ?? [];
    const cleanupErrors: string[] = [];

    // For each team, VACATE rather than DELETE (mirrors leave_league). Deleting
    // the roster/lineups/team tore a hole in an active league — matchups still
    // referenced the gone team and other members lost history. Instead we keep
    // league_players (roster), daily_lineups (lineup history), and team_seasons
    // (franchise history) so the league stays intact and the commissioner can
    // reassign the now-unclaimed team. Only the departing owner's personal and
    // pending data is removed below.
    for (const team of (teams ?? [])) {
      const cleanup = async (table: string, column: string, value: string) => {
        const { error } = await supabaseAdmin.from(table).delete().eq(column, value);
        if (error) cleanupErrors.push(`${table}: ${error.message}`);
      };

      // Cancel the owner's pending actions (a reassigned owner starts clean) and
      // remove their authored chat content (privacy).
      await cleanup('waiver_claims', 'team_id', team.id);
      await cleanup('waiver_priority', 'team_id', team.id);
      await cleanup('pending_transactions', 'team_id', team.id);
      await cleanup('chat_members', 'team_id', team.id);
      await cleanup('chat_messages', 'team_id', team.id);
      await cleanup('trade_votes', 'team_id', team.id);

      const { error: seedErr } = await supabaseAdmin.from('playoff_seed_picks').delete().eq('picking_team_id', team.id);
      if (seedErr) cleanupErrors.push(`playoff_seed_picks: ${seedErr.message}`);

      // Cancel any active trade proposals involving this team.
      const { data: tradeTeamEntries } = await supabaseAdmin
        .from('trade_proposal_teams').select('proposal_id').eq('team_id', team.id);
      if (tradeTeamEntries && tradeTeamEntries.length > 0) {
        const proposalIds = tradeTeamEntries.map((e: any) => e.proposal_id);
        await supabaseAdmin.from('trade_proposals')
          .update({ status: 'cancelled' })
          .in('id', proposalIds)
          .in('status', ['pending', 'accepted', 'in_review']);
      }
    }

    // Vacate the teams: detach the owner (this satisfies the teams.user_id FK to
    // auth.users the same way a delete would, so deleteUser below succeeds) and
    // clear the commissioner flag. current_teams is intentionally NOT
    // decremented — the vacated team still occupies its slot (matches
    // leave_league / vacate_team_internal).
    if (teamIds.length > 0) {
      const { error: vacateErr } = await supabaseAdmin
        .from('teams')
        .update({ user_id: null, is_commissioner: false })
        .in('id', teamIds);
      if (vacateErr) cleanupErrors.push(`teams (vacate): ${vacateErr.message}`);
    }

    // If critical cleanup failed, abort BEFORE deleting the auth user so we
    // never strand a half-deleted footprint behind a gone account. Routes
    // through handleError as a generic 500 (retryable) — the FK migration
    // makes the previously-fatal subscription/payment refs cascade cleanly,
    // so this should only fire on genuinely unexpected failures now.
    if (cleanupErrors.length > 0) {
      console.error('Cleanup errors during account deletion:', cleanupErrors);
      throw new Error(`Account cleanup failed: ${cleanupErrors.join('; ')}`);
    }

    // Remove push tokens and subscription
    await supabaseAdmin.from('push_tokens').delete().eq('user_id', userId);
    await supabaseAdmin.from('user_subscriptions').delete().eq('user_id', userId);

    // Remove user profile
    await supabaseAdmin.from('profiles').delete().eq('id', userId);

    // Delete the auth user
    const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (deleteError) throw deleteError;

    return jsonResponse({ message: 'Account deleted successfully' });
  } catch (error) {
    return handleError(error, 'delete-account');
  }
});
