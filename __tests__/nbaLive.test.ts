// utils/nba/nbaLive exports a hook that pulls react-native + supabase. We only
// test the pure formatters, so stub the heavy deps at module level.
jest.mock('react-native', () => ({
  AppState: {
    addEventListener: () => ({ remove: () => undefined }),
    currentState: 'active',
  },
}));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));

import {
  formatClock,
  formatGameInfo,
  formatPeriod,
  liveToGameLog,
  type LivePlayerStats,
} from '@/utils/nba/nbaLive';

function makeLive(overrides: Partial<LivePlayerStats> = {}): LivePlayerStats {
  return {
    player_id: 'p1', game_id: 'g1', game_date: '2026-02-15',
    game_status: 2, period: 2, game_clock: 'PT05M23.00S',
    matchup: 'vs LAL', home_score: 30, away_score: 28,
    oncourt: true,
    pts: 10, reb: 4, ast: 3, blk: 0, stl: 1, tov: 1,
    fgm: 4, fga: 8, '3pm': 1, '3pa': 3, ftm: 1, fta: 2, pf: 1,
    ...overrides,
  };
}

describe('formatPeriod', () => {
  it('returns empty for non-positive periods', () => {
    expect(formatPeriod(0)).toBe('');
    expect(formatPeriod(-1)).toBe('');
  });

  it('returns 1st/2nd/3rd/4th for regulation', () => {
    expect(formatPeriod(1)).toBe('1st');
    expect(formatPeriod(2)).toBe('2nd');
    expect(formatPeriod(3)).toBe('3rd');
    expect(formatPeriod(4)).toBe('4th');
  });

  it('uses OT/OT2/OT3 for overtime', () => {
    expect(formatPeriod(5)).toBe('OT');
    expect(formatPeriod(6)).toBe('OT2');
    expect(formatPeriod(7)).toBe('OT3');
  });
});

describe('formatClock', () => {
  it('parses ISO duration to M:SS', () => {
    expect(formatClock('PT05M23.00S')).toBe('5:23');
    expect(formatClock('PT12M00.00S')).toBe('12:00');
    expect(formatClock('PT00M07.00S')).toBe('0:07');
  });

  it('floors fractional seconds', () => {
    expect(formatClock('PT05M23.99S')).toBe('5:23');
  });

  it('returns empty string for invalid input', () => {
    expect(formatClock('')).toBe('');
    expect(formatClock('garbage')).toBe('');
  });
});

describe('formatGameInfo', () => {
  it('shows "Final · myScore-oppScore" when game is final (home perspective)', () => {
    const live = makeLive({ game_status: 3, matchup: 'vs LAL', home_score: 100, away_score: 92 });
    expect(formatGameInfo(live)).toBe('Final · 100-92');
  });

  it('orients score from team perspective when away (@MIA)', () => {
    const live = makeLive({ game_status: 3, matchup: '@MIA', home_score: 100, away_score: 110 });
    // Player is away, so score should be 110-100.
    expect(formatGameInfo(live)).toBe('Final · 110-100');
  });

  it('shows "HALF" when clock = 0:00 at end of period 2', () => {
    const live = makeLive({ game_status: 2, period: 2, game_clock: 'PT00M00.00S', home_score: 50, away_score: 48 });
    expect(formatGameInfo(live)).toBe('HALF · 50-48');
  });

  it('shows "1st 5:23 · score" mid-game', () => {
    const live = makeLive({ game_status: 2, period: 1, game_clock: 'PT05M23.00S', home_score: 18, away_score: 20 });
    expect(formatGameInfo(live)).toBe('1st 5:23 · 18-20');
  });

  it('returns empty string for scheduled games', () => {
    const live = makeLive({ game_status: 1 });
    expect(formatGameInfo(live)).toBe('');
  });
});

describe('liveToGameLog', () => {
  it('copies stat fields into a game-log shape', () => {
    const live = makeLive({ pts: 20, reb: 10, ast: 5 });
    const result = liveToGameLog(live);
    expect(result.pts).toBe(20);
    expect(result.reb).toBe(10);
    expect(result.ast).toBe(5);
    expect(result.min).toBe(0);
  });

  it('flags double-double when ≥ 2 categories hit 10+', () => {
    const result = liveToGameLog(makeLive({ pts: 20, reb: 10, ast: 5, stl: 1, blk: 1 }));
    expect(result.double_double).toBe(true);
    expect(result.triple_double).toBe(false);
  });

  it('flags triple-double when ≥ 3 categories hit 10+', () => {
    const result = liveToGameLog(makeLive({ pts: 22, reb: 11, ast: 10, stl: 1, blk: 1 }));
    expect(result.double_double).toBe(true);
    expect(result.triple_double).toBe(true);
  });

  it('does not flag DD when only 1 category at 10+', () => {
    const result = liveToGameLog(makeLive({ pts: 20, reb: 5, ast: 5, stl: 0, blk: 0 }));
    expect(result.double_double).toBe(false);
    expect(result.triple_double).toBe(false);
  });
});
