import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsResponse, CORS_HEADERS } from '../_shared/cors.ts';

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

    // Admin check via env var
    const adminIds = (Deno.env.get('ADMIN_USER_IDS') ?? '').split(',').map(s => s.trim());
    if (!adminIds.includes(user.id)) {
      throw new Error('Only admins can manage subscriptions.');
    }

    const { action, target_user_id, league_id, tier } = await req.json();
    const validTiers = ['pro', 'premium'];
    const validActions = ['grant_individual', 'grant_league', 'revoke_individual', 'revoke_league'];

    if (!validActions.includes(action)) {
      throw new Error(`Invalid action. Use: ${validActions.join(', ')}`);
    }

    if (action === 'grant_individual') {
      if (!target_user_id || !tier) throw new Error('target_user_id and tier required');
      if (!validTiers.includes(tier)) throw new Error(`tier must be: ${validTiers.join(', ')}`);

      const { error } = await supabaseAdmin
        .from('user_subscriptions')
        .upsert({
          user_id: target_user_id,
          tier,
          status: 'active',
          starts_at: new Date().toISOString(),
          expires_at: null,
        }, { onConflict: 'user_id' });
      if (error) throw error;

      return new Response(JSON.stringify({ message: `Granted ${tier} to user` }), {
        status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'grant_league') {
      if (!league_id || !tier) throw new Error('league_id and tier required');
      if (!validTiers.includes(tier)) throw new Error(`tier must be: ${validTiers.join(', ')}`);

      const { error } = await supabaseAdmin
        .from('league_subscriptions')
        .upsert({
          league_id,
          purchased_by: user.id,
          tier,
          status: 'active',
          starts_at: new Date().toISOString(),
          expires_at: null,
        }, { onConflict: 'league_id' });
      if (error) throw error;

      return new Response(JSON.stringify({ message: `Granted ${tier} to league` }), {
        status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'revoke_individual') {
      if (!target_user_id) throw new Error('target_user_id required');

      const { error } = await supabaseAdmin
        .from('user_subscriptions')
        .update({ status: 'cancelled' })
        .eq('user_id', target_user_id);
      if (error) throw error;

      return new Response(JSON.stringify({ message: 'Subscription revoked' }), {
        status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    // revoke_league
    if (!league_id) throw new Error('league_id required');

    const { error } = await supabaseAdmin
      .from('league_subscriptions')
      .update({ status: 'cancelled' })
      .eq('league_id', league_id);
    if (error) throw error;

    return new Response(JSON.stringify({ message: 'League subscription revoked' }), {
      status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    );
  }
});
