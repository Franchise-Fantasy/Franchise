import { useQuery } from '@tanstack/react-query';

import { queryKeys } from '@/constants/queryKeys';
import { useAppState } from '@/context/AppStateProvider';
import { supabase } from '@/lib/supabase';


export function useLeague() {
  const { leagueId } = useAppState();

  return useQuery({
    queryKey: queryKeys.league(leagueId!),
    queryFn: async () => {
      if (!leagueId) return null;

      // Explicit column list (NOT `*`): the 4 sensitive columns — invite_code,
      // venmo_username, cashapp_tag, paypal_username — are column-revoked from
      // `authenticated` (see 20260729000200 migration) and fetched separately by
      // useLeaguePrivateInfo through a members-only RPC. A `*` here would hit
      // "permission denied for column". Keep this list in sync with that grant.
      const { data, error } = await supabase
        .from('leagues')
        .select(`
          id, name, created_by, max_future_seasons, created_at, commissioner,
          teams, private, roster_size, current_teams, season,
          regular_season_weeks, playoff_weeks, season_start_date,
          schedule_generated, trade_review_period_hours, trade_veto_type,
          trade_votes_to_veto, trade_deadline, rookie_draft_rounds,
          rookie_draft_order, lottery_draws, waiver_type, waiver_period_days,
          faab_budget, waiver_day_of_week, lottery_odds, playoff_teams,
          playoff_seeding_format, reseed_each_round, offseason_step,
          champion_team_id, lottery_date, lottery_status, pick_conditions_enabled,
          draft_pick_trading_enabled, buy_in_amount, imported_from, scoring_type,
          league_type, keeper_count, taxi_slots, taxi_max_experience,
          weekly_acquisition_limit, auto_rumors_enabled, tiebreaker_order,
          initial_draft_order, division_count, division_1_name, division_2_name,
          player_lock_type, position_limits, sport, combine_cup_week, archived_at,
          archived_by, rookie_pick_time_limit, waiver_priority_reset,
          faab_tiebreak,
          league_teams:teams!teams_league_id_fkey (
            id,
            name,
            tricode,
            is_commissioner,
            logo_key,
            division,
            user_id,
            wins,
            losses,
            ties,
            league_players:league_players!league_players_team_id_fkey(count)
          )
        `)
        .eq('id', leagueId)
        .single();

      if (error) throw error;
      return data;
    },
    enabled: !!leagueId,
    retry: 3,
    retryDelay: 1000,
    staleTime: 1000 * 60, // 1 minute — keep short for phase transitions
  });
}