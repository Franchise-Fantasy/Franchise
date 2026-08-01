import { getSeasonEnd, getSeasonStart, type Sport } from '@/constants/LeagueDefaults';
import { ROSTER_SLOT } from '@/utils/roster/rosterSlotsShared';

/**
 * Expected points a roster actually STARTS on an average day.
 *
 * The naive "roster strength" number — summing every active player's FPTS/G —
 * answers a question nobody asks: what a team would score if all 12 of its
 * players played on the same day and every one of them could be started. Two
 * things break that. Only the starting slots score (this league starts 9 of
 * 12), and an NBA player only has a game on ~47% of days. So the sum runs
 * roughly 2.5x hot and, because it counts bodies, it moves when a manager
 * stashes someone on IR rather than when the roster gets better or worse.
 *
 * What follows models the real thing: each player has a game with probability
 * `playRate`, and a manager fills the starting slots with the best of whoever
 * is playing that day. A player therefore scores when they have a game AND
 * fewer than `seats` better teammates also have one — so depth is worth real
 * points up to the point where it starts colliding with the seat limit, and
 * worth progressively less after that.
 */

/**
 * Regular-season games each pro team plays, and how many days a week the sport
 * actually plays on.
 *
 * `slateDaysPerWeek` is what keeps the model honest across sports. Basketball
 * spreads its games over the whole week, so whether one player has a game is
 * near enough independent of whether another does, and the seat limit rarely
 * binds. The NFL is the opposite: every rostered player features in the same
 * weekly slate, so the cap bites on that one day and nothing scores on the
 * other six. Treating an NFL roster as "16 players each 14% likely to play
 * today" would count every bench body at full value — the same overcount this
 * whole metric exists to remove.
 */
const SPORT_SCHEDULE: Partial<Record<Sport, { gamesPerSeason: number; slateDaysPerWeek: number }>> =
  {
    nba: { gamesPerSeason: 82, slateDaysPerWeek: 7 },
    wnba: { gamesPerSeason: 44, slateDaysPerWeek: 7 },
    nfl: { gamesPerSeason: 17, slateDaysPerWeek: 1 },
  };

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface DailySchedule {
  /** Probability a player has a game on a day their sport plays. */
  playRate: number;
  /** Share of calendar days that are game days — 1 for basketball, 1/7 for the
   *  NFL's single weekly slate. Converts a per-slate expectation to per-day. */
  slateShare: number;
  /** Games a player averages per week. Display only — the metric is built from
   *  the two fields above. */
  gamesPerWeek: number;
}

/**
 * How often a player of this sport has a game, derived from games per team per
 * season over the length of the season. Uniform across a sport: every NBA team
 * plays the same 82 games across the same calendar, so a per-team refinement
 * would only matter over a window shorter than the season.
 *
 * Null when the sport or its season dates are unknown (an unsupported sport, or
 * a season past the end of the hardcoded tables with a cold season-config
 * cache) — callers should hide the metric rather than show a guessed rate.
 */
export function dailySchedule(sport: Sport, season: string): DailySchedule | null {
  const model = SPORT_SCHEDULE[sport];
  const start = getSeasonStart(sport, season);
  const end = getSeasonEnd(sport, season);
  if (!model || !start || !end) return null;

  const days = Math.round((Date.parse(end) - Date.parse(start)) / MS_PER_DAY) + 1;
  if (days <= 0) return null;

  const slateShare = model.slateDaysPerWeek / 7;
  const perCalendarDay = model.gamesPerSeason / days;
  return {
    playRate: Math.min(perCalendarDay / slateShare, 1),
    slateShare,
    gamesPerWeek: Math.min(perCalendarDay * 7, model.slateDaysPerWeek),
  };
}

/** How many players a team starts each day — every configured slot except the
 *  bench and the two holding slots (IR / taxi players don't score). */
export function countStartingSlots(
  slots: { position: string; slot_count: number }[] | undefined,
): number {
  if (!slots) return 0;
  let total = 0;
  for (const s of slots) {
    if (s.position === ROSTER_SLOT.BE) continue;
    if (s.position === ROSTER_SLOT.IR) continue;
    if (s.position === ROSTER_SLOT.TAXI) continue;
    total += s.slot_count;
  }
  return total;
}

/**
 * Expected starting-lineup fantasy points per day for one roster.
 *
 * `fptsPerGame` is every active player's per-game average (any order); `seats`
 * is the number of starting slots; `schedule` comes from `dailySchedule`.
 *
 * Players are ranked by FPTS/G, then each one's expected contribution on a
 * game day is `fpts × playRate × P(fewer than `seats` better teammates are also
 * playing)`. That probability comes from rolling the distribution of "how many
 * of the players above this one have a game" forward one player at a time —
 * exact, not simulated. The slate total is then spread across the week by
 * `slateShare`. Zero-scoring players are dropped: they contribute nothing and,
 * sorted last, block nobody.
 *
 * Simplification: position eligibility is ignored, so this is the ceiling a
 * manager reaches when the playing set can legally fill the slots. With 12
 * players at a 47% play rate only ~5.6 have a game on a typical NBA day, well
 * under the 9 seats, so games — not positions — are what actually bind.
 */
export function expectedDailyFpts(
  fptsPerGame: number[],
  seats: number,
  schedule: DailySchedule | null | undefined,
): number {
  if (!schedule || seats <= 0 || schedule.playRate <= 0) return 0;
  const { playRate, slateShare } = schedule;
  const ranked = fptsPerGame.filter((f) => f > 0).sort((a, b) => b - a);

  // blockers[k] = P(exactly k of the players ranked above the current one have
  // a game today). Starts as "nobody above the best player".
  let blockers = [1];
  let total = 0;
  for (const fpts of ranked) {
    let pStarts = 0;
    for (let k = 0; k < Math.min(seats, blockers.length); k++) pStarts += blockers[k];
    total += fpts * playRate * pStarts;

    // Fold this player in for everyone ranked below them.
    const next = new Array(blockers.length + 1).fill(0);
    for (let k = 0; k < blockers.length; k++) {
      next[k] += blockers[k] * (1 - playRate);
      next[k + 1] += blockers[k] * playRate;
    }
    blockers = next;
  }
  return Math.round(total * slateShare * 10) / 10;
}
