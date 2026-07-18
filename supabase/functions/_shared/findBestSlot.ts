import { isEligibleForSlot } from '../../../utils/roster/rosterSlotsShared.ts';

/**
 * Pick the best roster_slot for a newly drafted player. Pure — the caller holds
 * the league's roster config and the team's current roster (so it can be run
 * repeatedly against an in-memory roster that grows as picks are assigned).
 *
 * Shared by the live draft (make-draft-pick) and the offline draft
 * (offline-draft) so both place drafted players identically. Starters fill
 * first (in config order), then UTIL, then bench.
 */
export function findBestSlot(
  configs: Array<{ position: string; slot_count: number }>,
  currentPlayers: Array<{ roster_slot: string | null }>,
  playerPosition: string,
): string {
  const occupiedSlots = new Set<string>(
    currentPlayers.map((p) => p.roster_slot ?? 'BE'),
  );

  const starterConfigs = configs.filter((c) => c.position !== 'BE' && c.position !== 'IR');
  for (const config of starterConfigs) {
    if (!isEligibleForSlot(playerPosition, config.position)) continue;
    if (config.position === 'UTIL') {
      for (let i = 1; i <= config.slot_count; i++) {
        const slot = `UTIL${i}`;
        if (!occupiedSlots.has(slot)) return slot;
      }
    } else {
      let filled = 0;
      for (const p of currentPlayers) {
        if (p.roster_slot === config.position) filled++;
      }
      if (filled < config.slot_count) return config.position;
    }
  }

  return 'BE';
}
