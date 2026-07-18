import { useMemo } from 'react';

import { isEligibleForSlot } from '@/utils/roster/rosterSlots';

// Constrained starter positions the roster-needs strip will chip. UTIL/BE/IR
// are intentionally absent: UTIL has no eligibility constraint (anyone fits),
// and bench/IR aren't starters. NFL FLEX/SFLX are likewise absent — they're
// multi-position seats, so the single-position chips carry the signal.
const KNOWN_CHIP_POSITIONS = new Set([
  'PG', 'SG', 'SF', 'PF', 'C', 'G', 'F',
  'QB', 'RB', 'WR', 'TE', 'K', 'DST',
]);

interface OwnershipRow {
  teamId: string;
  position: string;
  rosterSlot: string | null;
}

interface RosterConfigSlot {
  position: string;
  slot_count: number;
}

export type PositionNeedState = 'set' | 'thin' | 'needs';

/**
 * The free-agent list's roster-needs strip: which position chips to show,
 * how many eligible players the user's team has per chip, and each chip's
 * supply-vs-demand state. Pure derivation from the league's slot config and
 * the league ownership rows.
 */
export function useRosterNeeds(
  sport: string | null | undefined,
  rosterConfig: RosterConfigSlot[] | undefined,
  ownershipRows: OwnershipRow[] | undefined,
  teamId: string,
) {
  // Chip positions — for WNBA we hardcode G/F/C (the canonical WNBA
  // basketball positions, which gives a stable 3-chip layout regardless
  // of the league's slot config). For other sports we derive from the
  // league config: every constrained starter position the league
  // actually uses, in roster-config order, UTIL/BE/IR excluded, capped
  // at 5. Returns empty for all-UTIL leagues so the strip hides.
  const chipPositions = useMemo<string[]>(() => {
    if (sport === 'wnba') return ['G', 'F', 'C'];
    const seen = new Set<string>();
    const ordered: string[] = [];
    for (const slot of rosterConfig ?? []) {
      const p = slot.position;
      if (!KNOWN_CHIP_POSITIONS.has(p)) continue;
      if (seen.has(p)) continue;
      seen.add(p);
      ordered.push(p);
    }
    return ordered.slice(0, 5);
  }, [sport, rosterConfig]);

  // Per-position eligibility counts for the user's active roster (excluding
  // IR). A player is counted in every chip position they can fill — so a
  // PG-SG player counts toward both a PG chip and an SG chip, and toward a
  // G chip if the league has G slots.
  const myTeamCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const p of chipPositions) counts[p] = 0;
    if (!ownershipRows) return counts;
    for (const row of ownershipRows) {
      if (row.teamId !== teamId) continue;
      if (row.rosterSlot === 'IR') continue;
      if (!row.position) continue;
      for (const p of chipPositions) {
        if (isEligibleForSlot(row.position, p)) counts[p] += 1;
      }
    }
    return counts;
  }, [ownershipRows, teamId, chipPositions]);

  // Supply vs. demand state per chip position. Demand = total dedicated
  // slot_count for that position (so a WNBA league with G,G needs 2
  // G-eligible players to start; a 1-PG-slot league needs 1).
  const positionStates = useMemo(() => {
    const states: Record<string, { state: PositionNeedState; deficit: number; demand: number }> = {};
    const dedicated = new Map<string, number>();
    for (const slot of rosterConfig ?? []) {
      dedicated.set(slot.position, (dedicated.get(slot.position) ?? 0) + slot.slot_count);
    }
    for (const p of chipPositions) {
      const demand = Math.max(1, dedicated.get(p) ?? 0);
      const supply = myTeamCounts[p] ?? 0;
      const deficit = Math.max(0, demand - supply);
      let state: PositionNeedState;
      if (supply < demand) state = 'needs';
      else if (supply === demand) state = 'thin';
      else state = 'set';
      states[p] = { state, deficit, demand };
    }
    return states;
  }, [rosterConfig, myTeamCounts, chipPositions]);

  return { chipPositions, myTeamCounts, positionStates };
}
