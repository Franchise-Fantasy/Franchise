import { useQuery } from '@tanstack/react-query';

import { supabase } from '@/lib/supabase';

/**
 * Pro teams with a game inside a league week (NFL bye detection). A team on
 * bye simply has no game_schedule row in the week's start..end range, so the
 * hook returns the PLAYING set and `isOnBye` is a set-miss — no hardcoded
 * 32-team list to maintain.
 *
 * NFL-only by design (basketball has no league-wide byes); disabled for other
 * sports so it costs nothing there.
 */
export function useTeamByes(
  sport: string | null | undefined,
  weekStart: string | null | undefined,
  weekEnd: string | null | undefined,
): { playingTeams: Set<string> | undefined; isOnBye: (tricode: string | null | undefined) => boolean } {
  const enabled = sport === 'nfl' && !!weekStart && !!weekEnd;

  const { data: playingTeams } = useQuery<Set<string>>({
    queryKey: ['teamByes', sport, weekStart, weekEnd],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('game_schedule')
        .select('home_team, away_team')
        .eq('sport', sport!)
        .gte('game_date', weekStart!)
        .lte('game_date', weekEnd!);
      if (error) throw error;
      const set = new Set<string>();
      for (const g of data ?? []) {
        if (g.home_team) set.add(g.home_team);
        if (g.away_team) set.add(g.away_team);
      }
      return set;
    },
    enabled,
    staleTime: 1000 * 60 * 60, // schedule shifts are rare intra-week
  });

  return {
    playingTeams,
    // Only report a bye once the playing set has loaded — an in-flight query
    // must not flash every player as BYE.
    isOnBye: (tricode) =>
      enabled && !!playingTeams && !!tricode && !playingTeams.has(tricode),
  };
}
