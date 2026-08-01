import {
  buildWindowOptions,
  defaultStatWindow,
  resolveStatWindow,
  type StatWindowInputs,
} from '@/utils/roster/statWindowOptions';

const inSeason: StatWindowInputs = {
  maxRosterGames: 40,
  isPreSeason: false,
  isCategories: false,
  hasProjections: true,
  hasPrevSeason: true,
};

const preSeason: StatWindowInputs = {
  maxRosterGames: 0,
  isPreSeason: true,
  isCategories: false,
  hasProjections: true,
  hasPrevSeason: true,
};

describe('buildWindowOptions', () => {
  it('offers the full ladder mid-season', () => {
    expect(buildWindowOptions(inSeason)).toEqual([
      'L5',
      'L10',
      'L15',
      'season',
      'proj',
      'prev',
    ]);
  });

  it('gates each Lx on someone actually having that many games', () => {
    expect(buildWindowOptions({ ...inSeason, maxRosterGames: 12 })).toEqual([
      'L5',
      'L10',
      'season',
      'proj',
      'prev',
    ]);
    expect(buildWindowOptions({ ...inSeason, maxRosterGames: 4 })).toEqual([
      'season',
      'proj',
      'prev',
    ]);
  });

  it('drops "season" pre-tipoff — the matview is empty, so it would render blank', () => {
    expect(buildWindowOptions(preSeason)).toEqual(['proj', 'prev']);
  });

  it('drops the fpts-derived modes for category leagues', () => {
    expect(buildWindowOptions({ ...inSeason, isCategories: true })).toEqual([
      'L5',
      'L10',
      'L15',
      'season',
    ]);
  });

  it('always leaves something selectable (category league pre-tipoff)', () => {
    expect(
      buildWindowOptions({
        maxRosterGames: 0,
        isPreSeason: true,
        isCategories: true,
        hasProjections: false,
        hasPrevSeason: false,
      }),
    ).toEqual(['season']);
  });

  it('falls back to prev alone when a sport has no projections (NFL pre-season)', () => {
    expect(buildWindowOptions({ ...preSeason, hasProjections: false })).toEqual(['prev']);
  });
});

describe('defaultStatWindow', () => {
  it('lands on the season average once the season is underway', () => {
    expect(defaultStatWindow(buildWindowOptions(inSeason), false)).toBe('season');
  });

  it('lands on the projection pre-tipoff, not last season', () => {
    expect(defaultStatWindow(buildWindowOptions(preSeason), true)).toBe('proj');
  });

  it('falls back to the first surviving option when nothing is projected', () => {
    const options = buildWindowOptions({ ...preSeason, hasProjections: false });
    expect(defaultStatWindow(options, true)).toBe('prev');
  });
});

describe('resolveStatWindow', () => {
  it('honours an explicit pick that is still on offer', () => {
    expect(resolveStatWindow('prev', buildWindowOptions(inSeason), false)).toBe('prev');
  });

  it('falls back to the default when the pick is no longer offered', () => {
    // 'L15' disappears after a season rollover zeroes everyone's games played.
    const options = buildWindowOptions({ ...inSeason, maxRosterGames: 3 });
    expect(resolveStatWindow('L15', options, false)).toBe('season');
  });

  it('defaults to the projection while the queries are still resolving', () => {
    // Prev-season map lands first: with no explicit pick the default must not
    // stick on 'prev' once the projections arrive a moment later.
    const early = buildWindowOptions({ ...preSeason, hasProjections: false });
    expect(resolveStatWindow(null, early, true)).toBe('prev');
    expect(resolveStatWindow(null, buildWindowOptions(preSeason), true)).toBe('proj');
  });
});
