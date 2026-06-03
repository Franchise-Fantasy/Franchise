import { ScoringWeight } from '@/types/player';
import { projAvgRowToFpts } from '@/utils/scoring/fantasyPoints';

// A player_projections row carries projected per-game MEANS (proj_pts,
// proj_reb, …). projAvgRowToFpts turns that league-agnostic line into
// projected FPTS/G using this league's weights — the same way season-stat
// fpts are derived per league. These tests pin that contract.

const STANDARD: ScoringWeight[] = [
  { stat_name: 'PTS', point_value: 1 },
  { stat_name: 'REB', point_value: 1.2 },
  { stat_name: 'AST', point_value: 1.5 },
  { stat_name: 'STL', point_value: 3 },
  { stat_name: 'BLK', point_value: 3 },
  { stat_name: 'TO', point_value: -1 },
];

describe('projAvgRowToFpts', () => {
  it('computes projected fpts/g as a direct weighted sum of the projected line', () => {
    const proj = {
      proj_pts: 25,
      proj_reb: 10,
      proj_ast: 5,
      proj_stl: 1,
      proj_blk: 1,
      proj_tov: 3,
    };
    // 25 + 10*1.2 + 5*1.5 + 1*3 + 1*3 - 3 = 47.5
    expect(projAvgRowToFpts(proj, STANDARD)).toBe(47.5);
  });

  it('scores the 3PM projection via proj_3pm', () => {
    const proj = { proj_3pm: 3, proj_pts: 0 };
    expect(projAvgRowToFpts(proj, [{ stat_name: '3PM', point_value: 0.5 }])).toBe(1.5);
  });

  it('treats a missing projected stat as 0, not NaN', () => {
    const proj = { proj_pts: 20 }; // no reb/ast/etc projected
    expect(projAvgRowToFpts(proj, STANDARD)).toBe(20);
  });

  it('ignores stats the model does not project (DD/TD/PF contribute 0)', () => {
    const proj = { proj_pts: 20 };
    const weights: ScoringWeight[] = [
      { stat_name: 'PTS', point_value: 1 },
      { stat_name: 'DD', point_value: 5 },
      { stat_name: 'TD', point_value: 10 },
      { stat_name: 'PF', point_value: -0.5 },
    ];
    expect(projAvgRowToFpts(proj, weights)).toBe(20);
  });

  it('respects different league weights for the same projected line', () => {
    const proj = { proj_pts: 10, proj_ast: 4, proj_tov: 2 };
    const espnLike: ScoringWeight[] = [
      { stat_name: 'PTS', point_value: 1 },
      { stat_name: 'AST', point_value: 2 },
      { stat_name: 'TO', point_value: -2 },
    ];
    // 10 + 4*2 - 2*2 = 14
    expect(projAvgRowToFpts(proj, espnLike)).toBe(14);
  });
});
