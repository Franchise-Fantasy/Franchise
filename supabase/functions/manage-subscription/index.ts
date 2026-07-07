import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsResponse } from '../_shared/cors.ts';
import { requireUser } from '../_shared/auth.ts';
import { HttpError, handleError, jsonResponse } from '../_shared/http.ts';
import { checkRateLimit } from '../_shared/rate-limit.ts';
import { parseBody, z } from '../_shared/validate.ts';

const Body = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('grant_individual'),
    target_user_id: z.string().uuid('target_user_id required'),
    tier: z.enum(['pro', 'premium'], { errorMap: () => ({ message: 'tier must be: pro, premium' }) }),
  }),
  z.object({
    action: z.literal('grant_league'),
    league_id: z.string().uuid('league_id required'),
    tier: z.enum(['pro', 'premium'], { errorMap: () => ({ message: 'tier must be: pro, premium' }) }),
  }),
  z.object({
    action: z.literal('revoke_individual'),
    target_user_id: z.string().uuid('target_user_id required'),
  }),
  z.object({
    action: z.literal('revoke_league'),
    league_id: z.string().uuid('league_id required'),
  }),
]);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return corsResponse();

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SB_SECRET_KEY') ?? ''
    );

    // Verify caller JWT
    const user = await requireUser(req);

    const rateLimited = await checkRateLimit(supabaseAdmin, user.id, 'manage-subscription');
    if (rateLimited) return rateLimited;

    // Admin check via env var. Loud failure if misconfigured so we don't
    // silently grant/deny access due to a typo or empty env var.
    const rawAdminIds = Deno.env.get('ADMIN_USER_IDS');
    if (!rawAdminIds) {
      throw new Error('ADMIN_USER_IDS env var is missing — refusing to process.');
    }
    const adminIds = rawAdminIds
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (adminIds.length === 0) {
      throw new Error('ADMIN_USER_IDS parsed to empty list — refusing to process.');
    }
    if (!adminIds.includes(user.id)) {
      throw new HttpError('Only admins can manage subscriptions.', 403);
    }

    const payload = parseBody(Body, await req.json());

    if (payload.action === 'grant_individual') {
      const { target_user_id, tier } = payload;
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

      return jsonResponse({ message: `Granted ${tier} to user` });
    }

    if (payload.action === 'grant_league') {
      const { league_id, tier } = payload;
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

      return jsonResponse({ message: `Granted ${tier} to league` });
    }

    if (payload.action === 'revoke_individual') {
      const { error } = await supabaseAdmin
        .from('user_subscriptions')
        .update({ status: 'cancelled' })
        .eq('user_id', payload.target_user_id);
      if (error) throw error;

      return jsonResponse({ message: 'Subscription revoked' });
    }

    // revoke_league
    const { error } = await supabaseAdmin
      .from('league_subscriptions')
      .update({ status: 'cancelled' })
      .eq('league_id', payload.league_id);
    if (error) throw error;

    return jsonResponse({ message: 'League subscription revoked' });

  } catch (error) {
    return handleError(error, 'manage-subscription');
  }
});
