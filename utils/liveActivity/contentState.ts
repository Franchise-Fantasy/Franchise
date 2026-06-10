/**
 * Shared content-state helpers for the Matchup Live Activity.
 *
 * Used from:
 *   - app/(tabs)/matchup.tsx (handleGoLive — build initial state at start)
 *   - supabase/functions/poll-live-stats and get-week-scores (push state via APNs)
 *
 * The widget contract (widgets/MatchupActivity.tsx → MatchupActivityProps) is what
 * iOS ultimately renders; keep these field names and shapes IN SYNC with it.
 */

import { type CategoryResult } from '../scoring/categoryScoring.ts';

export type LivePlayerLine = {
  name: string;
  statLine: string;
  fantasyPoints: number;
  gameStatus: string;
  isOnCourt: boolean;
};

export type LiveCategoryLine = {
  stat: string;
  myValue: number;
  oppValue: number;
  winner: 'me' | 'opp' | 'tie';
  inverse: boolean;
};

/**
 * "A moment" — the hero row above the player ticker. Surfaced by
 * get-week-scores when a recent live_scoring_event qualifies (3-pt make,
 * threshold cross, big fpts swing). Falls back to marginTrend / nextTipoff
 * when no recent event exists. See widgets/MatchupActivity.tsx for render.
 */
export type LiveMoment = {
  /** Routing/style hint — widget picks icon + color. */
  kind: 'event' | 'threshold' | 'swing';
  /** SF Symbol shortcut: 'flame' = make, 'bolt' = swing, 'check' = threshold. */
  icon: 'flame' | 'bolt' | 'check';
  /** Renderable headline — e.g. "A. WILSON — 3-POINTER" or "K. PLUM +6.4 last min". */
  text: string;
  /** 'me' = my roster (green tint), 'opp' = opponent (red tint). */
  side: 'me' | 'opp';
  /** Age in seconds — widget formats as "just now" / "Ns ago" / "Nm ago". */
  ageSec: number;
};

/**
 * Margin trajectory — the fallback hero row when nothing fresh happened but
 * games are live. Shows whether the gap is closing or widening over the last
 * ~10 minutes from the perspective of my team.
 */
export type LiveMarginTrend = {
  /** Current scoreGap (signed; positive = my lead). */
  current: number;
  /** Stored scoreGap from earlierMinAgo minutes back. */
  earlier: number;
  /** How many minutes ago `earlier` was captured. */
  earlierMinAgo: number;
};

/**
 * "Up next" — the State-3 fallback when no live games. Surfaces the first
 * tipoff that involves at least one rostered starter on either side.
 */
export type LiveNextTipoff = {
  /** "7:00 ET" — caller-formatted. */
  timeText: string;
  /** "NYL vs CHI" — caller-formatted. */
  matchup: string;
  /** Starter counts so the user knows whether to care. */
  myStarters: number;
  oppStarters: number;
};

type ContentStateBase = {
  myTeamName: string;
  opponentTeamName: string;
  myTeamTricode: string;
  opponentTeamTricode: string;
  myScore: number;
  opponentScore: number;
  scoreGap: number;
  biggestContributor: string;
  myActivePlayers: number;
  opponentActivePlayers: number;
  myLogoFileUri?: string;
  opponentLogoFileUri?: string;
  patchFileUri?: string;
  /**
   * Hero row in priority order: moment > marginTrend > nextTipoff. Widget
   * renders whichever is non-null. All three optional — when all absent the
   * widget falls back to just biggestContributor.
   */
  moment?: LiveMoment;
  marginTrend?: LiveMarginTrend;
  nextTipoff?: LiveNextTipoff;
};

export type PointsContentState = ContentStateBase & {
  mode: 'points';
  winProbability?: number;
  players: LivePlayerLine[];
};

export type CategoriesContentState = ContentStateBase & {
  mode: 'categories';
  players: LivePlayerLine[];
  categories: LiveCategoryLine[];
  catTies: number;
};

export type LiveActivityContentState = PointsContentState | CategoriesContentState;

/**
 * Adapt CategoryResult[] (the shared client/edge per-category comparison) to the
 * widget line shape, picking the perspective of "me" = home or away.
 */
export function categoryResultsToLines(
  results: CategoryResult[],
  perspective: 'home' | 'away',
  inverseByStat: Record<string, boolean>,
): LiveCategoryLine[] {
  return results.map((r) => {
    const myValue = perspective === 'home' ? r.home : r.away;
    const oppValue = perspective === 'home' ? r.away : r.home;
    let winner: 'me' | 'opp' | 'tie';
    if (r.winner === 'tie') winner = 'tie';
    else if (r.winner === 'home') winner = perspective === 'home' ? 'me' : 'opp';
    else winner = perspective === 'home' ? 'opp' : 'me';
    return {
      stat: r.stat,
      myValue,
      oppValue,
      winner,
      inverse: inverseByStat[r.stat] === true,
    };
  });
}

/**
 * Sort categories so the most contested / decisive ones surface first.
 * Heuristic: untied first (real signal), then largest absolute margin.
 * Percentage stats scaled so they're comparable to counting stats.
 */
export function rankCategories(lines: LiveCategoryLine[]): LiveCategoryLine[] {
  const margin = (l: LiveCategoryLine) => {
    const raw = Math.abs(l.myValue - l.oppValue);
    return l.stat.endsWith('%') ? raw * 1000 : raw;
  };
  return [...lines].sort((a, b) => {
    const aTied = a.winner === 'tie' ? 1 : 0;
    const bTied = b.winner === 'tie' ? 1 : 0;
    if (aTied !== bTied) return aTied - bTied;
    return margin(b) - margin(a);
  });
}

/**
 * "Top cat: REB +18" — the largest absolute margin category, expressed as the
 * perspective's signed lead. Inverse stats (turnovers) flip sign so "+8 TO"
 * never reads as a brag when you're losing turnovers. Returns '' when no signal.
 */
export function formatTopCategory(lines: LiveCategoryLine[]): string {
  if (lines.length === 0) return '';
  const ranked = rankCategories(lines);
  const top = ranked.find((l) => l.winner !== 'tie');
  if (!top) return '';
  const isPct = top.stat.endsWith('%');
  const rawDiff = top.myValue - top.oppValue;
  const signedForDisplay = top.inverse ? -rawDiff : rawDiff;
  const formatted = isPct
    ? `${signedForDisplay >= 0 ? '+' : ''}${(signedForDisplay * 100).toFixed(1)}%`
    : `${signedForDisplay >= 0 ? '+' : ''}${Math.round(signedForDisplay)}`;
  return `Top cat: ${top.stat} ${formatted}`;
}

export function buildPointsContentState(input: {
  myTeamName: string;
  opponentTeamName: string;
  myTeamTricode: string;
  opponentTeamTricode: string;
  myScore: number;
  opponentScore: number;
  biggestContributor: string;
  myActivePlayers: number;
  opponentActivePlayers: number;
  players: LivePlayerLine[];
  winProbability?: number;
  myLogoFileUri?: string;
  opponentLogoFileUri?: string;
  patchFileUri?: string;
  moment?: LiveMoment;
  marginTrend?: LiveMarginTrend;
  nextTipoff?: LiveNextTipoff;
}): PointsContentState {
  return {
    mode: 'points',
    myTeamName: input.myTeamName,
    opponentTeamName: input.opponentTeamName,
    myTeamTricode: input.myTeamTricode,
    opponentTeamTricode: input.opponentTeamTricode,
    myScore: input.myScore,
    opponentScore: input.opponentScore,
    scoreGap: input.myScore - input.opponentScore,
    winProbability: input.winProbability,
    biggestContributor: input.biggestContributor,
    myActivePlayers: input.myActivePlayers,
    opponentActivePlayers: input.opponentActivePlayers,
    players: input.players,
    myLogoFileUri: input.myLogoFileUri,
    opponentLogoFileUri: input.opponentLogoFileUri,
    patchFileUri: input.patchFileUri,
    moment: input.moment,
    marginTrend: input.marginTrend,
    nextTipoff: input.nextTipoff,
  };
}

export function buildCategoriesContentState(input: {
  myTeamName: string;
  opponentTeamName: string;
  myTeamTricode: string;
  opponentTeamTricode: string;
  myWins: number;
  oppWins: number;
  ties: number;
  categories: LiveCategoryLine[];
  myActivePlayers: number;
  opponentActivePlayers: number;
  myLogoFileUri?: string;
  opponentLogoFileUri?: string;
  patchFileUri?: string;
}): CategoriesContentState {
  const ranked = rankCategories(input.categories);
  return {
    mode: 'categories',
    myTeamName: input.myTeamName,
    opponentTeamName: input.opponentTeamName,
    myTeamTricode: input.myTeamTricode,
    opponentTeamTricode: input.opponentTeamTricode,
    myScore: input.myWins,
    opponentScore: input.oppWins,
    scoreGap: input.myWins - input.oppWins,
    biggestContributor: formatTopCategory(ranked),
    myActivePlayers: input.myActivePlayers,
    opponentActivePlayers: input.opponentActivePlayers,
    players: [],
    categories: ranked,
    catTies: input.ties,
    myLogoFileUri: input.myLogoFileUri,
    opponentLogoFileUri: input.opponentLogoFileUri,
    patchFileUri: input.patchFileUri,
  };
}
