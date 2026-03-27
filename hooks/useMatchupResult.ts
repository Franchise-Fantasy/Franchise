import { useAppState } from '@/context/AppStateProvider';
import { supabase } from '@/lib/supabase';
import { useQuery } from '@tanstack/react-query';

export interface MatchupResult {
  id: string;
  weekNumber: number;
  userTeamName: string;
  opponentTeamName: string;
  userScore: number;
  opponentScore: number;
  won: boolean;
  lost: boolean;
  tied: boolean;
  /** Only present for category leagues */
  userCatWins?: number;
  opponentCatWins?: number;
  catTies?: number;
}

/**
 * Fetches the most recently finalized matchup for the current team.
 * Used by MatchupResultModal to show a one-time result on app open.
 */
export function useMatchupResult(scoringType: string | null | undefined) {
  const { leagueId, teamId } = useAppState();

  return useQuery<MatchupResult | null>({
    queryKey: ['matchupResult', leagueId, teamId],
    queryFn: async () => {
      if (!leagueId || !teamId) return null;

      // Fetch the most recent finalized matchup for this team, scoped to league via schedule
      const { data: matchup, error } = await supabase
        .from('league_matchups')
        .select(`
          id, home_team_id, away_team_id, home_score, away_score,
          winner_team_id, home_category_wins, away_category_wins,
          category_ties, week_number,
          league_schedule!inner(league_id)
        `)
        .eq('league_schedule.league_id', leagueId)
        .eq('is_finalized', true)
        .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`)
        .order('week_number', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      if (!matchup) return null;

      const isHome = matchup.home_team_id === teamId;
      const opponentId = isHome ? matchup.away_team_id : matchup.home_team_id;

      // Bye week — no opponent, no result to show
      if (!opponentId) return null;

      // Fetch both team names
      const { data: teams, error: teamsErr } = await supabase
        .from('teams')
        .select('id, name')
        .in('id', [teamId, opponentId]);
      if (teamsErr) throw teamsErr;

      const userTeam = teams?.find((t) => t.id === teamId);
      const opponentTeam = teams?.find((t) => t.id === opponentId);

      const isCategory = scoringType === 'category';

      return {
        id: matchup.id,
        weekNumber: matchup.week_number,
        userTeamName: userTeam?.name ?? 'Your Team',
        opponentTeamName: opponentTeam?.name ?? 'Opponent',
        userScore: isHome ? matchup.home_score : matchup.away_score,
        opponentScore: isHome ? matchup.away_score : matchup.home_score,
        won: matchup.winner_team_id === teamId,
        lost: matchup.winner_team_id !== null && matchup.winner_team_id !== teamId,
        tied: matchup.winner_team_id === null,
        ...(isCategory && {
          userCatWins: isHome ? matchup.home_category_wins : matchup.away_category_wins,
          opponentCatWins: isHome ? matchup.away_category_wins : matchup.home_category_wins,
          catTies: matchup.category_ties,
        }),
      };
    },
    enabled: !!leagueId && !!teamId,
    staleTime: 1000 * 60 * 5,
  });
}
