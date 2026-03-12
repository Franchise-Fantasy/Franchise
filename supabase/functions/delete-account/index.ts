import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
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
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Verify the user's JWT
    const authHeader = req.headers.get('Authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader : `Bearer ${authHeader}`;
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: token ?? '' } } }
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) throw new Error('Unauthorized');

    const rateLimited = await checkRateLimit(supabaseAdmin, user.id, 'delete-account');
    if (rateLimited) return rateLimited;

    const userId = user.id;

    // Block deletion if user is commissioner of any league
    const { data: commissionerLeagues } = await supabaseAdmin
      .from('leagues')
      .select('id, name')
      .eq('created_by', userId);

    if (commissionerLeagues && commissionerLeagues.length > 0) {
      const names = commissionerLeagues.map((l: any) => l.name).join(', ');
      return new Response(
        JSON.stringify({ error: `You are the commissioner of: ${names}. Transfer commissioner role or delete the league(s) before deleting your account.` }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Get all teams owned by this user
    const { data: teams } = await supabaseAdmin
      .from('teams')
      .select('id, league_id')
      .eq('user_id', userId);

    const teamIds = teams?.map((t: any) => t.id) ?? [];
    const cleanupErrors: string[] = [];

    // Clean up team-related data for each team
    for (const team of (teams ?? [])) {
      const cleanup = async (table: string, column: string, value: string) => {
        const { error } = await supabaseAdmin.from(table).delete().eq(column, value);
        if (error) cleanupErrors.push(`${table}: ${error.message}`);
      };

      await cleanup('league_players', 'team_id', team.id);
      await cleanup('daily_lineups', 'team_id', team.id);
      await cleanup('waiver_claims', 'team_id', team.id);
      await cleanup('waiver_priority', 'team_id', team.id);
      await cleanup('pending_transactions', 'team_id', team.id);
      await cleanup('chat_members', 'team_id', team.id);
      await cleanup('chat_messages', 'team_id', team.id);
      await cleanup('trade_votes', 'team_id', team.id);
      await cleanup('team_seasons', 'team_id', team.id);

      const { error: seedErr } = await supabaseAdmin.from('playoff_seed_picks').delete().eq('picking_team_id', team.id);
      if (seedErr) cleanupErrors.push(`playoff_seed_picks: ${seedErr.message}`);

      // Cancel any active trade proposals involving this team
      const { data: tradeTeamEntries } = await supabaseAdmin
        .from('trade_proposal_teams').select('proposal_id').eq('team_id', team.id);
      if (tradeTeamEntries && tradeTeamEntries.length > 0) {
        const proposalIds = tradeTeamEntries.map((e: any) => e.proposal_id);
        await supabaseAdmin.from('trade_proposals')
          .update({ status: 'cancelled' })
          .in('id', proposalIds)
          .in('status', ['pending', 'accepted', 'in_review']);
      }

      // Decrement league team count
      await supabaseAdmin.rpc('decrement_team_count', { lid: team.league_id });
    }

    // Delete the teams themselves
    if (teamIds.length > 0) {
      const { error: teamDelErr } = await supabaseAdmin.from('teams').delete().in('id', teamIds);
      if (teamDelErr) cleanupErrors.push(`teams: ${teamDelErr.message}`);
    }

    // If critical cleanup failed, abort before deleting the auth user
    if (cleanupErrors.length > 0) {
      console.error('Cleanup errors during account deletion:', cleanupErrors);
    }

    // Remove push tokens and subscription
    await supabaseAdmin.from('push_tokens').delete().eq('user_id', userId);
    await supabaseAdmin.from('user_subscriptions').delete().eq('user_id', userId);

    // Remove user profile
    await supabaseAdmin.from('profiles').delete().eq('id', userId);

    // Delete the auth user
    const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (deleteError) throw new Error(`Failed to delete auth user: ${deleteError.message}`);

    return new Response(
      JSON.stringify({ message: 'Account deleted successfully' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('delete-account error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});
