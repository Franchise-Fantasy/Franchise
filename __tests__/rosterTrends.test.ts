import { PlayerGameLog, ScoringWeight } from '@/types/player';
import { buildRosterTrendBoard } from '@/utils/scoring/rosterTrends';

// 1 fantasy point per point scored — so a game's FPTS equals its pts.
const WEIGHTS: ScoringWeight[] = [{ stat_name: 'PTS', point_value: 1 }];

function game(pts: number, idx: number): PlayerGameLog {
  return {
    id: `g${idx}`, game_id: `gid${idx}`, game_date: `2026-01-${String(idx + 1).padStart(2, '0')}`,
    min: 30, pts, reb: 0, ast: 0, stl: 0, blk: 0, tov: 0,
    fgm: 0, fga: 0, '3pm': 0, '3pa': 0, ftm: 0, fta: 0, pf: 0,
    double_double: false, triple_double: false,
  };
}

// Build a recent-first log: `recent` points for the first 10 games, `older`
// for the rest. The board uses a 10-game window, so the first 10 drive the
// recent average and the full set drives the season std-dev.
function log(recent: number, older: number, total = 12): PlayerGameLog[] {
  return Array.from({ length: total }, (_, i) => game(i < 10 ? recent : older, i));
}

describe('buildRosterTrendBoard', () => {
  const players = [
    { player_id: 'hot', name: 'Hot Player' },
    { player_id: 'cold', name: 'Cold Player' },
    { player_id: 'flat', name: 'Flat Player' },
  ];
  // Season avg sits between the recent and older windows for hot/cold.
  const seasonAvg = new Map<string, number>([
    ['hot', 20], ['cold', 20], ['flat', 20],
  ]);
  const seasonAvgFor = (id: string) => seasonAvg.get(id) ?? 0;

  it('buckets risers into heatingUp and slumpers into coolingOff', () => {
    const logs = new Map<string, PlayerGameLog[]>([
      ['hot', log(30, 10)],   // recent 30 vs season 20 → up
      ['cold', log(10, 30)],  // recent 10 vs season 20 → down
      ['flat', log(20, 20)],  // recent == season → neutral
    ]);
    const board = buildRosterTrendBoard(players, logs, WEIGHTS, seasonAvgFor);

    expect(board.evaluated).toBe(3);
    expect(board.heatingUp.map((e) => e.playerId)).toEqual(['hot']);
    expect(board.coolingOff.map((e) => e.playerId)).toEqual(['cold']);
    expect(board.heatingUp[0].trendPct).toBeGreaterThan(0);
    expect(board.coolingOff[0].trendPct).toBeLessThan(0);
    expect(board.heatingUp[0].recentAvg).toBe(30);
    expect(board.heatingUp[0].seasonAvg).toBe(20);
  });

  it('excludes players with fewer than 5 played games (not evaluated)', () => {
    const logs = new Map<string, PlayerGameLog[]>([
      ['hot', [game(30, 0), game(30, 1), game(30, 2)]], // only 3 games
    ]);
    const board = buildRosterTrendBoard(
      [{ player_id: 'hot', name: 'Hot Player' }], logs, WEIGHTS, seasonAvgFor,
    );
    expect(board.evaluated).toBe(0);
    expect(board.heatingUp).toHaveLength(0);
    expect(board.coolingOff).toHaveLength(0);
  });

  it('counts neutral players in evaluated but in neither bucket', () => {
    const logs = new Map<string, PlayerGameLog[]>([['flat', log(20, 20)]]);
    const board = buildRosterTrendBoard(
      [{ player_id: 'flat', name: 'Flat Player' }], logs, WEIGHTS, seasonAvgFor,
    );
    expect(board.evaluated).toBe(1);
    expect(board.heatingUp).toHaveLength(0);
    expect(board.coolingOff).toHaveLength(0);
  });

  it('sorts each bucket by absolute trendPct descending', () => {
    const four = [
      { player_id: 'big', name: 'Big Riser' },
      { player_id: 'small', name: 'Small Riser' },
    ];
    const logs = new Map<string, PlayerGameLog[]>([
      ['big', log(40, 10)],   // +100%
      ['small', log(26, 14)], // +30%
    ]);
    const board = buildRosterTrendBoard(four, logs, WEIGHTS, (id) =>
      id === 'big' ? 20 : 20,
    );
    expect(board.heatingUp.map((e) => e.playerId)).toEqual(['big', 'small']);
  });

  it('returns an empty board for empty input', () => {
    const board = buildRosterTrendBoard([], new Map(), WEIGHTS, seasonAvgFor);
    expect(board).toEqual({ heatingUp: [], coolingOff: [], evaluated: 0 });
  });
});
