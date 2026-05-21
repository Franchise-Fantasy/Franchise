import { useQuery } from '@tanstack/react-query';

import { formatSeason, getCurrentSeason, parseSeasonStartYear, type Sport } from '@/constants/LeagueDefaults';
import { queryKeys } from '@/constants/queryKeys';
import { supabase } from '@/lib/supabase';

// Data source: draft_picks owned by a team (with drafts join + reverse-standings
// derivation of display_slot from archived team_seasons).

export function useTeamTradablePicks(teamId: string | null, leagueId: string | null, draftPickTradingEnabled: boolean = true) {
  return useQuery({
    queryKey: queryKeys.tradablePicks(teamId!, leagueId!, draftPickTradingEnabled),
    queryFn: async () => {
      // Get max_future_seasons + offseason state from league
      const { data: league, error: leagueError } = await supabase
        .from('leagues')
        .select('max_future_seasons, offseason_step, lottery_status, season, sport')
        .eq('id', leagueId!)
        .single();
      if (leagueError) throw leagueError;

      const sport = (league?.sport as Sport | null) ?? 'nba';
      const offseasonStep = league?.offseason_step as string | null;
      const lotteryComplete =
        league?.lottery_status === 'complete' ||
        offseasonStep === 'lottery_complete' ||
        offseasonStep === 'rookie_draft_pending' ||
        offseasonStep === 'rookie_draft_complete' ||
        offseasonStep === 'ready_for_new_season';

      const maxFuture = league?.max_future_seasons ?? 3;
      const currentStartYear = parseSeasonStartYear(league?.season ?? getCurrentSeason(sport));

      // Current season (for in-progress initial draft) + future rookie drafts.
      // max_future_seasons=3 means the next 3 rookie drafts (offset 1..3 from current season).
      const validSeasons: string[] = [];
      for (let i = 0; i <= maxFuture; i++) {
        validSeasons.push(formatSeason(currentStartYear + i, sport));
      }

      // Fetch picks owned by this team that haven't been used
      // Join drafts(type) to distinguish initial vs rookie draft picks
      const { data: picks, error: picksError } = await supabase
        .from('draft_picks')
        .select('id, season, round, pick_number, slot_number, current_team_id, original_team_id, player_id, league_id, drafts(type)')
        .eq('current_team_id', teamId!)
        .eq('league_id', leagueId!)
        .is('player_id', null)
        .in('season', validSeasons)
        .order('season', { ascending: true })
        .order('round', { ascending: true });
      if (picksError) throw picksError;

      // Resolve original team names
      const origIds = [...new Set((picks ?? []).map((p) => p.original_team_id).filter((id): id is string => id != null))];
      let nameMap: Record<string, string> = {};
      if (origIds.length > 0) {
        const { data: teams } = await supabase.from('teams').select('id, name').in('id', origIds);
        if (teams) nameMap = Object.fromEntries(teams.map((t) => [t.id, t.name]));
      }

      // Derive a reverse-standings index from the most recent archived
      // team_seasons rows so we can compute display_slot for picks whose
      // stored slot_number is stale or unset. Only meaningful when there's
      // actual archived data — otherwise we leave display_slot null rather
      // than inventing a position.
      const reverseStandingIndex: Record<string, number> = {};
      let hasStandings = false;
      const { data: archived } = await supabase
        .from('team_seasons')
        .select('team_id, final_standing, season')
        .eq('league_id', leagueId!)
        .order('season', { ascending: false });
      if (archived && archived.length > 0) {
        const latestSeason = archived[0].season;
        const latestRows = archived
          .filter((r) => r.season === latestSeason)
          .sort((a, b) => (b.final_standing ?? 0) - (a.final_standing ?? 0)); // worst first
        latestRows.forEach((r, i) => { reverseStandingIndex[r.team_id] = i; });
        hasStandings = latestRows.length > 0;
      }

      const results = (picks ?? []).map((p) => {
        const origId = p.original_team_id ?? '';
        let displaySlot: number | null = null;
        if (lotteryComplete && p.slot_number != null) {
          displaySlot = p.slot_number;
        } else if (hasStandings && reverseStandingIndex[origId] != null) {
          displaySlot = reverseStandingIndex[origId] + 1;
        }
        return {
          ...p,
          original_team_name: nameMap[origId] ?? 'Unknown',
          display_slot: displaySlot,
        };
      });

      // When draft pick trading is disabled, exclude initial draft picks only
      // Rookie draft picks (type='rookie') and future picks (no draft) remain tradeable
      if (!draftPickTradingEnabled) {
        return results.filter((p) => {
          const drafts = Array.isArray(p.drafts) ? p.drafts[0] ?? null : p.drafts;
          return drafts?.type !== 'initial';
        });
      }
      return results;
    },
    enabled: !!teamId && !!leagueId,
    staleTime: 1000 * 60 * 5,
  });
}
