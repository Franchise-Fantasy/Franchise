import { DraftHubPick, DraftHubSwap } from '@/hooks/useDraftHub';

/**
 * Resolve protections after a lottery simulation.
 * If a pick's simulated slot is within the protection threshold, ownership reverts.
 * Call BEFORE resolveSwaps (protection can change ownership, affecting swap comparison).
 */
export function resolveProtections(
  picks: DraftHubPick[],
  simulatedSlots: Record<string, number>, // pick original_team_id → simulated slot_number
  nameMap: Record<string, string>,
): DraftHubPick[] {
  return picks.map((pick) => {
    if (!pick.protection_threshold || !pick.protection_owner_id) return pick;

    const slot = simulatedSlots[pick.original_team_id];
    if (slot == null) return pick;

    if (slot <= pick.protection_threshold) {
      // Protected: revert ownership to protection owner
      return {
        ...pick,
        current_team_id: pick.protection_owner_id,
        current_team_name: nameMap[pick.protection_owner_id] ?? 'Unknown',
        isTraded: pick.protection_owner_id !== pick.original_team_id,
        wasProtected: true,
      };
    }
    // Conveyed: stays with current owner
    return { ...pick, wasConveyed: true };
  });
}

/**
 * Resolve swaps after a lottery simulation.
 * For each swap, compare the two teams' pick slots and give the beneficiary the better one.
 * Call AFTER resolveProtections.
 */
export function resolveSwaps(
  picks: DraftHubPick[],
  swaps: DraftHubSwap[],
  season: string,
  simulatedSlots: Record<string, number>,
  nameMap: Record<string, string>,
): DraftHubPick[] {
  const result = picks.map((p) => ({ ...p }));

  for (const swap of swaps.filter((s) => s.season === season)) {
    const benefPick = result.find(
      (p) => p.round === swap.round && p.current_team_id === swap.beneficiary_team_id,
    );
    const counterPick = result.find(
      (p) => p.round === swap.round && p.current_team_id === swap.counterparty_team_id,
    );

    if (!benefPick || !counterPick) continue;

    const benefSlot = simulatedSlots[benefPick.original_team_id] ?? benefPick.slot_number ?? 999;
    const counterSlot = simulatedSlots[counterPick.original_team_id] ?? counterPick.slot_number ?? 999;

    if (counterSlot < benefSlot) {
      // Counterparty has the better pick — swap current_team_ids
      const tempId = benefPick.current_team_id;
      const tempName = benefPick.current_team_name;
      benefPick.current_team_id = counterPick.current_team_id;
      benefPick.current_team_name = counterPick.current_team_name;
      counterPick.current_team_id = tempId;
      counterPick.current_team_name = tempName;
      benefPick.wasSwapped = true;
      counterPick.wasSwapped = true;
    }
  }

  return result;
}
