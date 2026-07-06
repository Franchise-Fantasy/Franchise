import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "@/constants/queryKeys";
import { supabase } from "@/lib/supabase";

/**
 * The roster hero's own team identity + current-week opponent. Split out of
 * roster.tsx so the tab file stays lean. Always resolves the user's team
 * (tricode + record) so the hero can render in the offseason and on bye weeks,
 * where there's no opponent. Category records come off league_matchups (kept
 * fresh by the same cron that updates week_scores).
 */
export function useRosterHeroOpponent(
  scheduleId: string | null,
  teamId: string | null,
) {
  return useQuery({
    queryKey: queryKeys.rosterHeroOpponent(scheduleId ?? "", teamId ?? ""),
    queryFn: async () => {
      if (!teamId) return null;
      const fetchTeam = async (id: string) => {
        const { data } = await supabase
          .from("teams")
          .select("id, tricode, name, wins, losses, ties")
          .eq("id", id)
          .maybeSingle();
        return data ?? null;
      };
      if (!scheduleId) {
        const me = await fetchTeam(teamId);
        return { me, opponent: null, isBye: false, categoryRecord: null };
      }
      const { data: m } = await supabase
        .from("league_matchups")
        .select(
          "home_team_id, away_team_id, home_category_wins, away_category_wins, category_ties",
        )
        .eq("schedule_id", scheduleId)
        .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`)
        .maybeSingle();
      const isHome = m?.home_team_id === teamId;
      const opponentId = m ? (isHome ? m.away_team_id : m.home_team_id) : null;
      const ids = opponentId ? [teamId, opponentId] : [teamId];
      const { data: rows } = await supabase
        .from("teams")
        .select("id, tricode, name, wins, losses, ties")
        .in("id", ids);
      const me = rows?.find((t) => t.id === teamId) ?? null;
      const opp = opponentId
        ? rows?.find((t) => t.id === opponentId) ?? null
        : null;
      const categoryRecord =
        m && m.home_category_wins != null
          ? {
              myWins: (isHome ? m.home_category_wins : m.away_category_wins) ?? 0,
              oppWins: (isHome ? m.away_category_wins : m.home_category_wins) ?? 0,
              ties: m.category_ties ?? 0,
            }
          : null;
      return { me, opponent: opp, isBye: !!m && !opponentId, categoryRecord };
    },
    enabled: !!teamId,
    staleTime: 1000 * 60 * 60,
  });
}
