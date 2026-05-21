import { useQuery } from '@tanstack/react-query';

import { queryKeys } from '@/constants/queryKeys';
import { supabase } from '@/lib/supabase';

import { fetchAllMatchups } from './matchups';
import type { H2HData, H2HRecord, RecordEntry } from './types';

// Data source: league_matchups (+ league_schedule for season/week labels),
// merged with team_seasons and stored league_records for all-time records.

export function useAllTimeRecords(leagueId: string | null) {
  return useQuery<RecordEntry[]>({
    queryKey: queryKeys.allTimeRecords(leagueId!),
    queryFn: async () => {
      // Parallel fetch: team_seasons + matchups + teams + stored records
      const [teamSeasonsRes, matchupData, teamsRes, storedRecordsRes] = await Promise.all([
        supabase
          .from('team_seasons')
          .select('team_id, season, wins, losses, points_for, team:teams!team_seasons_team_id_fkey(name)')
          .eq('league_id', leagueId!),
        fetchAllMatchups(leagueId!),
        supabase
          .from('teams')
          .select('id, name')
          .eq('league_id', leagueId!),
        supabase
          .from('league_records')
          .select('record_type, value, team_id, detail, season')
          .eq('league_id', leagueId!),
      ]);
      if (teamSeasonsRes.error) throw teamSeasonsRes.error;
      if (teamsRes.error) throw teamsRes.error;

      const teamSeasons = (teamSeasonsRes.data ?? []).map((row) => ({
        ...row,
        team: Array.isArray(row.team) ? row.team[0] ?? null : row.team,
      }));
      const teamNameMap = new Map((teamsRes.data ?? []).map((t) => [t.id, t.name]));
      const records: RecordEntry[] = [];

      // Most points in a season
      if (teamSeasons.length > 0) {
        const best = teamSeasons.reduce((a, b) => ((b.points_for ?? 0) > (a.points_for ?? 0) ? b : a));
        records.push({
          label: 'Most Points (Season)',
          value: (best.points_for ?? 0).toFixed(1),
          teamName: best.team?.name ?? 'Unknown',
          detail: best.season,
        });
      }

      // Highest scoring week + biggest blowout from matchups
      const { matchups, scheduleMap } = matchupData;
      if (matchups.length > 0 && scheduleMap) {
        // Highest single-week score
        let bestScore = 0;
        let bestScoreTeamId = '';
        let bestScoreScheduleId = '';
        let bestBlowoutMargin = 0;
        let blowoutWinnerId = '';
        let blowoutLoserId = '';
        let blowoutScheduleId = '';

        for (const m of matchups) {
          if (!m.away_team_id) continue; // skip byes

          // Highest score
          if (m.home_score > bestScore) {
            bestScore = m.home_score;
            bestScoreTeamId = m.home_team_id;
            bestScoreScheduleId = m.schedule_id;
          }
          if (m.away_score > bestScore) {
            bestScore = m.away_score;
            bestScoreTeamId = m.away_team_id!;
            bestScoreScheduleId = m.schedule_id;
          }

          // Biggest blowout
          const margin = Math.abs(m.home_score - m.away_score);
          if (margin > bestBlowoutMargin) {
            bestBlowoutMargin = margin;
            blowoutWinnerId = m.home_score > m.away_score ? m.home_team_id : m.away_team_id!;
            blowoutLoserId = m.home_score > m.away_score ? m.away_team_id! : m.home_team_id;
            blowoutScheduleId = m.schedule_id;
          }
        }

        if (bestScore > 0) {
          const sched = scheduleMap.get(bestScoreScheduleId);
          records.push({
            label: 'Highest Scoring Week',
            value: bestScore.toFixed(1),
            teamName: teamNameMap.get(bestScoreTeamId) ?? 'Unknown',
            detail: sched ? `Week ${sched.week_number}, ${sched.season}` : '',
          });
        }

        if (bestBlowoutMargin > 0) {
          const sched = scheduleMap.get(blowoutScheduleId);
          const loserName = teamNameMap.get(blowoutLoserId) ?? '?';
          const schedPart = sched ? ` • Week ${sched.week_number}, ${sched.season}` : '';
          records.push({
            label: 'Biggest Blowout',
            value: `+${bestBlowoutMargin.toFixed(1)}`,
            teamName: teamNameMap.get(blowoutWinnerId) ?? '?',
            detail: `over ${loserName}${schedPart}`,
          });
        }
      }

      // Merge stored high-water-mark records (e.g. highest scoring day)
      const storedRecords = storedRecordsRes.data ?? [];
      for (const sr of storedRecords) {
        if (sr.record_type === 'highest_scoring_day') {
          records.push({
            label: 'Highest Scoring Day',
            value: Number(sr.value).toFixed(1),
            teamName: teamNameMap.get(sr.team_id) ?? 'Unknown',
            detail: sr.detail ?? '',
          });
        }
      }

      return records;
    },
    enabled: !!leagueId,
    staleTime: 1000 * 60 * 10,
  });
}

export function useHeadToHead(leagueId: string | null) {
  return useQuery<H2HData>({
    queryKey: queryKeys.headToHead(leagueId!),
    queryFn: async () => {
      const [matchupData, teamsRes] = await Promise.all([
        fetchAllMatchups(leagueId!),
        supabase.from('teams').select('id, name, tricode').eq('league_id', leagueId!),
      ]);
      if (teamsRes.error) throw teamsRes.error;

      const teams = (teamsRes.data ?? []).map((t) => ({ id: t.id, name: t.name, tricode: t.tricode ?? null }));
      const records: Record<string, H2HRecord> = {};
      const { matchups, scheduleMap } = matchupData;

      // Enrich matchups with season/week
      const enriched = matchups
        .filter((m) => m.away_team_id) // exclude byes
        .map((m) => {
          const sched = scheduleMap?.get(m.schedule_id);
          return { ...m, season: sched?.season ?? '', week_number: sched?.week_number ?? 0 };
        });

      // Build NxN records
      for (const m of enriched) {
        const homeKey = `${m.home_team_id}_${m.away_team_id}`;
        const awayKey = `${m.away_team_id}_${m.home_team_id}`;
        if (!records[homeKey]) records[homeKey] = { wins: 0, losses: 0, ties: 0 };
        if (!records[awayKey]) records[awayKey] = { wins: 0, losses: 0, ties: 0 };

        if (m.winner_team_id === m.home_team_id) {
          records[homeKey].wins++;
          records[awayKey].losses++;
        } else if (m.winner_team_id === m.away_team_id) {
          records[homeKey].losses++;
          records[awayKey].wins++;
        } else {
          records[homeKey].ties++;
          records[awayKey].ties++;
        }
      }

      return { teams, records, matchups: enriched };
    },
    enabled: !!leagueId,
    staleTime: 1000 * 60 * 10,
  });
}
