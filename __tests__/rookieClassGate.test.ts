import {
  isRookieClassAvailable,
  rookieClassAvailableDate,
  seasonStartYear,
} from '../utils/draft/rookieClassGate';
import {
  betweenSeasonsCopy,
  computeOffseasonState,
  isBetweenSeasons,
} from '../utils/league/offseasonState';

describe('seasonStartYear', () => {
  it('reads the leading year from both season formats', () => {
    expect(seasonStartYear('2026-27')).toBe(2026); // NBA
    expect(seasonStartYear('2027')).toBe(2027); // WNBA / NFL
  });
});

describe('rookieClassAvailableDate', () => {
  it('prefers the season_config override over the per-sport default', () => {
    expect(rookieClassAvailableDate('nba', '2026-27', '2026-07-15')).toBe('2026-07-15');
  });

  it('falls back to the per-sport month/day keyed to the season start year', () => {
    expect(rookieClassAvailableDate('nba', '2026-27', null)).toBe('2026-07-01');
    expect(rookieClassAvailableDate('wnba', '2027', null)).toBe('2027-04-20');
    expect(rookieClassAvailableDate('nfl', '2026', undefined)).toBe('2026-05-01');
  });

  it('returns null for a sport with no known draft calendar', () => {
    expect(rookieClassAvailableDate('nhl', '2027', null)).toBeNull();
  });

  it('zero-pads so the result compares lexicographically against a day string', () => {
    // WNBA's Apr 20 must sort below "2027-05-01", which bare 4/20 would not.
    const gate = rookieClassAvailableDate('wnba', '2027', null)!;
    expect(gate < '2027-05-01').toBe(true);
    expect(gate > '2027-03-31').toBe(true);
  });
});

describe('isRookieClassAvailable', () => {
  it('is closed before the gate and open on the day itself', () => {
    expect(isRookieClassAvailable('wnba', '2027', null, '2027-04-19')).toBe(false);
    expect(isRookieClassAvailable('wnba', '2027', null, '2027-04-20')).toBe(true);
    expect(isRookieClassAvailable('wnba', '2027', null, '2027-04-21')).toBe(true);
  });

  it('holds a league that just finished its season months from its draft', () => {
    // The real case: a WNBA redraft league advancing in Jul 2026 is season
    // 2027, whose class doesn't land until Apr 2027.
    expect(isRookieClassAvailable('wnba', '2027', null, '2026-07-31')).toBe(false);
  });

  it('treats an unknown sport as ungated rather than stranding it forever', () => {
    expect(isRookieClassAvailable('nhl', '2027', null, '2026-01-01')).toBe(true);
  });
});

describe('betweenSeasonsCopy', () => {
  it('names the season the league REOPENS for, not the one that just ended', () => {
    // advance-season has already rolled leagues.season forward by the time a
    // league is dormant, so the value passed in is the upcoming one.
    const copy = betweenSeasonsCopy('2027');
    expect(copy.subtitle).toBe('THE LEAGUE REOPENS FOR THE 2027 DRAFT');
    expect(copy.accessibilityLabel).toContain('2027 draft');
  });
});

describe('isBetweenSeasons', () => {
  it('is true only for the dormant step', () => {
    expect(isBetweenSeasons('offseason')).toBe(true);
    expect(isBetweenSeasons('ready_for_new_season')).toBe(false);
    expect(isBetweenSeasons('lottery_pending')).toBe(false);
    expect(isBetweenSeasons(null)).toBe(false);
    expect(isBetweenSeasons(undefined)).toBe(false);
  });
});

describe('computeOffseasonState — redraft & keeper', () => {
  it('puts a redraft league on the dormant step first', () => {
    const state = computeOffseasonState('redraft', 'reverse_record', 'offseason');
    expect(state.stepLabels).toEqual(['Between Seasons', 'Draft', 'New Season']);
    expect(state.stepIndex).toBe(0);
    expect(state.stepLabel).toBe('Between Seasons');
    expect(state.nextStepLabel).toBe('Draft');
  });

  it('never calls the dormant state an offseason — that is dynasty vocabulary', () => {
    for (const type of ['redraft', 'keeper']) {
      const labels = computeOffseasonState(type, 'reverse_record', 'offseason').stepLabels;
      expect(labels).not.toContain('Offseason');
    }
  });

  it('advances a redraft league to Draft once the gate opens it', () => {
    const state = computeOffseasonState('redraft', 'reverse_record', 'ready_for_new_season');
    expect(state.stepIndex).toBe(1);
    expect(state.stepLabel).toBe('Draft');
  });

  it('runs keeper declarations before the dormant wait', () => {
    const declaring = computeOffseasonState('keeper', 'reverse_record', 'keeper_pending');
    expect(declaring.stepLabels).toEqual([
      'Declare Keepers',
      'Between Seasons',
      'Draft',
      'New Season',
    ]);
    expect(declaring.stepIndex).toBe(0);

    const waiting = computeOffseasonState('keeper', 'reverse_record', 'offseason');
    expect(waiting.stepIndex).toBe(1);
    expect(waiting.stepLabel).toBe('Between Seasons');
  });

  it('leaves the dynasty phase list alone', () => {
    const lottery = computeOffseasonState('dynasty', 'lottery', 'lottery_pending');
    expect(lottery.stepLabels).toEqual([
      'Season Over',
      'Draft Lottery',
      'Rookie Draft',
      'New Season',
    ]);
  });
});
