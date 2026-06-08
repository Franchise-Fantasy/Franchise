import { type MatchupRow } from "@/utils/scoring/allPlayRecord";

import { resolveStandings, type TeamStanding } from "./standingsResolve";

// Pure clinch/elimination logic, split out of components/home/StandingsSection
// so it can be unit-tested without the RN/supabase render tree (mirrors the
// resolveStandings split in standingsResolve.ts). Consumed by StandingsSection
// (home) and app/standings.tsx (full standings page) — keep both on this module
// so the seeding logic can't drift between the two surfaces.

export type PlayoffStatus = 'clinched' | 'eliminated' | null;

/**
 * Compute playoff clinch/elimination status for each team.
 *
 * Runs two simulations per team:
 * - Worst case: team loses all remaining, every other team wins all remaining.
 *   If team still finishes top N under current tiebreakers, they've clinched.
 * - Best case: team wins all remaining, every other team loses all remaining.
 *   If team still misses top N, they're eliminated.
 *
 * Sound but not tight — opponents can't all win/lose when they play each other,
 * so some late clinches may not light up until the math is unambiguous.
 */
export function computePlayoffStatuses(
  standings: (TeamStanding & { rank: number })[],
  remainingGames: Map<string, number>,
  playoffTeams: number,
  matchups: MatchupRow[],
  tiebreakerOrder: string[],
): Map<string, PlayoffStatus> {
  const statuses = new Map<string, PlayoffStatus>();
  const totalTeams = standings.length;
  if (playoffTeams <= 0 || playoffTeams >= totalTeams) return statuses;

  // Clinch/elimination is only meaningful once the season is under way. Before
  // any game is decided every team is 0-0-0, which resolveStandings collapses
  // into one tied group ranked by array order — so a pre-draft / pre-week-1
  // league would otherwise flag the first N teams "clinched" and the rest
  // "eliminated" with zero games played (the pre-draft league has no
  // league_matchups rows yet, so remainingGames is empty and both simulations
  // equal the live 0-0-0 standings). Gate on real results, not on the schedule
  // existing — the schedule isn't generated until the draft completes.
  const anyGamesPlayed = standings.some(
    (t) => t.wins + t.losses + t.ties > 0,
  );
  if (!anyGamesPlayed) return statuses;

  for (const team of standings) {
    const worstCase = standings.map((t) => {
      const remaining = remainingGames.get(t.id) ?? 0;
      return t.id === team.id
        ? { ...t, losses: t.losses + remaining }
        : { ...t, wins: t.wins + remaining };
    });
    const worstRank = resolveStandings(worstCase, matchups, tiebreakerOrder)
      .find((t) => t.id === team.id)?.rank ?? Infinity;
    if (worstRank <= playoffTeams) {
      statuses.set(team.id, 'clinched');
      continue;
    }

    const bestCase = standings.map((t) => {
      const remaining = remainingGames.get(t.id) ?? 0;
      return t.id === team.id
        ? { ...t, wins: t.wins + remaining }
        : { ...t, losses: t.losses + remaining };
    });
    const bestRank = resolveStandings(bestCase, matchups, tiebreakerOrder)
      .find((t) => t.id === team.id)?.rank ?? Infinity;
    if (bestRank > playoffTeams) {
      statuses.set(team.id, 'eliminated');
      continue;
    }

    statuses.set(team.id, null);
  }

  return statuses;
}
