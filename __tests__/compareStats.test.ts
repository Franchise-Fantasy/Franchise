import {
  bestColumnIndexes,
  buildCompareGroups,
  categoryWinTally,
  makeRow,
  nineCatWinTally,
  type ResolvedComparePlayer,
} from '@/utils/scoring/compareStats';

function resolved(overrides: Partial<ResolvedComparePlayer> = {}): ResolvedComparePlayer {
  return {
    player_id: 'p',
    gamesPlayed: 20,
    ranking: null,
    seasonFpts: null,
    nextGameProjFpts: null,
    seasonProjFpts: null,
    avgMin: null,
    avgPts: null,
    avgReb: null,
    avgAst: null,
    avgStl: null,
    avgBlk: null,
    avgTov: null,
    fgPct: null,
    ftPct: null,
    tpPct: null,
    tpm: null,
    l5Fpts: null,
    l10Fpts: null,
    l15Fpts: null,
    l10Pts: null,
    l10Reb: null,
    l10Ast: null,
    l10Stl: null,
    l10Blk: null,
    ...overrides,
  };
}

describe('bestColumnIndexes', () => {
  it('picks the highest column for higher-is-better', () => {
    expect([...bestColumnIndexes([27.4, 25.1, 22.0], 'higher')]).toEqual([0]);
  });

  it('picks the lowest column for lower-is-better (turnovers)', () => {
    expect([...bestColumnIndexes([3.1, 1.8, 2.5], 'lower')]).toEqual([1]);
  });

  it('highlights a subset that ties for the lead', () => {
    expect([...bestColumnIndexes([27, 27, 22], 'higher')]).toEqual([0, 1]);
  });

  it('returns no winner when every column with data is fully tied', () => {
    expect(bestColumnIndexes([5, 5, 5], 'higher').size).toBe(0);
  });

  it('treats all-zero (offseason) rows as no winner', () => {
    expect(bestColumnIndexes([0, 0], 'higher').size).toBe(0);
  });

  it('ignores null cells and returns no winner with fewer than two data points', () => {
    expect(bestColumnIndexes([null, 10], 'higher').size).toBe(0);
    expect(bestColumnIndexes([null, null], 'higher').size).toBe(0);
  });

  it('compares only the columns that have data', () => {
    expect([...bestColumnIndexes([8, null, 10], 'higher')]).toEqual([2]);
  });
});

describe('makeRow', () => {
  it('formats values and renders null as the null display', () => {
    const row = makeRow('pts', 'PTS', 'higher', [27.4, null], (n) => n.toFixed(1));
    expect(row.cells[0].display).toBe('27.4');
    expect(row.cells[1].display).toBe('—');
    expect([...row.best]).toEqual([]);
  });

  it('uses a custom null display (e.g. unranked)', () => {
    const row = makeRow('rank', 'Overall', 'lower', [3, null], (n) => `#${n}`, 'NR');
    expect(row.cells[1].display).toBe('NR');
  });
});

describe('categoryWinTally', () => {
  it('counts wins per column and ignores ties', () => {
    const rows = [
      makeRow('a', 'A', 'higher', [10, 5], (n) => `${n}`),
      makeRow('b', 'B', 'higher', [5, 10], (n) => `${n}`),
      makeRow('c', 'C', 'higher', [7, 7], (n) => `${n}`), // tie → no win
    ];
    expect(categoryWinTally(rows, 2)).toEqual([1, 1]);
  });
});

describe('buildCompareGroups', () => {
  it('includes a Fantasy Value group only for points leagues', () => {
    const players = [resolved({ seasonFpts: 40 }), resolved({ seasonFpts: 35 })];
    const points = buildCompareGroups(players, { isCategories: false });
    const cats = buildCompareGroups(players, { isCategories: true });
    expect(points.some((g) => g.key === 'value')).toBe(true);
    expect(cats.some((g) => g.key === 'value')).toBe(false);
  });

  it('shows FPTS recent-form rows for points, per-category rows for categories', () => {
    const players = [resolved(), resolved()];
    const pointsRecent = buildCompareGroups(players, { isCategories: false }).find((g) => g.key === 'recent');
    const catRecent = buildCompareGroups(players, { isCategories: true }).find((g) => g.key === 'recent');
    expect(pointsRecent?.rows.map((r) => r.key)).toEqual(['l5', 'l10', 'l15']);
    expect(catRecent?.rows.map((r) => r.key)).toEqual(['l10Pts', 'l10Reb', 'l10Ast', 'l10Stl', 'l10Blk']);
  });

  it('omits recent form when includeRecentForm is false', () => {
    const players = [resolved(), resolved()];
    const groups = buildCompareGroups(players, { isCategories: false, includeRecentForm: false });
    expect(groups.some((g) => g.key === 'recent')).toBe(false);
  });

  it('marks turnovers as lower-is-better', () => {
    const players = [resolved({ avgTov: 3.0 }), resolved({ avgTov: 1.5 })];
    const season = buildCompareGroups(players, { isCategories: false }).find((g) => g.key === 'season')!;
    const tov = season.rows.find((r) => r.key === 'tov')!;
    expect([...tov.best]).toEqual([1]);
  });

  it('produces no winners when both players have zero games (offseason)', () => {
    const players = [
      resolved({ gamesPlayed: 0, avgPts: 0, avgReb: 0 }),
      resolved({ gamesPlayed: 0, avgPts: 0, avgReb: 0 }),
    ];
    const season = buildCompareGroups(players, { isCategories: false }).find((g) => g.key === 'season')!;
    for (const row of season.rows) expect(row.best.size).toBe(0);
  });
});

describe('nineCatWinTally', () => {
  it('tallies the nine classic categories across the built groups', () => {
    const players = [
      resolved({ avgPts: 30, avgReb: 10, avgAst: 5, avgStl: 2, avgBlk: 1, avgTov: 1, fgPct: 50, ftPct: 90, tpPct: 40 }),
      resolved({ avgPts: 20, avgReb: 8, avgAst: 8, avgStl: 1, avgBlk: 2, avgTov: 3, fgPct: 45, ftPct: 80, tpPct: 38 }),
    ];
    const groups = buildCompareGroups(players, { isCategories: true });
    const tally = nineCatWinTally(groups, 2);
    // Player 0 wins PTS, REB, STL, TOV(lower), FG%, FT%, 3P% = 7; player 1 wins AST, BLK = 2.
    expect(tally).toEqual([7, 2]);
  });
});
