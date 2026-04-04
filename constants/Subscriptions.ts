export type SubscriptionTier = 'free' | 'pro' | 'premium';

export const TIER_RANK: Record<SubscriptionTier, number> = {
  free: 0,
  pro: 1,
  premium: 2,
};

/**
 * Which tier is required for each premium feature.
 * Add entries here as premium features are built.
 */
export const FEATURE_TIERS: Record<string, SubscriptionTier> = {
  // Pro features
  roster_efficiency: 'pro',
  luck_index: 'pro',
  strength_of_schedule: 'pro',
  contender_score: 'pro',

  // Pro features — Prospects
  prospects: 'pro',
  prospect_board: 'pro',

  // Premium features
  age_curve: 'premium',
  draft_value_tracker: 'premium',
  ai_trade_advisor: 'premium',
};

export const TIER_LABELS: Record<SubscriptionTier, string> = {
  free: 'Free',
  pro: 'Pro',
  premium: 'Premium',
};

export { TIER_COLORS } from '@/constants/StatusColors';

/** Returns true if the user's tier meets or exceeds the required tier */
export function hasAccess(userTier: SubscriptionTier, requiredTier: SubscriptionTier): boolean {
  return TIER_RANK[userTier] >= TIER_RANK[requiredTier];
}

/** Returns the required tier for a feature, or 'free' if not gated */
export function featureTier(featureKey: string): SubscriptionTier {
  return FEATURE_TIERS[featureKey] ?? 'free';
}
