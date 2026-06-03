import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "@/constants/queryKeys";
import { supabase } from "@/lib/supabase";

/**
 * Resolves a league's scoring_type and the derived `isCategories` flag.
 * Categories leagues don't have fantasy points, so callers use `isCategories`
 * to suppress FPTS aggregates, sorts, and columns.
 *
 * Defaults to `'points'` while loading or when no league is active so callers
 * never block — the FPTS-bearing UI is the safe default for points leagues.
 */
export function useLeagueScoringType(leagueId: string | null | undefined) {
  const { data: scoringType } = useQuery({
    queryKey: queryKeys.leagueScoringType(leagueId ?? ""),
    queryFn: async (): Promise<string> => {
      const { data } = await supabase
        .from("leagues")
        .select("scoring_type")
        .eq("id", leagueId!)
        .single();
      return data?.scoring_type ?? "points";
    },
    enabled: !!leagueId,
    staleTime: 1000 * 60 * 30,
  });

  return {
    scoringType: scoringType ?? "points",
    isCategories: scoringType === "h2h_categories",
  };
}
