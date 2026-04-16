import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

export type SubscriptionTier = 'free' | 'pro' | 'premium';

const TIER_RANK: Record<SubscriptionTier, number> = {
  free: 0,
  pro: 1,
  premium: 2,
};

/**
 * Returns the effective subscription tier for a user, considering both
 * their individual subscription and any league-wide subscription.
 */
export async function getUserTier(
  supabase: SupabaseClient,
  userId: string,
  leagueId?: string,
): Promise<SubscriptionTier> {
  const { data: userSub } = await supabase
    .from('user_subscriptions')
    .select('tier')
    .eq('user_id', userId)
    .eq('status', 'active')
    .or('expires_at.is.null,expires_at.gt.now()')
    .maybeSingle();

  const individualTier: SubscriptionTier = (userSub?.tier as SubscriptionTier) ?? 'free';

  let leagueTier: SubscriptionTier = 'free';
  if (leagueId) {
    const { data: leagueSub } = await supabase
      .from('league_subscriptions')
      .select('tier')
      .eq('league_id', leagueId)
      .eq('status', 'active')
      .or('expires_at.is.null,expires_at.gt.now()')
      .maybeSingle();
    leagueTier = (leagueSub?.tier as SubscriptionTier) ?? 'free';
  }

  return TIER_RANK[individualTier] >= TIER_RANK[leagueTier]
    ? individualTier
    : leagueTier;
}

/**
 * Asserts the user has at least the required tier. Throws if insufficient.
 *
 * STATUS (2026-04-15): Currently unused — every premium feature in
 * constants/Subscriptions.ts is a client-side computation (analytics,
 * prospects, draft tools) that does NOT hit an edge function. This helper
 * exists for the first time a premium operation moves server-side. When
 * you add such a function, call `await requireTier(supabase, user.id,
 * 'pro' | 'premium', leagueId)` immediately after verifying the JWT.
 */
export async function requireTier(
  supabase: SupabaseClient,
  userId: string,
  requiredTier: SubscriptionTier,
  leagueId?: string,
): Promise<void> {
  const userTier = await getUserTier(supabase, userId, leagueId);
  if (TIER_RANK[userTier] < TIER_RANK[requiredTier]) {
    throw new Error(`This feature requires a ${requiredTier} subscription.`);
  }
}
