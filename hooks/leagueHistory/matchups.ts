import { supabase } from '@/lib/supabase';

/** Fetches all finalized matchups across all seasons for the league */
export async function fetchAllMatchups(leagueId: string) {
  // Both tables have league_id, so we can fetch them in parallel.
  const [schedRes, matchRes] = await Promise.all([
    supabase
      .from('league_schedule')
      .select('id, season, week_number')
      .eq('league_id', leagueId)
      .order('week_number', { ascending: true }),
    supabase
      .from('league_matchups')
      .select('id, schedule_id, home_team_id, away_team_id, home_score, away_score, winner_team_id, is_finalized, playoff_round')
      .eq('league_id', leagueId)
      .eq('is_finalized', true)
      .limit(2000),
  ]);
  if (schedRes.error) throw schedRes.error;
  if (matchRes.error) throw matchRes.error;

  const schedules = schedRes.data ?? [];
  if (schedules.length === 0) return { schedules: [], matchups: [] };
  const scheduleMap = new Map(schedules.map((s) => [s.id, s]));

  return { schedules, matchups: matchRes.data ?? [], scheduleMap };
}
