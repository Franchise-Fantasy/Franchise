import { useQuery } from "@tanstack/react-query";

import { fetchOverCapState, type OverCapState } from "@/utils/roster/overCap";

/**
 * Returns the team's over-capacity state. While `isOver === true` the team
 * is locked out of add / waiver-claim / trade-into-roster actions until
 * they drop a player or move someone to TAXI/IR. Parallels `useIllegalIR`.
 */
export function useOverCap(
  leagueId: string | null | undefined,
  teamId: string | null | undefined,
) {
  return useQuery<OverCapState>({
    queryKey: ["over-cap", leagueId, teamId],
    queryFn: () => fetchOverCapState(leagueId!, teamId!),
    enabled: !!leagueId && !!teamId,
    staleTime: 10_000,
  });
}
