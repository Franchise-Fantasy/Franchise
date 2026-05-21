import { useQuery } from '@tanstack/react-query';

import { queryKeys } from '@/constants/queryKeys';
import { supabase } from '@/lib/supabase';

import type { BracketHistoryData, BracketSlotHistory } from './types';

// Data source: playoff_bracket (with league_matchups join for per-slot scores).

/**
 * Historical playoff brackets — every completed bracket for the league,
 * grouped by season, with team data and per-slot scores. Powers the
 * Brackets segment of the League History page.
 */
export function useBracketHistory(leagueId: string | null) {
  return useQuery<BracketHistoryData>({
    queryKey: queryKeys.bracketHistory(leagueId!),
    queryFn: async () => {
      // Parallel: all bracket slots (with matchup scores joined) + all teams.
      const [bracketRes, teamsRes] = await Promise.all([
        supabase
          .from('playoff_bracket')
          .select(
            'id, season, round, bracket_position, matchup_id, team_a_id, team_a_seed, team_b_id, team_b_seed, winner_id, is_bye, is_third_place, matchup:league_matchups!playoff_bracket_matchup_id_fkey(home_team_id, home_score, away_score)',
          )
          .eq('league_id', leagueId!)
          .order('season', { ascending: false })
          .order('round', { ascending: true })
          .order('bracket_position', { ascending: true }),
        supabase
          .from('teams')
          .select('id, name, tricode, logo_key')
          .eq('league_id', leagueId!),
      ]);
      if (bracketRes.error) throw bracketRes.error;
      if (teamsRes.error) throw teamsRes.error;

      const teamMap = new Map(
        (teamsRes.data ?? []).map((t) => [
          t.id,
          { id: t.id, name: t.name, tricode: t.tricode ?? null, logo_key: t.logo_key ?? null },
        ]),
      );

      const bracketsBySeason = new Map<string, BracketSlotHistory[]>();
      for (const row of bracketRes.data ?? []) {
        const m = Array.isArray(row.matchup) ? row.matchup[0] ?? null : row.matchup;
        let team_a_score: number | null = null;
        let team_b_score: number | null = null;
        if (m) {
          const homeIsA = m.home_team_id === row.team_a_id;
          team_a_score = homeIsA ? m.home_score : m.away_score;
          team_b_score = homeIsA ? m.away_score : m.home_score;
        }
        const slot: BracketSlotHistory = {
          id: row.id,
          season: row.season,
          round: row.round,
          bracket_position: row.bracket_position,
          matchup_id: row.matchup_id,
          team_a_id: row.team_a_id,
          team_a_seed: row.team_a_seed,
          team_a_score,
          team_b_id: row.team_b_id,
          team_b_seed: row.team_b_seed,
          team_b_score,
          winner_id: row.winner_id,
          is_bye: row.is_bye,
          is_third_place: row.is_third_place,
        };
        if (!bracketsBySeason.has(row.season)) bracketsBySeason.set(row.season, []);
        bracketsBySeason.get(row.season)!.push(slot);
      }

      const seasons = [...bracketsBySeason.keys()]; // already ordered DESC from query

      return { bracketsBySeason, seasons, teamMap };
    },
    enabled: !!leagueId,
    staleTime: 1000 * 60 * 10,
  });
}
