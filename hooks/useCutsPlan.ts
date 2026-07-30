import { useQuery } from "@tanstack/react-query";

import { fetchTeamCutsPlan, type CutsPlan } from "@/utils/roster/rosterCuts";

/**
 * The team's pending roster-cuts plan — which players get stashed to taxi and
 * which get dropped once the league's cuts deadline passes.
 *
 * Feeds the at-risk preview in OverCapBanner, so a GM sees the consequence
 * before it happens. Only meaningful while a deadline is armed and the team is
 * actually over cap; callers gate `enabled` on both. Parallels `useOverCap`.
 */
export function useCutsPlan(
  leagueId: string | null | undefined,
  teamId: string | null | undefined,
  enabled: boolean,
) {
  return useQuery<CutsPlan>({
    queryKey: ["cutsPlan", leagueId, teamId],
    queryFn: () => fetchTeamCutsPlan(leagueId!, teamId!),
    enabled: !!leagueId && !!teamId && enabled,
    staleTime: 10_000,
  });
}
