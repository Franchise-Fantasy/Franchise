import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { CURRENT_NBA_SEASON } from '@/constants/LeagueDefaults';
import { queryKeys } from '@/constants/queryKeys';
import { supabase } from '@/lib/supabase';

/**
 * League-level trade rules for the trade builder: the `leagues` columns that
 * gate what can be offered (pick conditions, startup-pick trading, IR
 * trading, scoring type) plus derived flags and the valid swap seasons.
 * Extracted from ProposeTradeModal.
 */
export function useLeagueTradeConditions(leagueId: string) {
  const { data: leagueSettings } = useQuery({
    queryKey: queryKeys.leagueTradeConditions(leagueId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('leagues')
        .select('pick_conditions_enabled, draft_pick_trading_enabled, teams, max_future_seasons, rookie_draft_rounds, league_type, season, offseason_step, scoring_type, ir_trading_enabled')
        .eq('id', leagueId)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!leagueId,
  });

  const isCategories = leagueSettings?.scoring_type === 'h2h_categories';
  const isDynastyLeague = (leagueSettings?.league_type ?? 'dynasty') === 'dynasty';
  const pickConditionsEnabled = isDynastyLeague && (leagueSettings?.pick_conditions_enabled ?? false);
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

  // Build valid seasons for swap picker — skip the current season if its draft already happened
  const validSeasons = useMemo(() => {
    const leagueSeason = leagueSettings?.season ?? CURRENT_NBA_SEASON;
    const leagueStartYear = parseInt(leagueSeason.split('-')[0], 10);
    const step = leagueSettings?.offseason_step as string | null;
    const draftDone = !step || step === 'rookie_draft_complete';
    const startYear = draftDone ? leagueStartYear + 1 : leagueStartYear;
    const seasons: string[] = [];
    const count = draftDone ? maxFutureSeasons : maxFutureSeasons + 1;
    for (let i = 0; i < count; i++) {
      const sy = startYear + i;
      const ey = (sy + 1) % 100;
      seasons.push(`${sy}-${String(ey).padStart(2, '0')}`);
    }
    return seasons;
  }, [leagueSettings?.season, leagueSettings?.offseason_step, maxFutureSeasons]);

  return {
    isCategories,
    pickConditionsEnabled,
    picksTradeable,
    draftPickTradingEnabled,
    irTradingEnabled,
    teamCount,
    rookieDraftRounds,
    validSeasons,
  };
}
