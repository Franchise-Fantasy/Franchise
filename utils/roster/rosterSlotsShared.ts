/**
 * Pure roster-slot / position-eligibility primitives shared between client
 * and edge runtimes.
 *
 * No `react-native`, no `@/lib/supabase`, no Deno-specific imports — this file
 * must stay safe to import from both Metro (client) and Deno (edge functions).
 *
 * Consumed by:
 *   - utils/roster/rosterSlots.ts (client; adds display labels)
 *   - utils/roster/positionLimits.ts (client limit checker)
 *   - supabase/functions/_shared/positionLimits.ts (edge limit checker)
 *   - supabase/functions/autodraft/index.ts (edge draft autopick)
 *   - supabase/functions/make-draft-pick/index.ts (edge manual draft pick)
 */

// Position spectrum: PG → SG → SF → PF → C
// A player spanning two positions is eligible for everything in between.
// e.g. SF-PG covers PG, SG, SF.
//
// WNBA players come from BDL with bare-letter tokens ("G", "F", "G-F",
// "F-C"). Each bare token maps to a spectrum range so it works alongside
// NBA tokens — "G" covers PG–SG, "F" covers SF–PF, "G-F" covers PG–PF.
export const POSITION_SPECTRUM: string[] = ['PG', 'SG', 'SF', 'PF', 'C'];

// [start, end] indices into POSITION_SPECTRUM for every token a player
// position string can contain.
export const POSITION_TOKEN_RANGES: Record<string, [number, number]> = {
  PG: [0, 0],
  SG: [1, 1],
  SF: [2, 2],
  PF: [3, 3],
  C: [4, 4],
  G: [0, 1],   // WNBA bare guard
  F: [2, 3],   // WNBA bare forward
};

// NFL positions are DISJOINT categories, not a spectrum — a player is
// eligible only for exactly the token(s) they carry. They layer alongside
// the basketball spectrum: eligibility for these is verbatim set membership,
// with no between-positions expansion and no bare-letter parents. The token
// namespace stays unambiguous because sync-players normalizes BDL's NFL
// tokens (e.g. "PK"→"K") and filters out offensive-line "G"/"C" before
// storage, so basketball tokens never appear on NFL players. Paired with the
// SQL twin position_limit_match_keys() — change both together.
export const DISJOINT_POSITION_TOKENS: ReadonlySet<string> = new Set([
  'QB', 'RB', 'WR', 'TE', 'K', 'DST',
]);

/**
 * Structural (non-position) roster slots. Position slots (PG/SG/SF/PF/C/G/F)
 * are intentionally NOT here — those overlap with the player-position domain
 * and are handled by the eligibility helpers below. These carry roster *state*:
 *   - UTIL: flex starter (numbered UTIL1..N at runtime; baseSlotName strips it)
 *   - BE:   bench — rostered but not scored
 *   - IR:   injured reserve — not scored, eligibility-gated
 *   - TAXI: taxi squad (dynasty prospects) — not scored
 *   - DROPPED: queued-drop marker written into daily_lineups.roster_slot
 *
 * Use `ROSTER_SLOT.X` instead of bare 'TAXI' / 'DROPPED' / etc. literals so a
 * typo (e.g. 'DROPED') is a compile error rather than a silently-false
 * comparison that would mis-score a roster.
 */
export const ROSTER_SLOT = {
  UTIL: 'UTIL',
  BE: 'BE',
  IR: 'IR',
  TAXI: 'TAXI',
  DROPPED: 'DROPPED',
} as const;

export type StructuralRosterSlot = (typeof ROSTER_SLOT)[keyof typeof ROSTER_SLOT];

export const SLOT_ELIGIBLE_POSITIONS: Record<string, string[]> = {
  // Basketball
  PG: ['PG'],
  SG: ['SG'],
  SF: ['SF'],
  PF: ['PF'],
  C: ['C'],
  G: ['PG', 'SG'],
  F: ['SF', 'PF'],
  // NFL — FLEX/SFLX are set-union flex slots (like G/F, they're position
  // slots with an eligibility set, NOT UTIL-style anyone-slots).
  QB: ['QB'],
  RB: ['RB'],
  WR: ['WR'],
  TE: ['TE'],
  K: ['K'],
  DST: ['DST'],
  FLEX: ['RB', 'WR', 'TE'],
  SFLX: ['QB', 'RB', 'WR', 'TE'],
};

/** Returns the base slot name, stripping UTIL numbering (e.g. UTIL2 → UTIL). */
export function baseSlotName(slot: string): string {
  return /^UTIL\d+$/.test(slot) ? 'UTIL' : slot;
}

/** Returns all positions a player is eligible for. Basketball spectrum
 *  tokens expand to their contiguous span (bare WNBA "G"/"F" included, so
 *  combined tokens like "G-F" / "F-C" still produce contiguous spans).
 *  Disjoint NFL tokens (QB/RB/WR/TE/K/DST) pass through verbatim — no
 *  between-positions expansion. */
export function getEligiblePositions(playerPosition: string): string[] {
  const tokens = playerPosition.split('-');

  const ranges = tokens
    .map((p) => POSITION_TOKEN_RANGES[p])
    .filter((r): r is [number, number] => r !== undefined);
  const spectrum =
    ranges.length === 0
      ? []
      : POSITION_SPECTRUM.slice(
          Math.min(...ranges.map(([s]) => s)),
          Math.max(...ranges.map(([, e]) => e)) + 1,
        );

  const disjoint = tokens.filter((p) => DISJOINT_POSITION_TOKENS.has(p));
  return disjoint.length === 0 ? spectrum : [...spectrum, ...disjoint];
}

/** Returns true if a player with the given position can fill the given slot. */
export function isEligibleForSlot(playerPosition: string, slotPosition: string): boolean {
  const base = baseSlotName(slotPosition);
  if (([ROSTER_SLOT.UTIL, ROSTER_SLOT.BE, ROSTER_SLOT.IR] as string[]).includes(base)) return true;

  const eligible = SLOT_ELIGIBLE_POSITIONS[base];
  if (!eligible) return false;

  const playerPositions = getEligiblePositions(playerPosition);
  return playerPositions.some((pos) => eligible.includes(pos));
}

/** Returns every limit-key the player counts toward for position-limit
 *  purposes — based ONLY on their primary (first-listed) position, plus its
 *  bare-letter parent (G covers PG/SG; F covers SF/PF) so one check works
 *  for NBA limits (PG/SG/SF/PF/C) and WNBA limits (G/F/C) without sport
 *  branching. Unlike slot eligibility (getEligiblePositions), a secondary
 *  position (e.g. the "C" in "PF-C") does NOT count toward that position's
 *  cap — the player is still eligible to START there, just not counted
 *  against its roster limit. NBA position strings are entered with the
 *  primary position first by convention. */
export function getLimitMatchKeys(playerPosition: string): string[] {
  const [primaryToken] = playerPosition.split('-');

  // Disjoint NFL tokens count only toward their own limit key — no spectrum
  // span, no bare-letter parents.
  if (DISJOINT_POSITION_TOKENS.has(primaryToken)) return [primaryToken];

  const range = POSITION_TOKEN_RANGES[primaryToken];
  if (!range) return [];

  const eligible = POSITION_SPECTRUM.slice(range[0], range[1] + 1);
  const keys = new Set<string>(eligible);
  if (eligible.includes('PG') || eligible.includes('SG')) keys.add('G');
  if (eligible.includes('SF') || eligible.includes('PF')) keys.add('F');
  return Array.from(keys);
}

// ── Position-limit checking ──────────────────────────────────────────────────
// Lives here (not in the client/edge positionLimits.ts wrappers) so both
// runtimes share one implementation — those files are thin re-exports.

export type PositionLimits = Partial<Record<string, number | null>>;

interface RosterPlayer {
  position: string;
  roster_slot?: string;
}

const IR_TAXI_SLOTS: readonly string[] = [ROSTER_SLOT.IR, ROSTER_SLOT.TAXI];

/** Filter out IR/TAXI players — they don't count toward position limits. */
function activeOnly(roster: RosterPlayer[]): RosterPlayer[] {
  return roster.filter(
    (p) => !p.roster_slot || !IR_TAXI_SLOTS.includes(baseSlotName(p.roster_slot)),
  );
}

/** Count players per limit key (spectrum eligibility for basketball,
 *  verbatim token for disjoint NFL positions). */
function countByPosition(roster: RosterPlayer[]): Record<string, number> {
  const counts: Record<string, number> = {
    PG: 0, SG: 0, SF: 0, PF: 0, C: 0, G: 0, F: 0,
    QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DST: 0,
  };
  for (const p of roster) {
    for (const key of getLimitMatchKeys(p.position)) {
      counts[key] = (counts[key] ?? 0) + 1;
    }
  }
  return counts;
}

/**
 * Check whether adding a single player would violate any position limit.
 * Returns null if ok, or the first violated limit.
 */
export function checkPositionLimits(
  limits: PositionLimits | null | undefined,
  currentRoster: RosterPlayer[],
  incomingPlayerPosition: string,
): { position: string; current: number; max: number } | null {
  if (!limits || Object.keys(limits).length === 0) return null;

  const counts = countByPosition(activeOnly(currentRoster));
  for (const pos of getLimitMatchKeys(incomingPlayerPosition)) {
    const max = limits[pos];
    if (max != null && max > 0 && (counts[pos] ?? 0) >= max) {
      return { position: pos, current: counts[pos] ?? 0, max };
    }
  }
  return null;
}

/**
 * Check whether a full roster violates any position limit (for trades).
 * Returns null if ok, or the first violated limit.
 */
export function checkPositionLimitsForRoster(
  limits: PositionLimits | null | undefined,
  roster: RosterPlayer[],
): { position: string; count: number; max: number } | null {
  if (!limits || Object.keys(limits).length === 0) return null;

  const counts = countByPosition(activeOnly(roster));
  for (const [pos, max] of Object.entries(limits)) {
    if (max != null && max > 0 && (counts[pos] ?? 0) > max) {
      return { position: pos, count: counts[pos] ?? 0, max };
    }
  }
  return null;
}
