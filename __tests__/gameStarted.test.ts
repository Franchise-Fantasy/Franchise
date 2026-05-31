// utils/nba/gameStarted exposes a hook (useTodayGameTimes) plus two pure
// helpers. Stub the deps the hook pulls in so the module loads.
jest.mock('react-native', () => ({
  AppState: {
    addEventListener: () => ({ remove: () => undefined }),
    currentState: 'active',
  },
}));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: new Map() }) }));
jest.mock('@/hooks/useActiveLeagueSport', () => ({ useActiveLeagueSport: () => 'nba' }));

import { hasAnyGameStarted, isGameStarted, type GameTimeMap } from '@/utils/nba/gameStarted';

describe('hasAnyGameStarted', () => {
  it('returns false for an empty map', () => {
    expect(hasAnyGameStarted(new Map())).toBe(false);
  });

  it('returns true if any game time is in the past', () => {
    const map: GameTimeMap = new Map([
      ['LAL', new Date(Date.now() - 60_000).toISOString()],
      ['BOS', new Date(Date.now() + 60_000).toISOString()],
    ]);
    expect(hasAnyGameStarted(map)).toBe(true);
  });

  it('returns false when all game times are in the future', () => {
    const map: GameTimeMap = new Map([
      ['LAL', new Date(Date.now() + 60_000).toISOString()],
      ['BOS', new Date(Date.now() + 120_000).toISOString()],
    ]);
    expect(hasAnyGameStarted(map)).toBe(false);
  });
});

describe('isGameStarted', () => {
  it('returns true when live game status >= 2 (live signal wins)', () => {
    // Even with no time map and a future-only schedule, gameStatus=2 → started.
    expect(isGameStarted('LAL', new Map(), 2)).toBe(true);
    expect(isGameStarted('LAL', new Map(), 3)).toBe(true);
  });

  it('returns false when tricode is null/missing', () => {
    expect(isGameStarted(null, new Map([['LAL', new Date(Date.now() - 60_000).toISOString()]]))).toBe(false);
  });

  it('returns false when team is not in the map', () => {
    const map: GameTimeMap = new Map([['LAL', new Date(Date.now() - 60_000).toISOString()]]);
    expect(isGameStarted('BOS', map)).toBe(false);
  });

  it('returns true when game time is in the past', () => {
    const map: GameTimeMap = new Map([['LAL', new Date(Date.now() - 60_000).toISOString()]]);
    expect(isGameStarted('LAL', map)).toBe(true);
  });

  it('returns false when game time is in the future', () => {
    const map: GameTimeMap = new Map([['LAL', new Date(Date.now() + 60_000).toISOString()]]);
    expect(isGameStarted('LAL', map)).toBe(false);
  });

  it('live status of 1 (scheduled) falls back to schedule check', () => {
    const map: GameTimeMap = new Map([['LAL', new Date(Date.now() + 60_000).toISOString()]]);
    expect(isGameStarted('LAL', map, 1)).toBe(false);
  });
});
