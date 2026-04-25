import { useQuery, useQueryClient } from '@tanstack/react-query';

import { queryKeys } from '@/constants/queryKeys';
import {
  SubscriptionTier,
  TIER_RANK,
  hasAccess,
  featureTier,
} from '@/constants/Subscriptions';
import { useAppState } from '@/context/AppStateProvider';
import { useSession } from '@/context/AuthProvider';
import { supabase } from '@/lib/supabase';


/**
 * After a purchase, the RevenueCat webhook writes `user_subscriptions` /
 * `league_subscriptions`. Poll until that row reflects the expected tier
 * (and period, if provided) so the UI doesn't flicker back to the paywall
 * or show "Switch to Annual" after a monthly→annual swap. Resolves true
 * when the DB catches up, false on timeout.
 */
export async function waitForSubscriptionChange(opts: {
  userId: string | null | undefined;
  leagueId: string | null | undefined;
  leagueMode: boolean;
  expectedTier: SubscriptionTier;
  /** "monthly" | "annual" — only matters for same-tier period swaps. */
  expectedPeriod?: string;
  /** Period we're swapping away from; resolves as soon as row no longer matches. */
  previousPeriod?: string;
  timeoutMs?: number;
  intervalMs?: number;
}): Promise<boolean> {
  const {
    userId,
    leagueId,
    leagueMode,
    expectedTier,
    expectedPeriod,
    previousPeriod,
    timeoutMs = 15000,
    intervalMs = 1000,
  } = opts;

  const table = leagueMode ? 'league_subscriptions' : 'user_subscriptions';
  const column = leagueMode ? 'league_id' : 'user_id';
  const rowId = leagueMode ? leagueId : userId;
  if (!rowId) return false;

  const deadline = Date.now() + timeoutMs;
  const expectedRank = TIER_RANK[expectedTier];

  while (Date.now() < deadline) {
    const { data } = await supabase
      .from(table)
      .select('tier, status, period_type')
      // `column` switches between league_id/user_id depending on table — typed eq can't model this
      .eq(column as 'status', rowId)
      .eq('status', 'active')
      .maybeSingle();

    const tier = data?.tier as SubscriptionTier | undefined;
    const period = data?.period_type as string | undefined;

    if (tier) {
      const tierOk = TIER_RANK[tier] > expectedRank
        || (TIER_RANK[tier] === expectedRank
          && (!expectedPeriod || period === expectedPeriod)
          && (!previousPeriod || period !== previousPeriod));
      if (tierOk) return true;
    }

    await new Promise(r => setTimeout(r, intervalMs));
  }
  return false;
}

/** @deprecated use waitForSubscriptionChange */
export const waitForTierUpgrade = waitForSubscriptionChange;

export function useSubscription() {
  const session = useSession();
  const { leagueId } = useAppState();
  const queryClient = useQueryClient();
  const userId = session?.user?.id;

  const { data: individualSub, isLoading: indLoading } = useQuery({
    queryKey: queryKeys.userSubscription(userId!),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_subscriptions')
        .select('tier, status, expires_at, period_type')
        .eq('user_id', userId!)
        .eq('status', 'active')
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      if (data.expires_at && new Date(data.expires_at) < new Date()) return null;
      return data;
    },
    enabled: !!userId,
    staleTime: 1000 * 60 * 5,
  });

  const { data: leagueSub, isLoading: leagueLoading } = useQuery({
    queryKey: queryKeys.leagueSubscription(leagueId!),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('league_subscriptions')
        .select('tier, status, expires_at, period_type')
        .eq('league_id', leagueId!)
        .eq('status', 'active')
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      if (data.expires_at && new Date(data.expires_at) < new Date()) return null;
      return data;
    },
    enabled: !!leagueId,
    staleTime: 1000 * 60 * 5,
  });

  const individualTier = (individualSub?.tier as SubscriptionTier) ?? null;
  const individualPeriod = (individualSub?.period_type as string) ?? null;
  const leagueTier = (leagueSub?.tier as SubscriptionTier) ?? null;
  const leaguePeriod = (leagueSub?.period_type as string) ?? null;

  // Effective tier = max of individual and league
  let tier: SubscriptionTier = 'free';
  if (individualTier && leagueTier) {
    tier = TIER_RANK[individualTier] >= TIER_RANK[leagueTier]
      ? individualTier
      : leagueTier;
  } else if (individualTier) {
    tier = individualTier;
  } else if (leagueTier) {
    tier = leagueTier;
  }

  const isLoading = indLoading || leagueLoading;

  /** Force re-fetch subscription data (call after a purchase completes). */
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['userSubscription'] });
    queryClient.invalidateQueries({ queryKey: ['leagueSubscription'] });
  };

  return {
    tier,
    individualTier,
    individualPeriod,
    leagueTier,
    leaguePeriod,
    isLoading,
    invalidate,
    canAccess: (feature: string) => hasAccess(tier, featureTier(feature)),
    meetsMinTier: (minTier: SubscriptionTier) => hasAccess(tier, minTier),
  };
}
