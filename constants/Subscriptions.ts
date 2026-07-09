export type SubscriptionTier = 'free' | 'pro' | 'premium';

/**
 * Master paywall switch. Pre-launch there is nothing to sell, so the paywall is
 * OFF: `hasAccess` grants every feature to everyone (all PremiumGates open, and
 * their upgrade CTAs never render), and the standalone paywall UI is hidden
 * wherever this flag is checked (Profile → Subscription section, league-info's
 * "Upgrade League" action). Flip to `true` for launch to restore tier gating —
 * no other code change required. Typed `boolean` (not the `false` literal) so
 * both branches stay reachable to the type checker.
 */
export const PAYWALL_ENABLED: boolean = false;

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

/** Returns true if the user's tier meets or exceeds the required tier. While
 *  the paywall is disabled, everyone is treated as fully entitled. */
export function hasAccess(userTier: SubscriptionTier, requiredTier: SubscriptionTier): boolean {
  if (!PAYWALL_ENABLED) return true;
  return TIER_RANK[userTier] >= TIER_RANK[requiredTier];
}

/** Returns the required tier for a feature, or 'free' if not gated */
export function featureTier(featureKey: string): SubscriptionTier {
  return FEATURE_TIERS[featureKey] ?? 'free';
}
