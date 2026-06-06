/**
 * Curated playoff team options that produce valid single-elimination brackets.
 * Numbers below 2^weeks mean top seeds get first-round byes.
 *
 * The playoff engine plays exactly one round per playoff week and runs
 * `calcRounds(playoffTeams) = log2(nextPow2(teams))` rounds, so each bucket's
 * SMALLEST team count must need exactly that many rounds — otherwise a chosen
 * week count exceeds the rounds played and the schedule gets a trailing empty
 * playoff week the engine never fills. That's why 4 isn't offered at 3 weeks
 * (4 teams = 2 rounds) and 8 isn't offered at 4 weeks (8 teams = 3 rounds).
 */
const PLAYOFF_OPTIONS: Record<number, number[]> = {
  1: [2],
  2: [3, 4],
  3: [5, 6, 8],
  4: [10, 12, 16],
};

export function getPlayoffTeamOptions(playoffWeeks: number, totalTeams: number): number[] {
  if (totalTeams < 2) return [0];
  const raw = PLAYOFF_OPTIONS[playoffWeeks] ?? [2 ** playoffWeeks];
  const filtered = raw.filter((n) => n <= totalTeams);
  return filtered.length > 0 ? filtered : [2];
}

export function defaultPlayoffTeams(playoffWeeks: number, totalTeams: number): number {
  const options = getPlayoffTeamOptions(playoffWeeks, totalTeams);
  return options[options.length - 1] ?? 0;
}

export function calcLotteryPoolSize(totalTeams: number, playoffTeams: number): number {
  return Math.max(0, totalTeams - playoffTeams);
}

/**
 * Generate default lottery odds using linear weighting.
 * Worst team gets the highest weight, best lottery team gets the lowest.
 * Returns percentages summing to 100 (rounded to 1 decimal).
 */
export function generateDefaultOdds(numTeams: number): number[] {
  if (numTeams <= 0) return [];
  if (numTeams === 1) return [100];

  const weights = Array.from({ length: numTeams }, (_, i) => numTeams - i);
  const total = weights.reduce((a, b) => a + b, 0);
  const raw = weights.map((w) => Math.round((w / total) * 1000) / 10);

  // Fix rounding so it sums to exactly 100
  return normalizeOdds(raw);
}

/**
 * Adjust an odds array so it sums to exactly 100.
 * Distributes rounding error to the first element.
 */
export function normalizeOdds(odds: number[]): number[] {
  if (odds.length === 0) return [];
  const rounded = odds.map((v) => Math.round(v * 10) / 10);
  const sum = rounded.reduce((a, b) => a + b, 0);
  const diff = Math.round((100 - sum) * 10) / 10;
  rounded[0] = Math.round((rounded[0] + diff) * 10) / 10;
  return rounded;
}

/**
 * Resize an odds array when the lottery pool size changes.
 * If growing, appends proportionally smaller entries.
 * If shrinking, removes from the end and renormalizes.
 */
export function resizeOdds(current: number[], newSize: number): number[] {
  if (newSize <= 0) return [];
  if (current.length === newSize) return current;
  if (current.length === 0) return generateDefaultOdds(newSize);

  // Just regenerate defaults — trying to preserve custom values across
  // size changes is brittle and confusing for commissioners.
  return generateDefaultOdds(newSize);
}
