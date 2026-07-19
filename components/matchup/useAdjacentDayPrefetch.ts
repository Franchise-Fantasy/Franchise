import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import {
  fetchMatchupDataById,
  fetchWeekMatchupRaw,
  type Week,
} from "@/components/matchup/matchupData";
import { type Sport } from "@/constants/LeagueDefaults";
import { queryKeys } from "@/constants/queryKeys";
import { ScoringWeight } from "@/types/player";
import { addDays } from "@/utils/dates";
import { fetchNbaScheduleForDate } from "@/utils/nba/nbaSchedule";

/** Prefetch the matchup + schedule data for the days adjacent to the one on
 *  screen, so day-picker swipes don't pop in. The own-matchup entry is
 *  WEEK-keyed raw data, so it only actually fetches when an adjacent day
 *  crosses a week (or live/past) boundary — same-key days are already cached
 *  and the prefetch no-ops. */
export function useAdjacentDayPrefetch(params: {
  weeks: Week[] | undefined;
  selectedDate: string;
  today: string;
  teamId: string | null;
  leagueId: string | null;
  scoring: ScoringWeight[] | undefined;
  sport: Sport | undefined;
  selectedMatchupId: string | null;
  isViewingOwnMatchup: boolean;
  /** Weekly sports navigate week-to-week, not day-to-day, so there are no
   *  adjacent days to prefetch — pass false to skip. */
  enabled?: boolean;
}) {
  const {
    weeks, selectedDate, today, teamId, leagueId, scoring, sport,
    selectedMatchupId, isViewingOwnMatchup, enabled = true,
  } = params;
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled) return;
    if (!weeks || !teamId || !leagueId || !scoring || scoring.length === 0)
      return;
    const adjacent = [
      addDays(selectedDate, -1),
      addDays(selectedDate, 1),
      addDays(selectedDate, 2),
    ];

    for (const day of adjacent) {
      const wk = weeks.find((w) => w.start_date <= day && day <= w.end_date);
      if (!wk) continue;

      const dayMode = day >= today ? "live" : "past";
      queryClient.prefetchQuery({
        queryKey: queryKeys.weekMatchup(leagueId!, wk.id, teamId, dayMode),
        queryFn: () => fetchWeekMatchupRaw(wk, teamId, leagueId, day >= today, sport),
        staleTime: 1000 * 60 * 2,
      });

      // Currently-viewed matchup (when looking at someone else's) — without
      // this prefetch, swiping days while viewing another matchup hits a
      // cold cache and pops the score block.
      if (selectedMatchupId && !isViewingOwnMatchup) {
        queryClient.prefetchQuery({
          queryKey: queryKeys.matchupById(selectedMatchupId, day),
          queryFn: () =>
            fetchMatchupDataById(selectedMatchupId, wk, leagueId, day, scoring, sport),
          staleTime: 1000 * 60 * 2,
        });
      }

      queryClient.prefetchQuery({
        queryKey: [...queryKeys.futureSchedule(day), sport],
        queryFn: () => fetchNbaScheduleForDate(day, sport),
        staleTime: 1000 * 60 * 60,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, selectedDate, weeks, teamId, leagueId, scoring, sport, selectedMatchupId, isViewingOwnMatchup]);
}
