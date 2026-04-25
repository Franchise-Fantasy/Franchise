/**
 * All-Play Record & Luck Index calculations.
 *
 * All-play compares each team's weekly score against every other team
 * in the league (not just their actual opponent). The resulting win%
 * is a better measure of "true strength" than H2H record alone.
 *
 * Luck Index = actualWins − expectedWins (from all-play win%).
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface WeeklyAllPlay {
  weekNumber: number;
  teamScore: number;
  wins: number;
  losses: number;
  ties: number;
  /** 1-based rank among all teams that week (1 = highest scorer) */
  rankAmongAll: number;
  actualResult: 'W' | 'L' | 'T';
}

export interface AllPlayResult {
  teamId: string;
  allPlayWins: number;
  allPlayLosses: number;
  allPlayTies: number;
  /** (W + 0.5 * T) / total */
  allPlayWinPct: number;
  /** allPlayWinPct × gamesPlayed */
  expectedWins: number;
  /** actualWins − expectedWins */
  luckIndex: number;
  weeklyBreakdown: WeeklyAllPlay[];
}

export interface CategoryResultEntry {
  stat: string;
  home: number;
  away: number;
  winner: 'home' | 'away' | 'tie';
}

export interface MatchupRow {
  week_number: number;
  home_team_id: string;
  away_team_id: string | null;
  home_score: number;
  away_score: number;
  winner_team_id: string | null;
  home_category_wins?: number | null;
  away_category_wins?: number | null;
  category_results?: CategoryResultEntry[] | null;
}

export interface ScoringCategory {
  stat_name: string;
  inverse?: boolean;
}

export interface TeamRecord {
  id: string;
  wins: number;
  losses: number;
  ties: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Extract each team's score for a given week from the matchup rows (points leagues). */
function weekScores(
  weekMatchups: MatchupRow[],
): Map<string, number> {
  const scores = new Map<string, number>();

  for (const m of weekMatchups) {
    scores.set(m.home_team_id, Number(m.home_score));

    if (m.away_team_id) {
      scores.set(m.away_team_id, Number(m.away_score));
    }
  }

  return scores;
}

/** Extract each team's per-category stats for a given week from category_results. */
function weekCategoryStats(
  weekMatchups: MatchupRow[],
): Map<string, Record<string, number>> {
  const stats = new Map<string, Record<string, number>>();

  for (const m of weekMatchups) {
    if (!m.category_results || !m.away_team_id) continue;
    const homeStats: Record<string, number> = {};
    const awayStats: Record<string, number> = {};
    for (const cr of m.category_results) {
      homeStats[cr.stat] = cr.home;
      awayStats[cr.stat] = cr.away;
    }
    stats.set(m.home_team_id, homeStats);
    stats.set(m.away_team_id, awayStats);
  }

  return stats;
}

/**
 * Simulate a head-to-head category matchup between two teams.
 * Returns 'W' if teamA wins more categories, 'L' if fewer, 'T' if tied.
 */
function simulateCategoryMatchup(
  statsA: Record<string, number>,
  statsB: Record<string, number>,
  categories: ScoringCategory[],
): 'W' | 'L' | 'T' {
  let aWins = 0;
  let bWins = 0;

  for (const cat of categories) {
    const a = statsA[cat.stat_name] ?? 0;
    const b = statsB[cat.stat_name] ?? 0;
    if (a === b) continue;
    if (cat.inverse) {
      if (a < b) aWins++; else bWins++;
    } else {
      if (a > b) aWins++; else bWins++;
    }
  }

  if (aWins > bWins) return 'W';
  if (bWins > aWins) return 'L';
  return 'T';
}

/** Determine a team's actual result for a matchup they participated in. */
function actualResult(
  matchup: MatchupRow,
  teamId: string,
): 'W' | 'L' | 'T' {
  if (!matchup.winner_team_id) return 'T';
  return matchup.winner_team_id === teamId ? 'W' : 'L';
}

// ─── Core ────────────────────────────────────────────────────────────────────

/**
 * Compute all-play records and luck index for every team in the league.
 *
 * For points leagues: compares each team's weekly score against every other team.
 * For category leagues: simulates actual category-by-category matchups using
 * the raw stats from category_results, so the result reflects who would truly
 * win each hypothetical head-to-head.
 *
 * @param matchups       All finalized regular-season matchups (playoff_round IS NULL)
 * @param teams          Team records (for actual W-L-T)
 * @param scoringType    'h2h_categories' uses category simulation; anything else uses points
 * @param categories     Scoring categories with inverse flags (required for h2h_categories)
 */
export function computeAllPlayRecords(
  matchups: MatchupRow[],
  teams: TeamRecord[],
  scoringType?: string,
  categories?: ScoringCategory[],
): AllPlayResult[] {
  if (!matchups.length || !teams.length) return [];

  const isCategories = scoringType === 'h2h_categories';

  // Group matchups by week
  const byWeek = new Map<number, MatchupRow[]>();
  for (const m of matchups) {
    const week = m.week_number;
    if (!byWeek.has(week)) byWeek.set(week, []);
    byWeek.get(week)!.push(m);
  }

  // Sort weeks for consistent ordering
  const weeks = [...byWeek.keys()].sort((a, b) => a - b);

  // Build a lookup: teamId → { matchup, weekNumber } for actual results
  const teamMatchupByWeek = new Map<string, Map<number, MatchupRow>>();
  for (const m of matchups) {
    if (!teamMatchupByWeek.has(m.home_team_id)) {
      teamMatchupByWeek.set(m.home_team_id, new Map());
    }
    teamMatchupByWeek.get(m.home_team_id)!.set(m.week_number, m);

    if (m.away_team_id) {
      if (!teamMatchupByWeek.has(m.away_team_id)) {
        teamMatchupByWeek.set(m.away_team_id, new Map());
      }
      teamMatchupByWeek.get(m.away_team_id)!.set(m.week_number, m);
    }
  }

  // Accumulate all-play results per team
  const results = new Map<string, {
    apW: number; apL: number; apT: number;
    weekly: WeeklyAllPlay[];
  }>();

  for (const t of teams) {
    results.set(t.id, { apW: 0, apL: 0, apT: 0, weekly: [] });
  }

  for (const week of weeks) {
    const wMatchups = byWeek.get(week)!;

    if (isCategories && categories?.length) {
      // ── Category leagues: simulate actual H2H matchups using raw stats ──
      const catStats = weekCategoryStats(wMatchups);
      const teamIds = [...catStats.keys()];

      // First pass: compute all-play W/L/T for every team
      const weekResults = new Map<string, { w: number; l: number; t: number }>();
      for (const teamId of teamIds) {
        const myStats = catStats.get(teamId)!;
        let w = 0, l = 0, t = 0;

        for (const otherId of teamIds) {
          if (otherId === teamId) continue;
          const otherStats = catStats.get(otherId)!;
          const result = simulateCategoryMatchup(myStats, otherStats, categories);
          if (result === 'W') w++;
          else if (result === 'L') l++;
          else t++;
        }
        weekResults.set(teamId, { w, l, t });
      }

      // Second pass: assign ranks and accumulate
      for (const teamId of teamIds) {
        const acc = results.get(teamId);
        if (!acc) continue;

        const { w, l, t } = weekResults.get(teamId)!;
        acc.apW += w;
        acc.apL += l;
        acc.apT += t;

        // Rank by simulated wins (more wins = better rank)
        const rank = teamIds.filter(
          (tid) => tid !== teamId && weekResults.get(tid)!.w > w,
        ).length + 1;

        const matchup = teamMatchupByWeek.get(teamId)?.get(week);
        const actual: 'W' | 'L' | 'T' = matchup
          ? actualResult(matchup, teamId)
          : 'T';

        acc.weekly.push({
          weekNumber: week,
          teamScore: w,
          wins: w,
          losses: l,
          ties: t,
          rankAmongAll: rank,
          actualResult: actual,
        });
      }
    } else {
      // ── Points leagues: compare raw scores ──
      const scores = weekScores(wMatchups);
      const teamIds = [...scores.keys()];

      const sorted = [...scores.entries()].sort((a, b) => b[1] - a[1]);

      for (const teamId of teamIds) {
        const acc = results.get(teamId);
        if (!acc) continue;

        const myScore = scores.get(teamId)!;
        let w = 0, l = 0, t = 0;

        for (const otherId of teamIds) {
          if (otherId === teamId) continue;
          const otherScore = scores.get(otherId)!;
          if (myScore > otherScore) w++;
          else if (myScore < otherScore) l++;
          else t++;
        }

        acc.apW += w;
        acc.apL += l;
        acc.apT += t;

        let rank = 1;
        for (const [, score] of sorted) {
          if (score > myScore) rank++;
          else break;
        }

        const matchup = teamMatchupByWeek.get(teamId)?.get(week);
        const actual: 'W' | 'L' | 'T' = matchup
          ? actualResult(matchup, teamId)
          : 'T';

        acc.weekly.push({
          weekNumber: week,
          teamScore: myScore,
          wins: w,
          losses: l,
          ties: t,
          rankAmongAll: rank,
          actualResult: actual,
        });
      }
    }
  }

  // Build final results
  const output: AllPlayResult[] = [];

  for (const t of teams) {
    const acc = results.get(t.id);
    if (!acc) continue;

    const total = acc.apW + acc.apL + acc.apT;
    const winPct = total > 0 ? (acc.apW + 0.5 * acc.apT) / total : 0;
    const gamesPlayed = t.wins + t.losses + t.ties;
    const expectedWins = winPct * gamesPlayed;

    output.push({
      teamId: t.id,
      allPlayWins: acc.apW,
      allPlayLosses: acc.apL,
      allPlayTies: acc.apT,
      allPlayWinPct: winPct,
      expectedWins,
      luckIndex: t.wins - expectedWins,
      weeklyBreakdown: acc.weekly,
    });
  }

  return output;
}
