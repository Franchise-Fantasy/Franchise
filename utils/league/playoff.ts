// Pure bracket utility functions — no DB calls.
// Used by both edge functions and client.

export interface SeedEntry {
  teamId: string;
  seed: number;
}

export interface BracketPairing {
  teamA: SeedEntry;
  teamB: SeedEntry | null; // null = bye
}

/** Smallest power of 2 >= n. e.g. 6→8, 8→8 */
export function nextPowerOf2(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

/** How many first-round byes are needed */
export function calcByes(playoffTeams: number): number {
  return nextPowerOf2(playoffTeams) - playoffTeams;
}

/** Total rounds in the bracket */
export function calcRounds(playoffTeams: number): number {
  return Math.log2(nextPowerOf2(playoffTeams));
}

/**
 * Human-readable label for a playoff round. Matches the conventions used in
 * schedule, scoreboard, and matchup-detail views.
 *   round === totalRounds       → "Finals"
 *   round === totalRounds - 1   → "Semifinals"
 *   round === totalRounds - 2   → "Quarterfinals"
 *   isThirdPlace overrides everything → "3rd Place Game"
 *   else                         → "Playoff Round N"
 */
export function getPlayoffRoundLabel(
  round: number,
  totalRounds: number,
  isThirdPlace: boolean,
): string {
  if (isThirdPlace) return '3rd Place Game';
  if (round === totalRounds) return 'Finals';
  if (round === totalRounds - 1) return 'Semifinals';
  if (round === totalRounds - 2) return 'Quarterfinals';
  return `Playoff Round ${round}`;
}

/**
 * Seed the top N teams from standings.
 * Input must already be sorted by wins DESC, points_for DESC.
 */
export function seedTeams(
  sortedStandings: { id: string; wins: number; points_for: number }[],
  playoffTeams: number,
): SeedEntry[] {
  return sortedStandings
    .slice(0, playoffTeams)
    .map((t, i) => ({ teamId: t.id, seed: i + 1 }));
}

/**
 * Standard bracket position ordering (recursive).
 * For n=8: [1,8,5,4,3,6,7,2]
 * Ensures proper bracket progression: 1v8/4v5 feed into one semi,
 * 3v6/2v7 feed into the other.
 */
export function generateBracketPositions(n: number): number[] {
  if (n === 1) return [1];
  const half = generateBracketPositions(n / 2);
  const result: number[] = [];
  for (const h of half) {
    result.push(h, n + 1 - h);
  }
  return result;
}

/**
 * Build Round 1 pairings using proper bracket positions.
 * Uses generateBracketPositions so that byes are spread across both halves
 * of the bracket (e.g. 1-bye and 4v5 on one side, 3v6 and 2-bye on the other).
 * Higher seed is always teamA; missing seeds become byes (teamB = null).
 *
 * Used by both "standard" and "fixed" formats — round 1 matchups are
 * identical, the formats only differ in how subsequent rounds are built.
 */
function buildRound1(seeds: SeedEntry[]): BracketPairing[] {
  const n = nextPowerOf2(seeds.length);
  const positions = generateBracketPositions(n);
  const seedMap = new Map<number, SeedEntry>();
  for (const s of seeds) seedMap.set(s.seed, s);

  const matchups: BracketPairing[] = [];
  for (let i = 0; i < n; i += 2) {
    const a = seedMap.get(positions[i]) ?? null;
    const b = seedMap.get(positions[i + 1]) ?? null;
    if (a && b) {
      // Both exist: higher seed (lower number) is teamA
      matchups.push(a.seed < b.seed ? { teamA: a, teamB: b } : { teamA: b, teamB: a });
    } else if (a) {
      matchups.push({ teamA: a, teamB: null });
    } else if (b) {
      matchups.push({ teamA: b, teamB: null });
    }
  }
  return matchups;
}

export function buildStandardRound1(seeds: SeedEntry[]): BracketPairing[] {
  return buildRound1(seeds);
}

export function buildFixedRound1(seeds: SeedEntry[]): BracketPairing[] {
  return buildRound1(seeds);
}

export interface RoundResult {
  bracket_position: number;
  winner_id: string;
  winner_seed: number;
}

/**
 * Build next-round matchups from previous round results.
 *
 * - standard + reseed=true: re-rank remaining by seed, pair highest vs lowest
 * - standard + reseed=false / fixed: adjacent bracket_positions feed forward
 * - higher_seed_picks: returns null (matchups determined by picks)
 */
export function buildNextRound(
  format: 'standard' | 'fixed' | 'higher_seed_picks',
  reseed: boolean,
  results: RoundResult[],
): BracketPairing[] | null {
  if (format === 'higher_seed_picks') return null;

  if (format === 'standard' && reseed) {
    // Re-rank remaining by original seed, pair highest vs lowest
    const sorted = [...results].sort((a, b) => a.winner_seed - b.winner_seed);
    const matchups: BracketPairing[] = [];
    for (let i = 0; i < sorted.length / 2; i++) {
      matchups.push({
        teamA: { teamId: sorted[i].winner_id, seed: sorted[i].winner_seed },
        teamB: {
          teamId: sorted[sorted.length - 1 - i].winner_id,
          seed: sorted[sorted.length - 1 - i].winner_seed,
        },
      });
    }
    return matchups;
  }

  // Fixed or standard + no reseed: adjacent bracket positions feed forward
  const sorted = [...results].sort((a, b) => a.bracket_position - b.bracket_position);
  const matchups: BracketPairing[] = [];
  for (let i = 0; i < sorted.length; i += 2) {
    matchups.push({
      teamA: { teamId: sorted[i].winner_id, seed: sorted[i].winner_seed },
      teamB: {
        teamId: sorted[i + 1].winner_id,
        seed: sorted[i + 1].winner_seed,
      },
    });
  }
  return matchups;
}
