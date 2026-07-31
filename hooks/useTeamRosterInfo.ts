import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "@/constants/queryKeys";
import { supabase } from "@/lib/supabase";
import { ROSTER_SLOT } from "@/utils/roster/rosterSlotsShared";

/**
 * Roster counts, max size, IR/taxi capacity, waiver settings, and the IR
 * player trading flag for one team. Extracted from PlayerDetailModal; keeps
 * the same `queryKeys.rosterInfo` cache key that roster mutations elsewhere
 * (roster.tsx, FreeAgentList, the modal itself) invalidate.
 */
export function useTeamRosterInfo(leagueId: string, teamId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.rosterInfo(leagueId, teamId!),
    queryFn: async () => {
      const [
        allPlayersRes,
        irPlayersRes,
        taxiPlayersRes,
        leagueRes,
        irConfigRes,
        taxiConfigRes,
      ] = await Promise.all([
        supabase
          .from("league_players")
          .select("id", { count: "exact", head: true })
          .eq("league_id", leagueId)
          .eq("team_id", teamId!),
        supabase
          .from("league_players")
          .select("id", { count: "exact", head: true })
          .eq("league_id", leagueId)
          .eq("team_id", teamId!)
          .eq("roster_slot", "IR"),
        supabase
          .from("league_players")
          .select("id", { count: "exact", head: true })
          .eq("league_id", leagueId)
          .eq("team_id", teamId!)
          .eq("roster_slot", ROSTER_SLOT.TAXI),
        supabase
          .from("leagues")
          .select(
            "roster_size, waiver_type, waiver_period_days, taxi_slots, taxi_max_experience, season, offseason_step, ir_trading_enabled",
          )
          .eq("id", leagueId)
          .single(),
        supabase
          .from("league_roster_config")
          .select("slot_count")
          .eq("league_id", leagueId)
          .eq("position", "IR")
          .maybeSingle(),
        supabase
          .from("league_roster_config")
          .select("slot_count")
          .eq("league_id", leagueId)
          .eq("position", ROSTER_SLOT.TAXI)
          .maybeSingle(),
      ]);

      if (allPlayersRes.error) throw allPlayersRes.error;
      if (irPlayersRes.error) throw irPlayersRes.error;
      if (leagueRes.error) throw leagueRes.error;

      const irCount = irPlayersRes.count ?? 0;
      const taxiCount = taxiPlayersRes.count ?? 0;
      const activeCount = (allPlayersRes.count ?? 0) - irCount - taxiCount;
      return {
        activeCount,
        irCount,
        irSlotCount: irConfigRes.data?.slot_count ?? 0,
        taxiCount,
        taxiSlotCount: taxiConfigRes.data?.slot_count ?? 0,
        taxiMaxExperience: leagueRes.data?.taxi_max_experience as number | null,
        season: leagueRes.data?.season as string,
        maxSize: leagueRes.data?.roster_size ?? 13,
        waiverType: (leagueRes.data?.waiver_type ?? "none") as
          | "standard"
          | "faab"
          | "none",
        waiverPeriodDays: leagueRes.data?.waiver_period_days ?? 2,
        offseasonStep: leagueRes.data?.offseason_step as string | null,
        // Read path: default OFF (blocking) when the row predates the column.
        irTradingEnabled: (leagueRes.data?.ir_trading_enabled as boolean | null) ?? false,
      };
    },
    enabled: !!teamId && !!leagueId,
  });
}
