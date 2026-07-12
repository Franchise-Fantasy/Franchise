import { supabase } from "@/lib/supabase";

/**
 * Client wrapper for the `roster_add_drop` RPC — the single write path for
 * free-agent adds, drops, and add-and-drops.
 *
 * Everything the operation touches (daily_lineups markers, league_players, the
 * waiver placement, pending_transactions for a locked-day drop, and both sides
 * of the transaction ledger) commits in one transaction. Before this existed,
 * an add that the server rejected AFTER the drop had committed left the dropped
 * player gone — off the roster and on waivers — with no way back.
 *
 * The roster-size / position-limit / pending-trade guard runs server-side
 * against the post-drop roster, so the caller no longer has to predict what the
 * roster will look like. Game-lock state is the one thing the DB can't derive
 * (it needs tip-off times), so `deferAdd` / `queueDrop` are computed in TS.
 */
export type RosterAddDropResult = {
  added: boolean;
  dropped: boolean;
  /** The added player is claimed now but appears at the next 5am ET rollover. */
  deferred: boolean;
  /** The drop executes at the next rollover (the player's game was underway). */
  queued_drop: boolean;
  add_name: string | null;
  drop_name: string | null;
};

/**
 * Turn the RPC's raised exceptions into the messages GMs already know. The
 * server raises these with stable prefixes precisely so this mapping can stay
 * dumb; anything unrecognized surfaces as-is rather than being swallowed.
 */
function friendlyMessage(raw: string): string {
  if (raw.includes("pending_trades_would_overflow_roster")) {
    return "You have a pending trade that would put you over your roster limit. Resolve the trade or drop a player first.";
  }
  if (raw.includes("roster_full")) {
    return "Your roster is already full. Drop a player first before adding.";
  }
  if (raw.includes("position_limit_full")) {
    const m = raw.match(/position=(\w+).*max=(\d+)/);
    return m
      ? `Your roster already has the maximum of ${m[2]} players eligible at ${m[1]}.`
      : "This add would exceed your league's position limit.";
  }
  if (raw.includes("weekly_limit_reached")) {
    const m = raw.match(/limit=(\d+)/);
    return m
      ? `You've used all ${m[1]} adds for this week.`
      : "You've used all your adds for this week.";
  }
  if (raw.includes("player_not_on_roster")) {
    return "That player is no longer on your roster.";
  }
  if (raw.includes("not_authorized")) {
    return "You don't have permission to change this roster.";
  }
  // A player already rostered elsewhere in the league (uq_league_player).
  if (raw.includes("uq_league_player")) {
    return "Another team just claimed this player.";
  }
  return raw;
}

export async function rosterAddDrop(params: {
  leagueId: string;
  teamId: string;
  addPlayerId?: string;
  dropPlayerId?: string;
  /** The added player's game has started — reveal them at the next rollover. */
  deferAdd?: boolean;
  /** The dropped player's game has started — execute the drop at the rollover. */
  queueDrop?: boolean;
  /** Ties the add and drop into one activity-feed card. */
  groupId?: string;
}): Promise<RosterAddDropResult> {
  const { data, error } = await supabase.rpc("roster_add_drop", {
    p_league_id: params.leagueId,
    p_team_id: params.teamId,
    ...(params.addPlayerId ? { p_add_player_id: params.addPlayerId } : {}),
    ...(params.dropPlayerId ? { p_drop_player_id: params.dropPlayerId } : {}),
    ...(params.deferAdd ? { p_defer_add: true } : {}),
    ...(params.queueDrop ? { p_queue_drop: true } : {}),
    ...(params.groupId ? { p_group_id: params.groupId } : {}),
  });

  if (error) throw new Error(friendlyMessage(error.message ?? "Roster move failed"));
  return data as unknown as RosterAddDropResult;
}
