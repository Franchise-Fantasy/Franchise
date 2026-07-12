// Pure logic for auto-defaulting stalled "choose your opponent" playoff picks.
//
// Shared by the generate-playoff-round edge function (`auto_resolve_picks` mode)
// and its jest unit tests. No runtime dependencies, so it imports cleanly under
// both Deno (edge, with a `.ts` specifier) and Node/ts-jest.

export interface SeedEntry {
  teamId: string;
  seed: number;
}

export interface PendingSeedPick {
  id: string;
  picking_seed: number;
  picked_opponent_id: string | null;
}

export interface SeedPickAssignment {
  pickId: string;
  opponentId: string;
}

/**
 * Round-1 opponent pool: the bottom half of the playing (non-bye) seeds — the
 * teams the higher seeds choose among. The top `byes` seeds auto-advance and
 * are never opponents. Mirrors how generate-playoff-round partitions pickers
 * vs. opponents when it CREATES the picks.
 */
export function round1OpponentPool(seeds: SeedEntry[], byes: number): SeedEntry[] {
  const playing = seeds.slice(byes);
  return playing.slice(Math.floor(playing.length / 2));
}

/**
 * Later-round opponent pool: the bottom half of the round's winners by seed
 * (the top half are the pickers). Accepts winners in any order.
 */
export function nextRoundOpponentPool(winners: SeedEntry[]): SeedEntry[] {
  const sorted = [...winners].sort((a, b) => a.seed - b.seed);
  return sorted.slice(Math.floor(sorted.length / 2));
}

/**
 * Assign the lowest available seed to each still-pending pick, in picking-seed
 * order — the earliest (best) picker is handed the weakest remaining opponent,
 * reproducing the standard 1vN / 2v(N-1) bracket a manager would default to.
 * Picks that already have an opponent are respected (their opponent is removed
 * from the pool). Returns only the NEW assignments. Pure — no side effects.
 */
export function resolvePendingSeedPicks(
  picks: PendingSeedPick[],
  opponentPool: SeedEntry[],
): SeedPickAssignment[] {
  const taken = new Set(
    picks.filter((p) => p.picked_opponent_id).map((p) => p.picked_opponent_id as string),
  );
  // Worst (highest seed number = lowest seed) first, so the earliest picker
  // gets the weakest available opponent.
  const available = opponentPool
    .filter((o) => !taken.has(o.teamId))
    .sort((a, b) => b.seed - a.seed);
  const pending = picks
    .filter((p) => !p.picked_opponent_id)
    .sort((a, b) => a.picking_seed - b.picking_seed);

  const assignments: SeedPickAssignment[] = [];
  for (const pick of pending) {
    const opponent = available.shift();
    if (!opponent) break;
    assignments.push({ pickId: pick.id, opponentId: opponent.teamId });
  }
  return assignments;
}
