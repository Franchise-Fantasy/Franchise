import { useAppState } from '@/context/AppStateProvider';
import { useSession } from '@/context/AuthProvider';
import {
  SubscriptionTier,
  TIER_RANK,
  hasAccess,
  featureTier,
} from '@/constants/Subscriptions';
import { supabase } from '@/lib/supabase';
import { useQuery } from '@tanstack/react-query';

export function useSubscription() {
  const session = useSession();
  const { leagueId } = useAppState();
  const userId = session?.user?.id;

  const { data: individualSub, isLoading: indLoading } = useQuery({
    queryKey: ['userSubscription', userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_subscriptions')
        .select('tier, status, expires_at')
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
    queryKey: ['leagueSubscription', leagueId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('league_subscriptions')
        .select('tier, status, expires_at')
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
  const leagueTier = (leagueSub?.tier as SubscriptionTier) ?? null;

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

  return {
    tier,
    individualTier,
    leagueTier,
    isLoading,
    canAccess: (feature: string) => hasAccess(tier, featureTier(feature)),
    meetsMinTier: (minTier: SubscriptionTier) => hasAccess(tier, minTier),
  };
}
