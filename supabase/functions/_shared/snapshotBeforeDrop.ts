import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

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
  // Get the player's current roster_slot and acquisition date
  const { data: lp } = await supabase
    .from("league_players")
    .select("roster_slot, acquired_at")
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

  // Snapshot the player's slot so historical matchup views show the correct position.
  // The snapshot date is the later of week start and the player's acquisition date,
  // so we never backfill entries for days before the player was on this team
  // (prevents ghost roster entries when a player is re-added and immediately dropped).
  const acquiredAt = (lp as any).acquired_at;
  const acquiredDate = acquiredAt
    ? (() => {
        const d = new Date(acquiredAt);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      })()
    : null;

  let snapshotDate = week.start_date;
  if (acquiredDate && acquiredDate > snapshotDate) {
    snapshotDate = acquiredDate;
  }

  // If the player was acquired today and dropped today, skip the snapshot —
  // the DROPPED marker below is all we need (no prior days to preserve).
  // This prevents ghost roster entries when a player is re-added and immediately dropped.
  if (snapshotDate < todayStr) {
    // ON CONFLICT DO NOTHING preserves any existing entry for that date.
    const { error: snapErr } = await supabase
      .from("daily_lineups")
      .upsert(
        {
          league_id: leagueId,
          team_id: teamId,
          player_id: playerId,
          lineup_date: snapshotDate,
          roster_slot: slot,
        },
        { onConflict: "team_id,player_id,lineup_date", ignoreDuplicates: true },
      );
    if (snapErr) console.warn("snapshotBeforeDrop: slot snapshot failed:", snapErr);
  }

  // Mark the player as DROPPED starting today so they don't appear
  // on the roster from today onward, but are still visible on prior days.
  const { error: dropErr } = await supabase
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
  if (dropErr) console.error("snapshotBeforeDrop: DROPPED marker failed — player may keep scoring:", dropErr);

  // Remove any future lineup entries so the dropped player doesn't appear on future dates
  const { error: delErr } = await supabase
    .from("daily_lineups")
    .delete()
    .eq("league_id", leagueId)
    .eq("team_id", teamId)
    .eq("player_id", playerId)
    .gt("lineup_date", todayStr);
  if (delErr) console.warn("snapshotBeforeDrop: future entry cleanup failed:", delErr);
}
