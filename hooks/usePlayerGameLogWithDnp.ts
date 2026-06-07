import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { getCurrentSeason, getPreviousSeason, getSeasonEnd, type Sport } from '@/constants/LeagueDefaults';
import { supabase } from '@/lib/supabase';
import { PlayerGameLog } from '@/types/player';

// Injured/inactive players are omitted from BDL's box score, so poll-live-stats
// never writes a player_games row for the games they sat out — those days then
// vanish from the game log entirely (vs a healthy DNP-CD player, who gets a
// real min=0 row and shows greyed). This hook backfills those gaps for DISPLAY:
// it fetches the player's pro-team final games this season and synthesizes a
// zeroed (min=0) row for any final date the player has no game_log entry, so the
// log reads "game happened, player out" instead of silently skipping the date.
// Only the game-log table consumes the merged list — season averages / windowed
// stats keep reading the raw gameLog (and already skip min===0 rows anyway).
export function usePlayerGameLogWithDnp(
  proTeam: string | null | undefined,
  sport: Sport,
  gameLog: PlayerGameLog[] | undefined,
): PlayerGameLog[] | undefined {
  const currentSeason = getCurrentSeason(sport);
  const priorEnd = getSeasonEnd(sport, getPreviousSeason(sport));

  const { data: teamFinals } = useQuery({
    queryKey: ['playerDnpSchedule', sport, currentSeason, proTeam ?? ''],
    queryFn: async () => {
      const today = new Date().toISOString().slice(0, 10);
      let query = supabase
        .from('game_schedule')
        .select('game_date, home_team, away_team')
        .eq('sport', sport)
        .eq('season', currentSeason)
        .eq('status', 'final')
        .or(`home_team.eq.${proTeam},away_team.eq.${proTeam}`)
        .lt('game_date', today);
      // Floor at the prior season's end — same window the game log itself uses.
      if (priorEnd) query = query.gt('game_date', priorEnd);
      // NBA stores games twice (legacy NBA-official `00%` ids + canonical BDL
      // ids); keep only the canonical rows so dates aren't doubled. WNBA has a
      // single id scheme.
      if (sport === 'nba') query = query.not('game_id', 'like', '00%');
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []).map((g) => ({
        game_date: g.game_date as string,
        matchup: g.home_team === proTeam ? `vs ${g.away_team}` : `@${g.home_team}`,
      }));
    },
    enabled: !!proTeam,
    staleTime: 1000 * 60 * 30,
  });

  return useMemo(() => {
    if (!gameLog || !teamFinals || teamFinals.length === 0) return gameLog;
    const haveDates = new Set(
      gameLog.map((g) => g.game_date).filter((d): d is string => !!d),
    );
    const dnpRows: PlayerGameLog[] = teamFinals
      .filter((g) => !haveDates.has(g.game_date))
      .map((g) => ({
        id: `dnp-${g.game_date}`,
        game_id: `dnp-${g.game_date}`,
        matchup: g.matchup,
        game_date: g.game_date,
        min: 0,
        pts: 0,
        reb: 0,
        ast: 0,
        stl: 0,
        blk: 0,
        tov: 0,
        fgm: 0,
        fga: 0,
        '3pm': 0,
        '3pa': 0,
        ftm: 0,
        fta: 0,
        pf: 0,
        double_double: false,
        triple_double: false,
      }));
    if (dnpRows.length === 0) return gameLog;
    return [...gameLog, ...dnpRows].sort((a, b) =>
      (b.game_date ?? '').localeCompare(a.game_date ?? ''),
    );
  }, [gameLog, teamFinals]);
}
