import type { ScreenshotPlayerMatch, ScreenshotUnmatched } from '@/hooks/useImportScreenshot';

/** A manual correction/resolution keyed by extracted-player index. */
type Override = { player_id: string; name: string; position: string };

export interface RosterPlayerEntry {
  player_id: string;
  position: string;
  roster_slot: string | null;
}

/**
 * Merges a team's auto-matched players, manual corrections, and manually
 * resolved unmatched players into the flat roster payload the `execute` and
 * `import_team_roster` edge actions expect. Shared by the create-league
 * wizard (ScreenshotImport) and the post-creation commissioner import
 * (ImportTeamRosterModal) so the two stay byte-for-byte in agreement.
 *
 * A `resolvedMappings` entry keyed by a MATCHED player's index overrides that
 * auto-match (keeping the matched row's roster slot). One keyed by an
 * unmatched index adds a new roster entry (using the unmatched row's slot).
 * Skipped players never appear here — the caller filters them out of
 * `resolvedMappings` by simply never resolving them.
 */
export function buildRosterPlayers(
  matched: ScreenshotPlayerMatch[],
  unmatched: ScreenshotUnmatched[],
  resolvedMappings: Map<number, Override>,
): RosterPlayerEntry[] {
  const players: RosterPlayerEntry[] = [];
  const matchedIndices = new Set(matched.map((m) => m.index));

  for (const m of matched) {
    const override = resolvedMappings.get(m.index);
    players.push({
      player_id: override?.player_id ?? m.matched_player_id,
      position: override?.position ?? m.matched_position,
      roster_slot: m.roster_slot,
    });
  }

  for (const [index, resolved] of resolvedMappings) {
    if (matchedIndices.has(index)) continue; // already applied as an override above
    const original = unmatched.find((u) => u.index === index);
    players.push({
      player_id: resolved.player_id,
      position: resolved.position,
      roster_slot: original?.roster_slot ?? null,
    });
  }

  return players;
}
