/**
 * Shared, pure core for deciding whether a pick swap can actually convey —
 * used by BOTH the trade builder's swap picker (client) and execute-trade's
 * pre-commit guard (edge).
 *
 * A swap is between TEAMS, not specific picks: at the lottery, each side puts
 * up whatever pick it holds in that (season, round). If either side holds
 * NOTHING in the round, `resolveSwap` voids it — see
 * [pickSwapResolution.ts](./pickSwapResolution.ts). Letting such a swap be
 * built means someone pays real assets for a right that is dead on arrival, so
 * both surfaces check it up front against the same logic here.
 *
 * Holdings are projected POST-trade: a team that acquires its only pick in the
 * round inside this same trade does hold one, and a team that ships its only
 * pick away in this same trade does not. Counts (not booleans) because a team
 * can hold two picks in a round and trade one.
 */

export interface HeldPick {
  season: string;
  round: number;
  current_team_id: string | null;
}

/** One pick changing hands inside the trade being built/executed. */
export interface PickTransfer {
  season: string;
  round: number;
  from_team_id: string;
  to_team_id: string;
}

export interface SwapParties {
  season: string;
  round: number;
  beneficiary_team_id: string;
  counterparty_team_id: string;
}

export function pickHoldingKey(teamId: string, season: string, round: number): string {
  return `${teamId}|${season}|${round}`;
}

/** How many picks each team holds per (season, round) once `transfers` apply. */
export function projectPickHoldings(
  picks: HeldPick[],
  transfers: PickTransfer[],
): Map<string, number> {
  const counts = new Map<string, number>();
  const bump = (teamId: string | null, season: string, round: number, delta: number) => {
    if (!teamId) return;
    const key = pickHoldingKey(teamId, season, round);
    counts.set(key, (counts.get(key) ?? 0) + delta);
  };

  for (const pick of picks) bump(pick.current_team_id, pick.season, pick.round, 1);
  for (const t of transfers) {
    bump(t.from_team_id, t.season, t.round, -1);
    bump(t.to_team_id, t.season, t.round, 1);
  }
  return counts;
}

export function holdsPickInRound(
  holdings: Map<string, number>,
  teamId: string,
  season: string,
  round: number,
): boolean {
  return (holdings.get(pickHoldingKey(teamId, season, round)) ?? 0) > 0;
}

/**
 * Team ids on the swap that hold no pick in its round — empty means the swap
 * can convey. Beneficiary first, so callers can name them in that order.
 */
export function swapPartiesWithoutPick(
  holdings: Map<string, number>,
  swap: SwapParties,
): string[] {
  return [swap.beneficiary_team_id, swap.counterparty_team_id].filter(
    (teamId) => !holdsPickInRound(holdings, teamId, swap.season, swap.round),
  );
}
