import { sendNotification } from "@/lib/notifications";
import { supabase } from "@/lib/supabase";
import { GameTimeMap, hasAnyGameStarted, isGameStarted } from "@/utils/gameStarted";
import { assertNoIllegalIR } from "@/utils/illegalIR";

/**
 * Insert a free agent into league_players, log the transaction, and notify.
 *
 * Lock-aware: when the player's add is "locked" (daily = any game started,
 * individual = this player's game started), acquired_at is set to tomorrow noon
 * so the player is claimed immediately but hidden from today's roster.
 *
 * Returns { deferred: true } when the add was locked (caller should alert
 * "will appear tomorrow") or { deferred: false } for an immediate add.
 */
export async function addFreeAgent(params: {
  leagueId: string;
  teamId: string;
  player: { player_id: string; name: string; position: string; pro_team: string };
  playerLockType: "daily" | "individual" | null;
  gameTimeMap: GameTimeMap;
}): Promise<{ deferred: boolean }> {
  const { leagueId, teamId, player, playerLockType, gameTimeMap } = params;

  // Block the add if this team has any healthy player parked on IR.
  await assertNoIllegalIR(leagueId, teamId);

  // Determine if the add is locked
  let locked = false;
  if (playerLockType === "daily") {
    locked = hasAnyGameStarted(gameTimeMap);
  } else if (playerLockType === "individual") {
    locked = isGameStarted(player.pro_team, gameTimeMap);
  }

  let acquiredAt: string;
  if (locked) {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(12, 0, 0, 0);
    acquiredAt = tomorrow.toISOString();
  } else {
    acquiredAt = new Date().toISOString();
  }

  // Insert into league_players
  const { error: lpError } = await supabase.from("league_players").insert({
    league_id: leagueId,
    player_id: player.player_id,
    team_id: teamId,
    acquired_via: "free_agent",
    acquired_at: acquiredAt,
    position: player.position,
    roster_slot: "BE",
  });
  if (lpError) throw lpError;

  // Log transaction
  const { data: txn, error: txnError } = await supabase
    .from("league_transactions")
    .insert({
      league_id: leagueId,
      type: "waiver",
      notes: `Added ${player.name} from free agency`,
      team_id: teamId,
    })
    .select("id")
    .single();
  if (txnError) throw txnError;

  await supabase.from("league_transaction_items").insert({
    transaction_id: txn.id,
    player_id: player.player_id,
    team_to_id: teamId,
  });

  // Fire-and-forget notification
  (async () => {
    const { data: team } = await supabase
      .from("teams")
      .select("name")
      .eq("id", teamId)
      .single();
    sendNotification({
      league_id: leagueId,
      category: "roster_moves",
      title: "Roster Move",
      body: `${team?.name ?? "A team"} added ${player.name}`,
      data: { screen: "roster" },
    });
  })();

  return { deferred: locked };
}
