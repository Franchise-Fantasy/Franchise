import { isEligibleForSlot, baseSlotName, isStarterSlot } from './rosterSlots';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface LineupPlayer {
  player_id: string;
  position: string;       // "PG", "SG-SF", "C-PF"
  status: string;         // 'active', 'OUT', 'SUSP', etc.
  roster_slot: string;    // current slot: 'PG', 'UTIL1', 'BE', 'IR'
  avgFpts: number;        // season avg fantasy points
  locked: boolean;        // game started, can't move
  hasGame: boolean;       // team plays on this date
}

export interface SlotAssignment {
  player_id: string;
  slot: string;
}

interface SlotConfig {
  position: string;
  slot_count: number;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Expected FPTS for a given day: 0 if not playing, OUT, or SUSP. */
function dayFpts(p: LineupPlayer): number {
  if (p.status === 'OUT' || p.status === 'SUSP') return 0;
  return p.hasGame ? p.avgFpts : 0;
}

// ─── Optimizer ──────────────────────────────────────────────────────────────

/**
 * Produces a complete lineup (every player gets exactly one slot) that maximizes
 * starter FPTS for a given day. Uses a greedy fill ordered by most-constrained
 * seat first, plus a swap improvement pass to fix suboptimal placements.
 *
 * Returns the full assignment list for every player.
 */
export function optimizeLineup(
  players: LineupPlayer[],
  config: SlotConfig[],
): SlotAssignment[] {
  // Build list of starter seat names
  const starterSeats: string[] = [];
  for (const c of config) {
    if (c.position === 'BE' || c.position === 'IR') continue;
    if (c.position === 'UTIL') {
      for (let i = 1; i <= c.slot_count; i++) starterSeats.push(`UTIL${i}`);
    } else {
      for (let i = 0; i < c.slot_count; i++) starterSeats.push(c.position);
    }
  }

  const result: SlotAssignment[] = [];
  const assignedIds = new Set<string>();

  // 1. IR players stay on IR
  for (const p of players) {
    if (p.roster_slot === 'IR') {
      result.push({ player_id: p.player_id, slot: 'IR' });
      assignedIds.add(p.player_id);
    }
  }

  // 2. Locked starters stay in their current seat
  for (const p of players) {
    if (assignedIds.has(p.player_id)) continue;
    if (p.locked && isStarterSlot(p.roster_slot)) {
      result.push({ player_id: p.player_id, slot: p.roster_slot });
      assignedIds.add(p.player_id);
    }
  }

  // Remove seats claimed by locked players
  const lockedSeats = result
    .filter(r => isStarterSlot(r.slot) && r.slot !== 'IR')
    .map(r => r.slot);
  const openSeats = [...starterSeats];
  for (const ls of lockedSeats) {
    const idx = openSeats.indexOf(ls);
    if (idx >= 0) openSeats.splice(idx, 1);
  }

  // 3. Build candidate pool (everyone not locked/IR)
  const pool = players.filter(p => !assignedIds.has(p.player_id));

  // Sort open seats by number of eligible candidates (ascending) so the most
  // constrained seats get filled first. This prevents flexible multi-position
  // players from being "wasted" on seats that have many other options.
  openSeats.sort((a, b) => {
    const aCount = pool.filter(p => isEligibleForSlot(p.position, a)).length;
    const bCount = pool.filter(p => isEligibleForSlot(p.position, b)).length;
    if (aCount !== bCount) return aCount - bCount;
    // Tie-break: specific positions before flex before UTIL
    const TIER: Record<string, number> = {
      PG: 0, SG: 0, SF: 0, PF: 0, C: 0, G: 1, F: 1, UTIL: 2,
    };
    return (TIER[baseSlotName(a)] ?? 2) - (TIER[baseSlotName(b)] ?? 2);
  });

  // 4. Greedy assignment: fill each seat with the best eligible player
  const seatFilled = new Array(openSeats.length).fill(false);
  const playerUsed = new Set<string>();

  for (let s = 0; s < openSeats.length; s++) {
    const seat = openSeats[s];
    let bestIdx = -1;
    let bestFpts = -1;

    for (let p = 0; p < pool.length; p++) {
      if (playerUsed.has(pool[p].player_id)) continue;
      if (!isEligibleForSlot(pool[p].position, seat)) continue;
      const fpts = dayFpts(pool[p]);
      if (fpts > bestFpts) {
        bestFpts = fpts;
        bestIdx = p;
      }
    }

    if (bestIdx >= 0) {
      result.push({ player_id: pool[bestIdx].player_id, slot: seat });
      assignedIds.add(pool[bestIdx].player_id);
      playerUsed.add(pool[bestIdx].player_id);
      seatFilled[s] = true;
    }
  }

  // 5. Fill any remaining empty seats with leftover players (even non-playing).
  //    Prefer active players over OUT/SUSP to avoid wasting starter slots on injured.
  for (let s = 0; s < openSeats.length; s++) {
    if (seatFilled[s]) continue;
    const seat = openSeats[s];
    // First pass: active players only
    for (const p of pool) {
      if (playerUsed.has(p.player_id)) continue;
      if (p.status === 'OUT' || p.status === 'SUSP') continue;
      if (!isEligibleForSlot(p.position, seat)) continue;
      result.push({ player_id: p.player_id, slot: seat });
      assignedIds.add(p.player_id);
      playerUsed.add(p.player_id);
      seatFilled[s] = true;
      break;
    }
    if (seatFilled[s]) continue;
    // Second pass: anyone (including OUT/SUSP) if no active player fits
    for (const p of pool) {
      if (playerUsed.has(p.player_id)) continue;
      if (!isEligibleForSlot(p.position, seat)) continue;
      result.push({ player_id: p.player_id, slot: seat });
      assignedIds.add(p.player_id);
      playerUsed.add(p.player_id);
      seatFilled[s] = true;
      break;
    }
  }

  // 6. Everyone else goes to bench
  for (const p of players) {
    if (!assignedIds.has(p.player_id)) {
      result.push({ player_id: p.player_id, slot: 'BE' });
      assignedIds.add(p.player_id);
    }
  }

  // 7. Swap improvement: check if swapping a bench player with a starter
  //    increases total day-FPTS. Repeat until no improving swaps.
  const playerMap = new Map(players.map(p => [p.player_id, p]));
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 0; i < result.length; i++) {
      const starterAssign = result[i];
      if (!isStarterSlot(starterAssign.slot) || starterAssign.slot === 'IR') continue;
      const starter = playerMap.get(starterAssign.player_id)!;
      if (starter.locked) continue;

      for (let j = 0; j < result.length; j++) {
        if (i === j) continue;
        const otherAssign = result[j];
        if (otherAssign.slot === 'IR') continue;
        const other = playerMap.get(otherAssign.player_id)!;
        if (other.locked) continue;

        // Can they swap slots?
        const otherCanFillStarter = isEligibleForSlot(other.position, starterAssign.slot);
        const starterCanFillOther = otherAssign.slot === 'BE' || isEligibleForSlot(starter.position, otherAssign.slot);
        if (!otherCanFillStarter || !starterCanFillOther) continue;

        // Would the swap increase starter FPTS?
        const currentStarterFpts = isStarterSlot(starterAssign.slot) ? dayFpts(starter) : 0;
        const currentOtherFpts = isStarterSlot(otherAssign.slot) ? dayFpts(other) : 0;
        const swappedStarterFpts = isStarterSlot(starterAssign.slot) ? dayFpts(other) : 0;
        const swappedOtherFpts = isStarterSlot(otherAssign.slot) ? dayFpts(starter) : 0;

        if ((swappedStarterFpts + swappedOtherFpts) > (currentStarterFpts + currentOtherFpts)) {
          const tempSlot = starterAssign.slot;
          starterAssign.slot = otherAssign.slot;
          otherAssign.slot = tempSlot;
          improved = true;
        }
      }
    }
  }

  return result;
}
