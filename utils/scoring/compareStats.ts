import { PlayerRanking } from '@/utils/scoring/playerRankings';

// Pure comparison-matrix logic for the player-compare tool. No React / RN
// imports so it stays unit-testable in the jest node env (the row-set +
// highlight rules are the easy-to-get-wrong part — see __tests__/compareStats).

/** higher-is-better for most stats; 'lower' for turnovers, rank, etc. */
export type CompareDirection = 'higher' | 'lower';

export interface CompareCell {
  /** Numeric value used for highlight comparison; null = no data (em-dash). */
  value: number | null;
  /** Preformatted display string. */
  display: string;
}

export interface CompareRow {
  key: string;
  label: string;
  direction: CompareDirection;
  cells: CompareCell[];
  /** Indexes of the winning column(s). Empty when there's no clear winner. */
  best: Set<number>;
}

export interface CompareGroup {
  key: string;
  label: string;
  rows: CompareRow[];
}

/**
 * Indexes of the column(s) holding the best value for a row.
 *
 * Rules (deliberately conservative so the gold highlight always *means*
 * something):
 *  - null cells never win and are excluded from the comparison.
 *  - A full tie among every column that has data → no winner (e.g. all-zero
 *    offseason rows, or two identical lines). Highlighting "everyone" is noise.
 *  - A single column with data → no winner (nothing to out-perform).
 *  - Otherwise the column(s) matching the max (or min, for 'lower') win; a
 *    subset tying for the lead all highlight.
 */
export function bestColumnIndexes(
  values: (number | null)[],
  direction: CompareDirection,
): Set<number> {
  const valid = values.filter((v): v is number => v != null);
  if (valid.length < 2) return new Set();

  const target =
    direction === 'higher' ? Math.max(...valid) : Math.min(...valid);

  const winners = new Set<number>();
  values.forEach((v, i) => {
    if (v != null && v === target) winners.add(i);
  });

  // Everyone with data tied → no meaningful winner.
  if (winners.size === valid.length) return new Set();
  return winners;
}

export function makeRow(
  key: string,
  label: string,
  direction: CompareDirection,
  values: (number | null)[],
  fmt: (n: number) => string,
  nullDisplay = '—',
): CompareRow {
  return {
    key,
    label,
    direction,
    cells: values.map((v) => ({
      value: v,
      display: v == null ? nullDisplay : fmt(v),
    })),
    best: bestColumnIndexes(values, direction),
  };
}

/** Per-column count of how many of the supplied rows that column wins.
 *  Used for the category-league "wins N of M" header tally. */
export function categoryWinTally(rows: CompareRow[], columnCount: number): number[] {
  const tally = new Array(columnCount).fill(0);
  for (const row of rows) {
    for (const idx of row.best) tally[idx] += 1;
  }
  return tally;
}

// ── formatters ──────────────────────────────────────────────────────────────
export const fmtDecimal1 = (n: number): string => n.toFixed(1);
export const fmtPercent = (n: number): string => `${n.toFixed(1)}%`;
export const fmtRank = (n: number): string => `#${n}`;

// ── group assembly ────────────────────────────────────────────────────────────

/** Per-player numbers already resolved by the caller (useCompareData does the
 *  data plumbing; this stays pure). null = unavailable for that player. */
export interface ResolvedComparePlayer {
  player_id: string;
  gamesPlayed: number;
  ranking: PlayerRanking | null;
  seasonFpts: number | null;
  nextGameProjFpts: number | null;
  seasonProjFpts: number | null;
  // Season per-game averages.
  avgMin: number | null;
  avgPts: number | null;
  avgReb: number | null;
  avgAst: number | null;
  avgStl: number | null;
  avgBlk: number | null;
  avgTov: number | null;
  // Shooting.
  fgPct: number | null;
  ftPct: number | null;
  tpPct: number | null;
  tpm: number | null;
  // Recent form (points leagues): windowed FPTS/G.
  l5Fpts: number | null;
  l10Fpts: number | null;
  l15Fpts: number | null;
  // Recent form (category leagues): last-10 per-stat averages.
  l10Pts: number | null;
  l10Reb: number | null;
  l10Ast: number | null;
  l10Stl: number | null;
  l10Blk: number | null;
}

export interface BuildCompareGroupsOptions {
  isCategories: boolean;
  /** When true, the recent-form group is included (Phase 1 ships groups 1–4
   *  and may omit it; the screen passes true once game logs are wired). */
  includeRecentForm?: boolean;
}

/** The 9-category row keys used for the category-league win tally. */
const NINE_CAT_KEYS = ['pts', 'reb', 'ast', 'stl', 'blk', 'tov', 'fgPct', 'ftPct', 'tpPct'];

export function buildCompareGroups(
  players: ResolvedComparePlayer[],
  { isCategories, includeRecentForm = true }: BuildCompareGroupsOptions,
): CompareGroup[] {
  const col = <T,>(sel: (p: ResolvedComparePlayer) => T): T[] => players.map(sel);
  const groups: CompareGroup[] = [];

  // 1. Fantasy value — points leagues only (category leagues have no FPTS).
  if (!isCategories) {
    groups.push({
      key: 'value',
      label: 'Fantasy Value',
      rows: [
        makeRow('seasonFpts', 'FPTS/G', 'higher', col((p) => p.seasonFpts), fmtDecimal1),
        makeRow('nextProj', 'Next Game (proj)', 'higher', col((p) => p.nextGameProjFpts), fmtDecimal1),
        makeRow('seasonProj', 'Rest of Season (proj)', 'higher', col((p) => p.seasonProjFpts), fmtDecimal1),
      ],
    });
  }

  // 2. Rankings.
  groups.push({
    key: 'rankings',
    label: 'Rankings',
    rows: [
      makeRow('overallRank', 'Overall', 'lower', col((p) => p.ranking?.overallRank ?? null), fmtRank, 'NR'),
      makeRow('posRank', 'Position', 'lower', col((p) => p.ranking?.positionRank ?? null), fmtRank, 'NR'),
    ],
  });

  // 3. Season averages.
  groups.push({
    key: 'season',
    label: 'Season Averages',
    rows: [
      makeRow('min', 'MIN', 'higher', col((p) => p.avgMin), fmtDecimal1),
      makeRow('pts', 'PTS', 'higher', col((p) => p.avgPts), fmtDecimal1),
      makeRow('reb', 'REB', 'higher', col((p) => p.avgReb), fmtDecimal1),
      makeRow('ast', 'AST', 'higher', col((p) => p.avgAst), fmtDecimal1),
      makeRow('stl', 'STL', 'higher', col((p) => p.avgStl), fmtDecimal1),
      makeRow('blk', 'BLK', 'higher', col((p) => p.avgBlk), fmtDecimal1),
      makeRow('tov', 'TOV', 'lower', col((p) => p.avgTov), fmtDecimal1),
    ],
  });

  // 4. Shooting.
  groups.push({
    key: 'shooting',
    label: 'Shooting',
    rows: [
      makeRow('fgPct', 'FG%', 'higher', col((p) => p.fgPct), fmtPercent),
      makeRow('ftPct', 'FT%', 'higher', col((p) => p.ftPct), fmtPercent),
      makeRow('tpPct', '3P%', 'higher', col((p) => p.tpPct), fmtPercent),
      makeRow('tpm', '3PM', 'higher', col((p) => p.tpm), fmtDecimal1),
    ],
  });

  // 5. Recent form.
  if (includeRecentForm) {
    const rows = isCategories
      ? [
          makeRow('l10Pts', 'PTS (L10)', 'higher', col((p) => p.l10Pts), fmtDecimal1),
          makeRow('l10Reb', 'REB (L10)', 'higher', col((p) => p.l10Reb), fmtDecimal1),
          makeRow('l10Ast', 'AST (L10)', 'higher', col((p) => p.l10Ast), fmtDecimal1),
          makeRow('l10Stl', 'STL (L10)', 'higher', col((p) => p.l10Stl), fmtDecimal1),
          makeRow('l10Blk', 'BLK (L10)', 'higher', col((p) => p.l10Blk), fmtDecimal1),
        ]
      : [
          makeRow('l5', 'L5 FPTS/G', 'higher', col((p) => p.l5Fpts), fmtDecimal1),
          makeRow('l10', 'L10 FPTS/G', 'higher', col((p) => p.l10Fpts), fmtDecimal1),
          makeRow('l15', 'L15 FPTS/G', 'higher', col((p) => p.l15Fpts), fmtDecimal1),
        ];
    groups.push({ key: 'recent', label: 'Recent Form', rows });
  }

  return groups;
}

/** Category-league win tally across the 9 classic categories, computed from the
 *  already-built groups. Returns one count per column. */
export function nineCatWinTally(groups: CompareGroup[], columnCount: number): number[] {
  const rows = groups
    .flatMap((g) => g.rows)
    .filter((r) => NINE_CAT_KEYS.includes(r.key));
  return categoryWinTally(rows, columnCount);
}
