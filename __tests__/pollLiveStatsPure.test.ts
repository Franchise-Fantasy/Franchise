/**
 * Regression tests for the poll-live-stats write/refresh gating
 * (supabase/functions/poll-live-stats/pure.ts).
 *
 * The headline scenario: BDL files evening games under the next UTC day, but
 * their rows are stored under the ET slate date. The prior-snapshot query used
 * to be keyed only by `datesToCheck`, so a daytime poll re-fetched
 * yesterday-evening finals, missed their stored rows, counted every one as
 * "newly final", and re-ran the full player_season_stats matview refresh every
 * 30s for the rest of the day (~74.5k refreshes / 6 weeks ≈ 30% of all DB
 * time). collectSnapshotDates + rowChanged are the two halves of the fix.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import { mapDstGameStats, mapNflGameStats } from '../supabase/functions/_shared/nflStats';
import {
  buildPrevGameStatusByGameId,
  collectSnapshotDates,
  GAME_ROW_IGNORE,
  LIVE_ROW_IGNORE,
  rowChanged,
  shouldWritePlayerGame,
} from '../supabase/functions/poll-live-stats/pure';
import { bdlGameSlateDate } from '../utils/sports/bdlDates';

describe('collectSnapshotDates', () => {
  it('regression: daytime window includes the slate date of an evening final filed under the next UTC day', () => {
    // 8pm ET tip on Jul 16 = 2026-07-17T00:00:00Z → BDL returns it for
    // dates[]=2026-07-17, but its rows are stored under slate date 2026-07-16.
    // A daytime poll on Jul 17 has datesToCheck=['2026-07-17'] only.
    const dates = collectSnapshotDates(
      ['2026-07-17'],
      ['2026-07-17T00:00:00Z'],
      bdlGameSlateDate,
      '2026-07-17',
    );
    expect(dates).toContain('2026-07-16');
    expect(dates).toContain('2026-07-17');
  });

  it('passes NBA plain YYYY-MM-DD dates through as-is', () => {
    const dates = collectSnapshotDates(
      ['2026-07-17'],
      ['2026-07-16'],
      bdlGameSlateDate,
      '2026-07-17',
    );
    expect(dates.sort()).toEqual(['2026-07-16', '2026-07-17']);
  });

  it('falls back to the poll date for unparseable game dates and dedupes', () => {
    const dates = collectSnapshotDates(
      ['2026-07-17'],
      ['garbage-not-a-date', null, undefined, '2026-07-17'],
      bdlGameSlateDate,
      '2026-07-17',
    );
    expect(dates).toEqual(['2026-07-17']);
  });
});

describe('buildPrevGameStatusByGameId', () => {
  it('keeps the max status per game and a found prior blocks the newly-final signal', () => {
    const prev = buildPrevGameStatusByGameId([
      { game_id: '24897', game_date: '2026-07-16', game_status: 3 },
      { game_id: '24897', game_date: '2026-07-16', game_status: 2 },
      { game_id: '24898', game_date: '2026-07-16', game_status: '2' }, // string from PostgREST
      { game_id: '', game_status: 3 }, // no game id → skipped
    ]);
    expect(prev.get('24897')).toBe(3); // final already seen → NOT newly final
    expect(prev.get('24898')).toBe(2); // live → a status-3 tick IS newly final
    expect(prev.size).toBe(2);
  });
});

describe('rowChanged', () => {
  const storedFinalRow = {
    player_id: 'p1',
    game_id: '24897',
    game_date: '2026-07-16',
    game_status: 3,
    period: 4,
    game_clock: '',
    matchup: 'vs LVA',
    oncourt: false,
    home_score: 82,
    away_score: 80,
    min: '31', // Postgres numeric arrives as a string
    pts: 22, reb: 9, ast: 4, stl: 1, blk: 0, tov: 3,
    fgm: 8, fga: 15, '3pm': 2, '3pa': 5, ftm: 4, fta: 4, pf: 2,
  };
  const identicalPayload = {
    player_id: 'p1',
    game_id: '24897',
    game_date: '2026-07-16',
    sport: 'wnba',
    game_status: 3,
    period: 4,
    game_clock: '',
    matchup: 'vs LVA',
    oncourt: false,
    home_score: 82,
    away_score: 80,
    min: 31, // payload carries a number
    pts: 22, reb: 9, ast: 4, stl: 1, blk: 0, tov: 3,
    fgm: 8, fga: 15, '3pm': 2, '3pa': 5, ftm: 4, fta: 4, pf: 2,
    updated_at: '2026-07-17T15:00:00.000Z', // fresh every tick — must be ignored
  };

  it('regression: an unchanged final row is skipped even though updated_at is fresh', () => {
    expect(rowChanged(storedFinalRow, identicalPayload, LIVE_ROW_IGNORE)).toBe(false);
  });

  it('normalizes numeric strings across the PostgREST boundary', () => {
    expect(rowChanged(
      { ...storedFinalRow, min: '31.5' },
      { ...identicalPayload, min: 31.5 },
      LIVE_ROW_IGNORE,
    )).toBe(false);
    expect(rowChanged(
      { ...storedFinalRow, min: '-1' },
      { ...identicalPayload, min: -1 },
      LIVE_ROW_IGNORE,
    )).toBe(false);
  });

  it('detects a real stat change (late box-score correction)', () => {
    expect(rowChanged(storedFinalRow, { ...identicalPayload, pts: 24 }, LIVE_ROW_IGNORE)).toBe(true);
  });

  it('detects a status flip even when every stat is unchanged', () => {
    expect(rowChanged(
      { ...storedFinalRow, game_status: 2 },
      identicalPayload,
      LIVE_ROW_IGNORE,
    )).toBe(true);
  });

  it('detects an oncourt boolean flip', () => {
    expect(rowChanged(storedFinalRow, { ...identicalPayload, oncourt: true }, LIVE_ROW_IGNORE)).toBe(true);
  });

  it('compares game_id so a same-slate doubleheader re-points the row', () => {
    expect(rowChanged(storedFinalRow, { ...identicalPayload, game_id: '24999' }, LIVE_ROW_IGNORE)).toBe(true);
  });

  it('fails open: no stored row → changed', () => {
    expect(rowChanged(undefined, identicalPayload, LIVE_ROW_IGNORE)).toBe(true);
  });

  it('fails open: a payload column missing from the snapshot select → changed', () => {
    const { pf: _pf, ...storedMissingCol } = storedFinalRow;
    expect(rowChanged(storedMissingCol, identicalPayload, LIVE_ROW_IGNORE)).toBe(true);
  });

  it('treats NULL column and absent payload key as equal (NFL nullable stat cols)', () => {
    expect(rowChanged(
      { ...storedFinalRow, fg_long: null },
      { ...identicalPayload, fg_long: null },
      LIVE_ROW_IGNORE,
    )).toBe(false);
  });

  it('player_games: game_date IS compared (a re-filed game corrects the stored row)', () => {
    const storedGame = { player_id: 'p1', game_id: '24897', game_date: '2026-07-16', min: '31', pts: 22 };
    const payload = { player_id: 'p1', game_id: '24897', game_date: '2026-07-16', sport: 'wnba', min: 31, pts: 22 };
    expect(rowChanged(storedGame, payload, GAME_ROW_IGNORE)).toBe(false);
    expect(rowChanged(storedGame, { ...payload, game_date: '2026-07-17' }, GAME_ROW_IGNORE)).toBe(true);
  });
});

describe('snapshot select literals cover every written column (drift guard)', () => {
  // rowChanged fails OPEN when a payload column is missing from the snapshot
  // select (missing ⇒ "changed" ⇒ row written every tick) — so a select-list
  // gap doesn't corrupt data, it silently revives the 30s write/matview
  // storm. This guard reads the actual select literals out of index.ts and
  // asserts they cover every payload column, so adding a stat column without
  // widening the selects fails CI instead of failing quietly in prod.
  const indexSrc = readFileSync(
    join(__dirname, '../supabase/functions/poll-live-stats/index.ts'),
    'utf8',
  );
  const selectLiterals = [...indexSrc.matchAll(/'(player_id, game_id, game_date, [^']+)'/g)]
    .map((m) => m[1]);
  const liveSelects = selectLiterals.filter((s) => s.includes('game_status'));
  const gameSelects = selectLiterals.filter((s) => !s.includes('game_status'));
  const colsOf = (sel: string) => new Set(sel.split(',').map((c) => c.trim().replace(/"/g, '')));

  // Classify by exact column token — a substring test would put the NFL
  // select in the basketball bucket via `dst_pts_allowed` ⊃ 'pts'.
  const [nflLive, bballLive] = [
    liveSelects.find((s) => colsOf(s).has('pass_td'))!,
    liveSelects.find((s) => colsOf(s).has('pts'))!,
  ];
  const [nflGame, bballGame] = [
    gameSelects.find((s) => colsOf(s).has('pass_td'))!,
    gameSelects.find((s) => colsOf(s).has('pts'))!,
  ];

  it('found all four sport-conditional select literals in index.ts', () => {
    expect(liveSelects).toHaveLength(2);
    expect(gameSelects).toHaveLength(2);
    expect(nflLive && bballLive && nflGame && bballGame).toBeTruthy();
  });

  it('NFL selects cover every mapNflGameStats + mapDstGameStats output key', () => {
    const nflKeys = [
      ...Object.keys(mapNflGameStats({})),
      ...Object.keys(mapDstGameStats({ ownRow: undefined, oppRow: undefined, opponentScore: 0 })),
    ];
    expect(nflKeys.length).toBeGreaterThan(15); // sanity: the mappers returned real column sets
    for (const key of nflKeys) {
      expect(colsOf(nflLive)).toContain(key);
      expect(colsOf(nflGame)).toContain(key);
    }
  });

  it('live selects cover the shared envelope columns the payload writes', () => {
    const envelope = ['game_status', 'period', 'game_clock', 'matchup', 'oncourt', 'home_score', 'away_score', 'min'];
    for (const key of envelope) {
      expect(colsOf(nflLive)).toContain(key);
      expect(colsOf(bballLive)).toContain(key);
    }
  });

  it('basketball selects cover the box-score payload columns', () => {
    const bball = ['pts', 'reb', 'ast', 'blk', 'stl', 'tov', 'fgm', 'fga', '3pm', '3pa', 'ftm', 'fta', 'pf'];
    for (const key of bball) {
      expect(colsOf(bballLive)).toContain(key);
      expect(colsOf(bballGame)).toContain(key);
    }
    for (const key of ['double_double', 'triple_double']) {
      expect(colsOf(bballGame)).toContain(key);
    }
  });
});

describe('shouldWritePlayerGame', () => {
  it('writes only final, non-postseason games inside the regular-season window', () => {
    expect(shouldWritePlayerGame(3, false, '2026-07-16', '2026-09-10')).toBe(true);
    expect(shouldWritePlayerGame(2, false, '2026-07-16', '2026-09-10')).toBe(false); // still live
    expect(shouldWritePlayerGame(3, true, '2026-07-16', '2026-09-10')).toBe(false); // postseason
    expect(shouldWritePlayerGame(3, false, '2026-09-11', '2026-09-10')).toBe(false); // play-in leak guard
  });

  it('null regularSeasonEnd falls back to the postseason flag alone', () => {
    expect(shouldWritePlayerGame(3, false, '2026-09-11', null)).toBe(true);
    expect(shouldWritePlayerGame(3, true, '2026-07-16', null)).toBe(false);
  });
});
