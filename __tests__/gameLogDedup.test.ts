import { PlayerGameLog } from '@/types/player';
import { dedupeGameLogsByDate } from '@/utils/scoring/gameLogDedup';

function makeRow(overrides: Partial<PlayerGameLog> = {}): PlayerGameLog {
  return {
    id: 'r',
    game_id: 'g',
    matchup: 'vs LAL',
    game_date: '2026-02-01',
    min: 30,
    pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, tov: 0,
    fgm: 0, fga: 0, '3pm': 0, '3pa': 0, ftm: 0, fta: 0, pf: 0,
    double_double: false, triple_double: false,
    ...overrides,
  };
}

describe('dedupeGameLogsByDate', () => {
  it('returns empty when input is empty', () => {
    expect(dedupeGameLogsByDate([])).toEqual([]);
  });

  it('keeps the row with the most minutes when dates collide', () => {
    const rows = [
      makeRow({ id: 'a', game_date: '2026-02-01', min: 10 }),
      makeRow({ id: 'b', game_date: '2026-02-01', min: 32 }),
      makeRow({ id: 'c', game_date: '2026-02-01', min: 5 }),
    ];
    const result = dedupeGameLogsByDate(rows);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('b');
  });

  it('preserves distinct dates', () => {
    const rows = [
      makeRow({ id: 'a', game_date: '2026-02-01', min: 30 }),
      makeRow({ id: 'b', game_date: '2026-02-03', min: 25 }),
      makeRow({ id: 'c', game_date: '2026-02-04', min: 20 }),
    ];
    expect(dedupeGameLogsByDate(rows)).toHaveLength(3);
  });

  it('skips rows with no game_date', () => {
    const rows = [
      makeRow({ id: 'a', game_date: undefined }),
      makeRow({ id: 'b', game_date: '2026-02-01', min: 30 }),
    ];
    const result = dedupeGameLogsByDate(rows);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('b');
  });

  it('handles a tie on minutes (last seen wins per Map semantics — equal keep existing)', () => {
    const rows = [
      makeRow({ id: 'a', game_date: '2026-02-01', min: 30 }),
      makeRow({ id: 'b', game_date: '2026-02-01', min: 30 }),
    ];
    const result = dedupeGameLogsByDate(rows);
    expect(result).toHaveLength(1);
    // Implementation uses `row.min > existing.min`, so equal does not overwrite.
    expect(result[0].id).toBe('a');
  });
});
