import { queryKeys } from '@/constants/queryKeys';
import { supabase } from '@/lib/supabase';
import { useQuery } from '@tanstack/react-query';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ChampionEntry {
  season: string;
  champion: { id: string; name: string } | null;
  runnerUp: { id: string; name: string } | null;
}

export interface TeamSeasonRow {
  id: string;
  team_id: string;
  season: string;
  wins: number;
  losses: number;
  ties: number;
  points_for: number;
  points_against: number;
  final_standing: number;
  playoff_result: string;
  team: { id: string; name: string };
}

export interface RecordEntry {
  label: string;
  value: string;
  teamName: string;
  detail: string; // e.g. season or "Week 4, 2025-26"
}

export interface H2HRecord {
  wins: number;
  losses: number;
  ties: number;
}

export interface MatchupRow {
  id: string;
  schedule_id: string;
  home_team_id: string;
  away_team_id: string | null;
  home_score: number;
  away_score: number;
  winner_team_id: string | null;
  is_finalized: boolean;
  playoff_round: number | null;
}

export interface ScheduleRow {
  id: string;
  season: string;
  week_number: number;
}

export interface H2HData {
  teams: Array<{ id: string; name: string; tricode: string | null }>;
  records: Record<string, H2HRecord>; // key: `${teamA}_${teamB}`
  matchups: Array<MatchupRow & { season: string; week_number: number }>;
}

export interface DraftSummary {
  id: string;
  season: string;
  type: string;
  draft_type: string;
  rounds: number;
  status: string;
}

export interface DraftHistoryPick {
  id: string;
  draft_id: string;
  pick_number: number;
  round: number;
  slot_number: number;
  current_team_id: string;
  original_team_id: string;
  player_name: string | null;
  player_position: string | null;
  current_team_name: string;
  original_team_name: string;
  isTraded: boolean;
}

// ─── Hooks ───────────────────────────────────────────────────────────────────

export function useChampions(leagueId: string | null) {
  return useQuery<ChampionEntry[]>({
    queryKey: queryKeys.leagueChampions(leagueId!),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('team_seasons')
        .select('season, playoff_result, team:teams!team_seasons_team_id_fkey(id, name)')
        .eq('league_id', leagueId!)
        .in('playoff_result', ['champion', 'runner_up'])
        .order('season', { ascending: true })
        .limit(200);
      if (error) throw error;

      const byS = new Map<string, ChampionEntry>();
      for (const row of (data ?? []) as any[]) {
        if (!byS.has(row.season)) {
          byS.set(row.season, { season: row.season, champion: null, runnerUp: null });
        }
        const entry = byS.get(row.season)!;
        if (row.playoff_result === 'champion') entry.champion = row.team;
        else entry.runnerUp = row.team;
      }
      return [...byS.values()];
    },
    enabled: !!leagueId,
    staleTime: 1000 * 60 * 10,
  });
}

export function useSeasonStandings(leagueId: string | null) {
  return useQuery<TeamSeasonRow[]>({
    queryKey: queryKeys.seasonStandings(leagueId!),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('team_seasons')
        .select('id, team_id, season, wins, losses, ties, points_for, points_against, final_standing, playoff_result, team:teams!team_seasons_team_id_fkey(id, name)')
        .eq('league_id', leagueId!)
        .order('season', { ascending: false })
        .order('final_standing', { ascending: true })
        .limit(1000);
      if (error) throw error;
      return (data ?? []) as unknown as TeamSeasonRow[];
    },
    enabled: !!leagueId,
    staleTime: 1000 * 60 * 10,
  });
}

/** Fetches all finalized matchups across all seasons for the league */
async function fetchAllMatchups(leagueId: string) {
  // Step 1: get all schedule entries for this league
  const { data: schedules, error: schedErr } = await supabase
    .from('league_schedule')
    .select('id, season, week_number')
    .eq('league_id', leagueId)
    .order('week_number', { ascending: true });
  if (schedErr) throw schedErr;
  if (!schedules || schedules.length === 0) return { schedules: [], matchups: [] };

  const scheduleIds = schedules.map((s) => s.id);
  const scheduleMap = new Map(schedules.map((s) => [s.id, s]));

  // Step 2: fetch all finalized matchups
  const { data: matchups, error: matchErr } = await supabase
    .from('league_matchups')
    .select('id, schedule_id, home_team_id, away_team_id, home_score, away_score, winner_team_id, is_finalized, playoff_round')
    .in('schedule_id', scheduleIds)
    .eq('is_finalized', true);
  if (matchErr) throw matchErr;

  return { schedules, matchups: matchups ?? [], scheduleMap };
}

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

      const teamSeasons = (teamSeasonsRes.data ?? []) as any[];
      const teamNameMap = new Map((teamsRes.data ?? []).map((t) => [t.id, t.name]));
      const records: RecordEntry[] = [];

      // Most wins in a season
      if (teamSeasons.length > 0) {
        const best = teamSeasons.reduce((a, b) => (b.wins > a.wins ? b : a));
        records.push({
          label: 'Most Wins (Season)',
          value: `${best.wins}-${best.losses}`,
          teamName: best.team?.name ?? 'Unknown',
          detail: best.season,
        });
      }

      // Most points in a season
      if (teamSeasons.length > 0) {
        const best = teamSeasons.reduce((a, b) => (b.points_for > a.points_for ? b : a));
        records.push({
          label: 'Most Points (Season)',
          value: best.points_for.toFixed(1),
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
          records.push({
            label: 'Biggest Blowout',
            value: `+${bestBlowoutMargin.toFixed(1)}`,
            teamName: `${teamNameMap.get(blowoutWinnerId) ?? '?'} over ${teamNameMap.get(blowoutLoserId) ?? '?'}`,
            detail: sched ? `Week ${sched.week_number}, ${sched.season}` : '',
          });
        }
      }

      // Merge stored high-water-mark records (e.g. highest scoring day)
      const storedRecords = (storedRecordsRes.data ?? []) as any[];
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

export function useDraftHistory(leagueId: string | null) {
  return useQuery<{ drafts: DraftSummary[]; picks: DraftHistoryPick[] }>({
    queryKey: queryKeys.draftHistory(leagueId!),
    queryFn: async () => {
      // Fetch completed drafts
      const { data: drafts, error: draftErr } = await supabase
        .from('drafts')
        .select('id, season, type, draft_type, rounds, status')
        .eq('league_id', leagueId!)
        .eq('status', 'complete')
        .order('season', { ascending: false });
      if (draftErr) throw draftErr;
      if (!drafts || drafts.length === 0) return { drafts: [], picks: [] };

      const draftIds = drafts.map((d) => d.id);

      // Fetch all picks for those drafts
      const { data: picks, error: pickErr } = await supabase
        .from('draft_picks')
        .select(`
          id, draft_id, pick_number, round, slot_number,
          current_team_id, original_team_id, player_id,
          player:players!draft_picks_player_id_fkey(name, position),
          current_team:teams!draft_picks_current_team_id_fkey(name),
          original_team:teams!draft_picks_original_team_id_fkey(name)
        `)
        .in('draft_id', draftIds)
        .not('player_id', 'is', null)
        .order('pick_number', { ascending: true });
      if (pickErr) throw pickErr;

      const mappedPicks: DraftHistoryPick[] = (picks ?? []).map((p: any) => ({
        id: p.id,
        draft_id: p.draft_id,
        pick_number: p.pick_number,
        round: p.round,
        slot_number: p.slot_number,
        current_team_id: p.current_team_id,
        original_team_id: p.original_team_id,
        player_name: p.player?.name ?? null,
        player_position: p.player?.position ?? null,
        current_team_name: p.current_team?.name ?? 'Unknown',
        original_team_name: p.original_team?.name ?? 'Unknown',
        isTraded: p.current_team_id !== p.original_team_id,
      }));

      return { drafts: drafts as DraftSummary[], picks: mappedPicks };
    },
    enabled: !!leagueId,
    staleTime: 1000 * 60 * 10,
  });
}
