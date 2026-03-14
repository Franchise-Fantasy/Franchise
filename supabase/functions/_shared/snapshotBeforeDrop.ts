import { SupabaseClient } from "jsr:@supabase/supabase-js@2";

/**
 * Before dropping a player from league_players, snapshot their roster_slot
 * into daily_lineups so that past scoring for the current week is preserved.
 *
 * Inserts at the current week's start_date (baseline for the whole week).
 * Uses ON CONFLICT DO NOTHING so existing lineup changes aren't overwritten.
 */
export async function snapshotBeforeDrop(
  supabase: SupabaseClient,
  leagueId: string,
  teamId: string,
  playerId: string,
): Promise<void> {
  // Get the player's current roster_slot
  const { data: lp } = await supabase
    .from("league_players")
    .select("roster_slot")
    .eq("league_id", leagueId)
    .eq("team_id", teamId)
    .eq("player_id", playerId)
    .single();

  if (!lp) return; // Player not found, nothing to snapshot

  const slot = lp.roster_slot ?? "BE";

  // Find the current active week
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  const { data: week } = await supabase
    .from("league_schedule")
    .select("start_date")
    .eq("league_id", leagueId)
    .lte("start_date", todayStr)
    .gte("end_date", todayStr)
    .single();

  if (!week) return; // Not in an active week, no scoring to preserve

  // Insert at week start_date so it covers all games in the week.
  // ON CONFLICT DO NOTHING preserves any existing entry for that date.
  await supabase
    .from("daily_lineups")
    .upsert(
      {
        league_id: leagueId,
        team_id: teamId,
        player_id: playerId,
        lineup_date: week.start_date,
        roster_slot: slot,
      },
      { onConflict: "team_id,player_id,lineup_date", ignoreDuplicates: true },
    );

  // Mark the player as DROPPED starting today so they don't appear
  // on the roster from today onward, but are still visible on prior days.
  await supabase
    .from("daily_lineups")
    .upsert(
      {
        league_id: leagueId,
        team_id: teamId,
        player_id: playerId,
        lineup_date: todayStr,
        roster_slot: "DROPPED",
      },
      { onConflict: "team_id,player_id,lineup_date" },
    );

  // Remove any future lineup entries so the dropped player doesn't appear on future dates
  await supabase
    .from("daily_lineups")
    .delete()
    .eq("league_id", leagueId)
    .eq("team_id", teamId)
    .eq("player_id", playerId)
    .gt("lineup_date", todayStr);
}
