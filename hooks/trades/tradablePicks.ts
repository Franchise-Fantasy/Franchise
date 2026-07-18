import { useQuery } from '@tanstack/react-query';

import { formatSeason, getCurrentSeason, parseSeasonStartYear, type Sport } from '@/constants/LeagueDefaults';
import { queryKeys } from '@/constants/queryKeys';
import { supabase } from '@/lib/supabase';

// Data source: draft_picks owned by a team (with drafts join).

export function useTeamTradablePicks(teamId: string | null, leagueId: string | null, draftPickTradingEnabled: boolean = true) {
  return useQuery({
    queryKey: queryKeys.tradablePicks(teamId!, leagueId!, draftPickTradingEnabled),
    queryFn: async () => {
      // Get max_future_seasons + season from league
      const { data: league, error: leagueError } = await supabase
        .from('leagues')
        .select('max_future_seasons, season, sport')
        .eq('id', leagueId!)
        .single();
      if (leagueError) throw leagueError;

      const sport = (league?.sport as Sport | null) ?? 'nba';
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
        .select('id, season, round, pick_number, current_team_id, original_team_id, player_id, league_id, protection_threshold, protection_owner_id, drafts(type)')
        .eq('current_team_id', teamId!)
        .eq('league_id', leagueId!)
        .is('player_id', null)
        .in('season', validSeasons)
        .order('season', { ascending: true })
        .order('round', { ascending: true });
      if (picksError) throw picksError;

      // Fetch active (unresolved) swaps this team is party to, so the picker
      // can flag a pick whose round already carries a swap right — a pick can
      // hold a swap AND a protection at once, and the acquirer should see both.
      const { data: swapRows } = await supabase
        .from('pick_swaps')
        .select('season, round, beneficiary_team_id, counterparty_team_id')
        .eq('league_id', leagueId!)
        .eq('resolved', false)
        .or(`beneficiary_team_id.eq.${teamId},counterparty_team_id.eq.${teamId}`);

      // Resolve original team + protection owner + swap partner names
      const swapPartnerIds = (swapRows ?? []).map((sw) =>
        sw.beneficiary_team_id === teamId ? sw.counterparty_team_id : sw.beneficiary_team_id);
      const nameIds = [...new Set([
        ...(picks ?? []).flatMap((p) => [p.original_team_id, p.protection_owner_id]),
        ...swapPartnerIds,
      ].filter((id): id is string => id != null))];
      let nameMap: Record<string, string> = {};
      if (nameIds.length > 0) {
        const { data: teams } = await supabase.from('teams').select('id, name').in('id', nameIds);
        if (teams) nameMap = Object.fromEntries(teams.map((t) => [t.id, t.name]));
      }

      const results = (picks ?? []).map((p) => {
        const origId = p.original_team_id ?? '';
        // A swap right applies to whatever pick this team holds in that
        // (season, round) — flag it so the picker shows the pick isn't a
        // clean asset. First matching swap wins for the label.
        const swap = (swapRows ?? []).find((sw) => sw.season === p.season && sw.round === p.round);
        const swapInfo = swap
          ? {
              isBeneficiary: swap.beneficiary_team_id === teamId,
              partner_name:
                nameMap[swap.beneficiary_team_id === teamId ? swap.counterparty_team_id : swap.beneficiary_team_id]
                ?? 'Unknown',
            }
          : null;
        return {
          ...p,
          original_team_name: nameMap[origId] ?? 'Unknown',
          protection_owner_name: p.protection_owner_id ? nameMap[p.protection_owner_id] ?? null : null,
          swap_info: swapInfo,
          // The overall pick, straight from the DB. Null until the draft order
          // is set (lottery run / draft created), which is exactly when we want
          // the label to omit the number rather than invent one — a future
          // pick's `slot_number` is a placeholder, not a draft position.
          display_pick: p.pick_number,
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
