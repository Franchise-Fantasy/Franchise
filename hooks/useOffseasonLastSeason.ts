import { useMemo } from "react";

import { useSeasonStandings } from "@/hooks/leagueHistory/seasonResults";

export interface OffseasonLastSeason {
  wins: number;
  losses: number;
  ties: number;
  finalStanding: number | null;
  leagueSize: number | null;
  playoffResult: string | null;
  season: string;
}

/**
 * The user's most-recently-archived season summary for the offseason roster
 * hero — real record, final standing, and playoff result to stand in for the
 * live 0-0 that advance-season zeroes. Gated on `enabled` so it only queries
 * during the offseason. Null until data resolves or when the franchise has no
 * archived season yet.
 */
export function useOffseasonLastSeason(
  leagueId: string | null,
  teamId: string | null,
  enabled: boolean,
): OffseasonLastSeason | null {
  const { data } = useSeasonStandings(enabled ? leagueId : null);
  return useMemo(() => {
    if (!data || !teamId) return null;
    // Rows are ordered season-desc, so the first match for this team is its
    // most recently completed season.
    const mine = data.find((r) => r.team_id === teamId);
    if (!mine) return null;
    const leagueSize = data.filter((r) => r.season === mine.season).length;
    return {
      wins: mine.wins,
      losses: mine.losses,
      ties: mine.ties,
      finalStanding: mine.final_standing ?? null,
      leagueSize: leagueSize || null,
      playoffResult: mine.playoff_result ?? null,
      season: mine.season,
    };
  }, [data, teamId]);
}
