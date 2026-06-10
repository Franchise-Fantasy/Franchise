import { supabase } from "@/lib/supabase";
import { checkPositionLimits } from "@/utils/roster/positionLimits";

export type AddDropPreflightResult =
  | { ok: true }
  | { ok: false; title: string; message: string };

/**
 * Validate an add-and-drop BEFORE any DB mutation, so a rejected add never
 * strands the dropped player. Checks the league's weekly acquisition limit and
 * per-position limits, excluding the player being dropped from the position
 * count (dropping a PG frees that PG slot for the incoming player).
 *
 * The server RPC `assert_can_add_free_agent` enforces the same rules as a
 * backstop — this is the friendly pre-round-trip message. Shared by the
 * locked-day queued-drop path and the immediate add+drop path in
 * PlayerDetailModal.
 */
export async function checkAddDropPreflight(params: {
  leagueId: string;
  teamId: string;
  incomingPosition: string;
  dropPlayerId: string;
}): Promise<AddDropPreflightResult> {
  const { leagueId, teamId, incomingPosition, dropPlayerId } = params;

  const { data: league } = await supabase
    .from("leagues")
    .select("weekly_acquisition_limit, position_limits")
    .eq("id", leagueId)
    .single();

  // Weekly acquisition limit (Mon-Sun window, UTC to match DB timestamps).
  const wkLimit = league?.weekly_acquisition_limit as number | null;
  if (wkLimit != null) {
    const now = new Date();
    const day = now.getUTCDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    const monday = new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate() + mondayOffset,
      ),
    );
    const weekStart = monday.toISOString().split("T")[0];

    const { count: addsThisWeek } = await supabase
      .from("league_transactions")
      .select("id, league_transaction_items!inner(team_to_id)", {
        count: "exact",
        head: true,
      })
      .eq("league_id", leagueId)
      .eq("team_id", teamId)
      .eq("type", "waiver")
      .not("league_transaction_items.team_to_id", "is", null)
      .gte("created_at", weekStart + "T00:00:00");

    if ((addsThisWeek ?? 0) >= wkLimit) {
      return {
        ok: false,
        title: "Add Limit Reached",
        message: `You've used all ${wkLimit} adds for this week.`,
      };
    }
  }

  // Per-position limit, counting the post-drop roster.
  const posLimits = league?.position_limits as Record<string, number> | null;
  if (incomingPosition && posLimits && Object.keys(posLimits).length > 0) {
    const { data: rosterForLimits } = await supabase
      .from("league_players")
      .select("player_id, position, roster_slot")
      .eq("league_id", leagueId)
      .eq("team_id", teamId);
    const violation = checkPositionLimits(
      posLimits,
      (rosterForLimits ?? [])
        .filter((r) => r.player_id !== dropPlayerId)
        .map((r) => ({
          position: r.position,
          roster_slot: r.roster_slot ?? undefined,
        })),
      incomingPosition,
    );
    if (violation) {
      return {
        ok: false,
        title: "Position Limit Reached",
        message: `Your roster already has the maximum of ${violation.max} players eligible at ${violation.position}.`,
      };
    }
  }

  return { ok: true };
}
