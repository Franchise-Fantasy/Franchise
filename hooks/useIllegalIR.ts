import { useQuery } from "@tanstack/react-query";
import { fetchIllegalIRPlayers, IllegalIRPlayer } from "@/utils/illegalIR";

/**
 * Returns the list of players on this team who are in IR slots but no longer
 * qualify for IR (healthy/active/probable). While this list is non-empty the
 * team is locked out of roster moves.
 */
export function useIllegalIR(
  leagueId: string | null | undefined,
  teamId: string | null | undefined,
) {
  return useQuery<IllegalIRPlayer[]>({
    queryKey: ["illegal-ir", leagueId, teamId],
    queryFn: () => fetchIllegalIRPlayers(leagueId!, teamId!),
    enabled: !!leagueId && !!teamId,
    staleTime: 10_000,
  });
}
