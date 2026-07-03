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

/**
 * Largest playoff-week count `totalTeams` can support — the biggest
 * PLAYOFF_OPTIONS bucket whose smallest bracket still fits the league.
 * 2 teams → 1 week (a single final); 3-4 → 2; 5-9 → 3; 10+ → 4.
 * Steppers and reducers cap playoff weeks here so the chosen week count can
 * never exceed the rounds the bracket actually plays — the engine runs one
 * round per week, so excess weeks would sit at the end of the schedule empty.
 */
export function maxPlayoffWeeksForTeams(totalTeams: number): number {
  let max = 1;
  for (const [weeks, options] of Object.entries(PLAYOFF_OPTIONS)) {
    if (options[0] <= totalTeams) max = Math.max(max, Number(weeks));
  }
  return max;
}

/** Closest valid bracket size to `desired` for the given weeks/teams
 *  (ties favor the smaller bracket). */
export function snapPlayoffTeams(desired: number, playoffWeeks: number, totalTeams: number): number {
  const options = getPlayoffTeamOptions(playoffWeeks, totalTeams);
  if (options.includes(desired)) return desired;
  return options.reduce(
    (best, o) => (Math.abs(o - desired) < Math.abs(best - desired) ? o : best),
    options[0],
  );
}

/**
 * Default bracket size: the valid option closest to ~60% of the league
 * making the playoffs (the standard 6-of-10 convention), rather than the
 * largest bracket that fits.
 */
export function defaultPlayoffTeams(playoffWeeks: number, totalTeams: number): number {
  return snapPlayoffTeams(Math.ceil(totalTeams * 0.6), playoffWeeks, totalTeams);
}

/**
 * Teams-first playoff defaults. Weeks follow from the bracket the league can
 * actually field (2 teams → a 1-week final, not the sport max), capped at the
 * conventional 3 and — when the remaining calendar is known — at half the
 * schedulable window so a late-created league still gets a real regular season.
 */
export function defaultPlayoffSetup(
  totalTeams: number,
  maxTotalWeeks?: number,
): { playoffWeeks: number; playoffTeams: number } {
  let playoffWeeks = Math.min(3, maxPlayoffWeeksForTeams(totalTeams));
  if (maxTotalWeeks !== undefined) {
    playoffWeeks = Math.max(1, Math.min(playoffWeeks, Math.floor(maxTotalWeeks / 2)));
  }
  return { playoffWeeks, playoffTeams: defaultPlayoffTeams(playoffWeeks, totalTeams) };
}

/** The subset of wizard state {@link clampLotteryState} re-validates. */
export interface LotteryClampFields {
  teams: number;
  playoffWeeks: number;
  playoffTeams: number;
  lotteryDraws: number;
  lotteryOdds: number[] | null;
}

/**
 * Re-validate playoff-teams + lottery settings after teams / playoffWeeks /
 * playoffTeams change: snaps playoffTeams to the closest valid bracket option,
 * shrinks lotteryDraws to the pool, and resets custom odds whose length no
 * longer matches. Shared by the create-league, Sleeper-import, and
 * screenshot-import wizard reducers.
 */
export function clampLotteryState<T extends LotteryClampFields>(s: T): T {
  const playoffTeams = snapPlayoffTeams(s.playoffTeams, s.playoffWeeks, s.teams);
  const pool = calcLotteryPoolSize(s.teams, playoffTeams);
  const draws = pool > 0 ? Math.min(s.lotteryDraws, pool) : 0;
  // Reset custom odds when pool size changes (they'd be the wrong length)
  const odds = s.lotteryOdds && s.lotteryOdds.length !== pool ? null : s.lotteryOdds;
  return { ...s, playoffTeams, lotteryDraws: draws, lotteryOdds: odds };
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
