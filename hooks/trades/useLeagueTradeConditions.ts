import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { getCurrentSeason, type Sport } from '@/constants/LeagueDefaults';
import { queryKeys } from '@/constants/queryKeys';
import { supabase } from '@/lib/supabase';
import { rookiePickSeasons } from '@/utils/draft/pickSeasons';

/**
 * League-level trade rules for the trade builder: the `leagues` columns that
 * gate what can be offered (pick protections, pick swaps, startup-pick trading,
 * IR trading, scoring type) plus derived flags and the valid swap seasons.
 * Extracted from ProposeTradeModal.
 */
export function useLeagueTradeConditions(leagueId: string) {
  const { data: leagueSettings } = useQuery({
    queryKey: queryKeys.leagueTradeConditions(leagueId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('leagues')
        .select('pick_protections_enabled, pick_swaps_enabled, draft_pick_trading_enabled, teams, max_future_seasons, rookie_draft_rounds, league_type, season, sport, offseason_step, scoring_type, ir_trading_enabled')
        .eq('id', leagueId)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!leagueId,
  });

  const isCategories = leagueSettings?.scoring_type === 'h2h_categories';
  const isDynastyLeague = (leagueSettings?.league_type ?? 'dynasty') === 'dynasty';
  const pickProtectionsEnabled = isDynastyLeague && (leagueSettings?.pick_protections_enabled ?? false);
  const pickSwapsEnabled = isDynastyLeague && (leagueSettings?.pick_swaps_enabled ?? false);
  // Picks are tradeable at all in any dynasty league (gates the Pick/Swap chips). The
  // `draft_pick_trading_enabled` setting only governs STARTUP-draft picks — it's applied when
  // fetching tradable picks (useTeamTradablePicks), so future/rookie picks stay tradeable when off.
  const picksTradeable = isDynastyLeague;
  const draftPickTradingEnabled = isDynastyLeague && (leagueSettings?.draft_pick_trading_enabled ?? false);
  // Read path: default CLOSED — a cached league row from before the column
  // existed must block IR players, not wave them through.
  const irTradingEnabled = leagueSettings?.ir_trading_enabled ?? false;
  const teamCount = leagueSettings?.teams ?? 10;
  const maxFutureSeasons = leagueSettings?.max_future_seasons ?? 3;
  const rookieDraftRounds = leagueSettings?.rookie_draft_rounds ?? 2;
  const sport = (leagueSettings?.sport as Sport | null) ?? 'nba';

  // Valid seasons for the swap picker — the same rookie-draft window the draft
  // hub renders, so a swap can't be offered on a year the hub doesn't show.
  const validSeasons = useMemo(
    () => rookiePickSeasons(
      leagueSettings?.season ?? getCurrentSeason(sport),
      maxFutureSeasons,
      leagueSettings?.offseason_step as string | null,
      sport,
    ),
    [leagueSettings?.season, leagueSettings?.offseason_step, maxFutureSeasons, sport],
  );

  return {
    isCategories,
    pickProtectionsEnabled,
    pickSwapsEnabled,
    picksTradeable,
    draftPickTradingEnabled,
    irTradingEnabled,
    teamCount,
    rookieDraftRounds,
    validSeasons,
  };
}
