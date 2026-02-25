import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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

    const userId = user.id;

    // Get all teams owned by this user
    const { data: teams } = await supabaseAdmin
      .from('teams')
      .select('id, league_id')
      .eq('user_id', userId);

    const teamIds = teams?.map(t => t.id) ?? [];

    // Clean up team-related data for each team
    for (const team of (teams ?? [])) {
      // Remove league_players owned by this team
      await supabaseAdmin.from('league_players')
        .delete()
        .eq('team_id', team.id);

      // Remove daily_lineups
      await supabaseAdmin.from('daily_lineups')
        .delete()
        .eq('team_id', team.id);

      // Remove waiver claims
      await supabaseAdmin.from('waiver_claims')
        .delete()
        .eq('team_id', team.id);

      // Remove waiver priority
      await supabaseAdmin.from('waiver_priority')
        .delete()
        .eq('team_id', team.id);

      // Remove pending transactions
      await supabaseAdmin.from('pending_transactions')
        .delete()
        .eq('team_id', team.id);

      // Remove chat members
      await supabaseAdmin.from('chat_members')
        .delete()
        .eq('team_id', team.id);

      // Remove chat messages
      await supabaseAdmin.from('chat_messages')
        .delete()
        .eq('team_id', team.id);

      // Remove trade votes by this team
      await supabaseAdmin.from('trade_votes')
        .delete()
        .eq('team_id', team.id);

      // Remove playoff seed picks
      await supabaseAdmin.from('playoff_seed_picks')
        .delete()
        .eq('picking_team_id', team.id);

      // Remove team_seasons archives
      await supabaseAdmin.from('team_seasons')
        .delete()
        .eq('team_id', team.id);

      // Decrement league team count
      await supabaseAdmin.rpc('decrement_team_count', { lid: team.league_id });
    }

    // Delete the teams themselves
    if (teamIds.length > 0) {
      await supabaseAdmin.from('teams')
        .delete()
        .in('id', teamIds);
    }

    // Remove push tokens
    await supabaseAdmin.from('push_tokens')
      .delete()
      .eq('user_id', userId);

    // Remove user profile
    await supabaseAdmin.from('profiles')
      .delete()
      .eq('id', userId);

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
