import { sendNotification } from "@/lib/notifications";
import { supabase } from "@/lib/supabase";
import { GameTimeMap, hasAnyGameStarted, isGameStarted } from "@/utils/nba/gameStarted";
import { assertNoIllegalIR } from "@/utils/roster/illegalIR";
import { assertNoOverCap } from "@/utils/roster/overCap";
import { rosterAddDrop } from "@/utils/roster/rosterTransaction";

/**
 * Add a free agent to a team.
 *
 * The roster write, the transaction ledger, and the server-side roster-size /
 * position-limit / pending-trade guard all happen inside `roster_add_drop`, in
 * one transaction — see utils/roster/rosterTransaction.ts. This function is the
 * plain-add entry point: it applies the IR / over-cap UX gates, works out
 * whether the add is game-locked, and owns the notification.
 *
 * Lock-aware: when the player's add is "locked" (daily = any game started,
 * individual = this player's game started), the player is claimed immediately
 * but hidden until the next 5am ET rollover.
 *
 * Pass `forceDefer: true` when paired with a queued drop — the add then defers
 * regardless of the added player's own lock state, so the add and drop apply on
 * the same day. (An add+drop done as ONE user action should call `rosterAddDrop`
 * directly instead, so both sides share a transaction.)
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
  forceDefer?: boolean;
  groupId?: string;
  skipNotify?: boolean;
}): Promise<{ deferred: boolean }> {
  const { leagueId, teamId, player, playerLockType, gameTimeMap, forceDefer, groupId, skipNotify } =
    params;

  // Block the add if this team has any healthy player parked on IR, or if its
  // active roster is already over capacity (a common post-draft state when
  // mid-draft trades net-added picks). Both are league penalties on *acquiring*,
  // not correctness guards — the server enforces size and position caps.
  await assertNoIllegalIR(leagueId, teamId);
  await assertNoOverCap(leagueId, teamId);

  let locked = false;
  if (forceDefer) {
    locked = true;
  } else if (playerLockType === "daily") {
    locked = hasAnyGameStarted(gameTimeMap);
  } else if (playerLockType === "individual") {
    locked = isGameStarted(player.pro_team, gameTimeMap);
  }

  const { deferred } = await rosterAddDrop({
    leagueId,
    teamId,
    addPlayerId: player.player_id,
    deferAdd: locked,
    groupId,
  });

  // When paired with a drop, the caller owns the single combined notification.
  if (skipNotify) return { deferred };

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

  return { deferred };
}
