import { ScoringWeight } from '@/types/player';
import { seasonAvgRowToFpts } from '@/utils/scoring/fantasyPoints';

// A player_historical_stats row carries per-game AVERAGES only — no totals,
// no dd/td. seasonAvgRowToFpts reconstructs the totals it needs and reuses the
// canonical fpts formula. These tests pin that contract.

const STANDARD: ScoringWeight[] = [
  { stat_name: 'PTS', point_value: 1 },
  { stat_name: 'REB', point_value: 1.2 },
  { stat_name: 'AST', point_value: 1.5 },
  { stat_name: 'STL', point_value: 3 },
  { stat_name: 'BLK', point_value: 3 },
  { stat_name: 'TO', point_value: -1 },
];

describe('seasonAvgRowToFpts', () => {
  it('computes fpts/g from per-game averages using totals reconstructed at games_played', () => {
    const row = {
      games_played: 70,
      avg_pts: 25,
      avg_reb: 10,
      avg_ast: 5,
      avg_stl: 1,
      avg_blk: 1,
      avg_tov: 3,
    };
    // 25 + 10*1.2 + 5*1.5 + 1*3 + 1*3 - 3 = 25 + 12 + 7.5 + 3 + 3 - 3 = 47.5
    expect(seasonAvgRowToFpts(row, STANDARD)).toBe(47.5);
  });

  it('handles shooting-split stats that only exist as averages (no totals column)', () => {
    const row = { games_played: 50, avg_3pm: 3, avg_pts: 0 };
    expect(seasonAvgRowToFpts(row, [{ stat_name: '3PM', point_value: 0.5 }])).toBe(1.5);
  });

  it('returns 0 when games_played is 0 (avoids divide-by-zero)', () => {
    const row = { games_played: 0, avg_pts: 30 };
    expect(seasonAvgRowToFpts(row, STANDARD)).toBe(0);
  });

  it('ignores stats with no mapping (e.g. DD/TD not present on historical rows)', () => {
    const row = { games_played: 60, avg_pts: 20 };
    const weights: ScoringWeight[] = [
      { stat_name: 'PTS', point_value: 1 },
      { stat_name: 'DD', point_value: 5 },
    ];
    // DD has no avg column on historical rows → reconstructs to 0 total → contributes 0.
    expect(seasonAvgRowToFpts(row, weights)).toBe(20);
  });

  it('scores DD/TD from windowed avg rates (round(rate × games))', () => {
    // averageGames() emits avg_dd/avg_td as per-game rates — 0.5 DD over 10
    // games = 5 double-doubles, 0.1 TD = 1 triple-double.
    const row = { games_played: 10, avg_pts: 20, avg_dd: 0.5, avg_td: 0.1 };
    const weights: ScoringWeight[] = [
      { stat_name: 'PTS', point_value: 1 },
      { stat_name: 'DD', point_value: 5 },
      { stat_name: 'TD', point_value: 10 },
    ];
    // 20 + (5 DD × 5 + 1 TD × 10) / 10 games = 20 + (25 + 10) / 10 = 23.5
    expect(seasonAvgRowToFpts(row, weights)).toBe(23.5);
  });

  it('prefers a persisted dd/td total over reconstructing from a rate', () => {
    // A row carrying total_dd directly (season chips after the select fix) must
    // use it verbatim, not the avg_dd rate.
    const row = { games_played: 65, avg_pts: 0, total_dd: 55, total_td: 34 };
    const weights: ScoringWeight[] = [
      { stat_name: 'DD', point_value: 5 },
      { stat_name: 'TD', point_value: 10 },
    ];
    // (55 × 5 + 34 × 10) / 65 = 615 / 65 = 9.4615… → rounded to 9.46
    expect(seasonAvgRowToFpts(row, weights)).toBe(9.46);
  });
});
