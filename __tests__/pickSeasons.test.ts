import { rookiePickSeasons, tradablePickSeasons } from '@/utils/draft/pickSeasons';

// The tradable horizon is `[season, season + max_future_seasons]` in start
// years — `buildFutureDraftPicks` seeds offsets 1..N, the league imports also
// seed offset 0 when they land a league mid-offseason, and `execute-trade`
// validates pick swaps against that same inclusive range. Every window here
// must stay inside it, and must not stop short of its far end.

describe('rookiePickSeasons', () => {
  it('starts at next season during the regular season', () => {
    expect(rookiePickSeasons('2026-27', 3, null, 'nba')).toEqual([
      '2027-28', '2028-29', '2029-30',
    ]);
  });

  it('includes the current season while the offseason rookie draft is pending', () => {
    // advance-season already rolled league.season forward, so the upcoming
    // rookie draft is for `season` itself.
    expect(rookiePickSeasons('2026-27', 3, 'rookie_draft_pending', 'nba')).toEqual([
      '2026-27', '2027-28', '2028-29', '2029-30',
    ]);
  });

  it('reaches the far end of the tradable horizon in the offseason', () => {
    // Regression: the draft hub used a fixed count of `max_future_seasons`
    // from the offset-0 start, so an imported league's outermost year of picks
    // was tradeable everywhere else but invisible in the hub.
    const seasons = rookiePickSeasons('2026-27', 5, 'rookie_draft_pending', 'nba');
    expect(seasons).toHaveLength(6);
    expect(seasons[seasons.length - 1]).toBe('2031-32');
  });

  it('drops the current season once the rookie draft has committed', () => {
    for (const step of ['rookie_draft_complete', 'ready_for_new_season']) {
      expect(rookiePickSeasons('2026-27', 3, step, 'nba')).toEqual([
        '2027-28', '2028-29', '2029-30',
      ]);
    }
  });

  it('uses single-year season strings for WNBA and NFL', () => {
    expect(rookiePickSeasons('2026', 2, null, 'wnba')).toEqual(['2027', '2028']);
    expect(rookiePickSeasons('2026', 2, 'lottery_pending', 'nfl')).toEqual([
      '2026', '2027', '2028',
    ]);
  });

  it('never exceeds the tradable horizon', () => {
    for (const step of [null, 'lottery_pending', 'rookie_draft_pending', 'rookie_draft_complete']) {
      const seasons = rookiePickSeasons('2026-27', 4, step, 'nba');
      expect(seasons[seasons.length - 1]).toBe('2030-31');
    }
  });
});

describe('tradablePickSeasons', () => {
  it('always includes the current season for in-progress startup picks', () => {
    expect(tradablePickSeasons('2026-27', 3, 'nba')).toEqual([
      '2026-27', '2027-28', '2028-29', '2029-30',
    ]);
  });

  it('shares its far end with the rookie window', () => {
    const tradable = tradablePickSeasons('2026-27', 5, 'nba');
    const rookie = rookiePickSeasons('2026-27', 5, 'rookie_draft_pending', 'nba');
    expect(tradable[tradable.length - 1]).toBe(rookie[rookie.length - 1]);
  });

  it('covers every rookie window as a superset', () => {
    const tradable = tradablePickSeasons('2026', 4, 'wnba');
    for (const step of [null, 'lottery_pending', 'rookie_draft_complete']) {
      for (const season of rookiePickSeasons('2026', 4, step, 'wnba')) {
        expect(tradable).toContain(season);
      }
    }
  });
});
