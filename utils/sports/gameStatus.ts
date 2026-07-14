/**
 * BDL game-status → the app's numeric `game_status` (1 scheduled / 2 live / 3 final).
 *
 * Zero-dep so both Deno (supabase/functions/_shared/bdl.ts re-exports it) and
 * jest can load it — the previous home, bdl.ts, reads `Deno.env` at module
 * scope and is unloadable from the client test runner. This function decides
 * whether a game is live, which gates live scoring, the matchup ticker, and the
 * player_games write, so it is worth having under test.
 */

export type GameStatusSport = 'nba' | 'wnba' | 'nfl';

/**
 * BDL's NFL pre-game status is the kickoff slate itself — "9/9 - 8:20 PM EDT".
 * (Verified against the full 2026 schedule: every unplayed game carries one.)
 */
const NFL_SCHEDULED_STATUS = /^\d{1,2}\/\d{1,2}\s*-\s*\d{1,2}:\d{2}/;

/**
 * NBA reports "Q1"/"Q3"/"OT" while in-progress and "Final" when over.
 * WNBA reports the verbatim strings "pre" / "in" / "post".
 * Halftime appears as "Half" in NBA feeds.
 *
 * The `/^final/i` prefix match is load-bearing, not cosmetic: **NFL reports
 * overtime finals as "Final/OT"** (18 of 298 games in 2025 — about one a week).
 * An exact `=== "Final"` test misses those, and "Final/OT" then matches the `OT`
 * in the live-quarter pattern below, so every OT game would be pinned "in
 * progress" forever: never finalizing, never writing player_games. Basketball is
 * unaffected — BDL emits a bare "Final" for NBA and "post" for WNBA even on OT
 * games (verified across all 1322 NBA + 312 WNBA games of 2025, 69 of them OT) —
 * so the prefix match is a no-op there.
 *
 * NFL live strings are *unobservable* until a real slate: BDL carries no
 * preseason, and the 2025 season is over, so every past game reads "Final".
 * Rather than guess the vocabulary, the NFL branch decides from ground truth we
 * already hold — a game cannot be live before its kickoff, and once kickoff has
 * passed, a not-yet-final game IS live whatever BDL chooses to call it. An
 * unrecognized string therefore reads LIVE, not scheduled. That is the safe
 * direction: a live game misread as "scheduled" silently never scores all day,
 * while one misread as "live" merely polls a few times and finds no stats.
 */
export function mapGameStatus(
  status: string,
  sport: GameStatusSport = 'nba',
  /** BDL `game.date` (ISO kickoff). Lets NFL ignore the status vocabulary. */
  kickoffIso?: string | null,
  /** Injectable clock — tests pass a fixed instant. */
  nowMs: number = Date.now(),
): number {
  if (/^final/i.test(status) || status === 'post') return 3;
  if (status === 'in') return 2;

  if (sport === 'nfl') {
    if (NFL_SCHEDULED_STATUS.test(status)) return 1;
    const kickoff = kickoffIso ? Date.parse(kickoffIso) : NaN;
    if (!Number.isNaN(kickoff) && nowMs < kickoff) return 1;
    return status.trim() ? 2 : 1;
  }

  if (/Qtr|Half|OT|Q\d/i.test(status)) return 2;
  return 1;
}
