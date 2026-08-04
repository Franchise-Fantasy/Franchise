/**
 * Coerce BDL position strings to a normalized form per sport.
 *
 * Zero-dep so both Deno (supabase/functions/_shared/bdl.ts re-exports it) and
 * jest can load it — same treatment as gameStatus.ts / bdlDates.ts.
 *
 * Basketball (NBA + WNBA): BDL returns COARSE tokens only — "G", "F", "C"
 * and hyphenated combos (verified 2026-08-03 across the full NBA
 * /players/active feed: zero granular PG/SG/SF/PF tokens). Coarse tokens
 * pass through verbatim: getEligiblePositions expands "G" → PG+SG and
 * "F" → SF+PF, so slot eligibility, FA filters, and position limits all
 * work. Hyphen direction is normalized ("F-G" → "G-F", "C-F" → "F-C") so
 * duplicate spelling variants don't accumulate.
 *
 * Do NOT map bare letters to granular positions ("G" → "SG") — that
 * fabricates specificity BDL doesn't have. That mapping once left the NBA
 * pool with 236 SGs and 2 PGs: sync-players overwrote Sleeper's granular
 * positions with the coerced tokens every night. Granular NBA positions
 * come from Sleeper (backend/sync_positions.py); sync-players only
 * BACKFILLS null NBA positions and never overwrites (see its update loop).
 *
 * NFL: BDL's `position_abbreviation` tokens map to the app's disjoint set
 * (QB/RB/WR/TE/K). "PK" → "K"; fullbacks roster as RBs. Returns null for
 * any other token (OL/IDP/UNK) — sync-players drops those players, which
 * is also what keeps BDL's offensive-line "G"/"C" tokens from colliding
 * with the basketball spectrum.
 */

export type BdlPositionSport = 'nba' | 'wnba' | 'nfl';

const NFL_POSITION_MAP: Record<string, string> = {
  QB: 'QB',
  RB: 'RB',
  FB: 'RB',
  WR: 'WR',
  TE: 'TE',
  PK: 'K',
  K: 'K',
};

// Reversed-hyphen spellings normalized to the canonical direction.
const BASKETBALL_POSITION_MAP: Record<string, string> = {
  'F-G': 'G-F',
  'C-F': 'F-C',
};

export function coerceBdlPosition(
  raw: string | null | undefined,
  sport: BdlPositionSport = 'nba',
): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().toUpperCase();
  if (!trimmed) return null;

  if (sport === 'nfl') {
    return NFL_POSITION_MAP[trimmed] ?? null;
  }

  return BASKETBALL_POSITION_MAP[trimmed] ?? trimmed;
}
