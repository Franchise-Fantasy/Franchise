/**
 * Unit tests for the NFL stat mappers shared by poll-live-stats and the 2025
 * backfill (supabase/functions/_shared/nflStats.ts — import-free, so it's
 * safe to pull into the jest graph).
 */
import {
  dstPointsAllowedPts,
  mapDstGameStats,
  mapNflGameStats,
} from '../supabase/functions/_shared/nflStats';

describe('dstPointsAllowedPts tier table', () => {
  it.each([
    [0, 10],
    [1, 7], [6, 7],
    [7, 4], [13, 4],
    [14, 1], [20, 1],
    [21, 0], [27, 0],
    [28, -1], [34, -1],
    [35, -4], [55, -4],
  ])('%i points allowed → %i', (pa, expected) => {
    expect(dstPointsAllowedPts(pa)).toBe(expected);
  });
});

describe('mapNflGameStats', () => {
  it('maps a QB box score (BDL field names → our columns)', () => {
    // Mahomes wk1 2025, verified against the live BDL response.
    const cols = mapNflGameStats({
      passing_completions: 24, passing_attempts: 39, passing_yards: 258,
      passing_touchdowns: 1, passing_interceptions: 0,
      rushing_attempts: 6, rushing_yards: 57, rushing_touchdowns: 1,
      receptions: null, receiving_targets: null, receiving_yards: null,
      receiving_touchdowns: null, fumbles_lost: 0,
      kick_return_touchdowns: null, punt_return_touchdowns: null,
      field_goals_made: null, field_goal_attempts: null,
      long_field_goal_made: null, extra_points_made: null,
    });
    expect(cols).toMatchObject({
      pass_cmp: 24, pass_att: 39, pass_yd: 258, pass_td: 1, pass_int: 0,
      rush_att: 6, rush_yd: 57, rush_td: 1,
      rec: null, targets: null, rec_yd: null, rec_td: null,
      fum_lost: 0, ret_td: null,
      fg_made: null, fg_att: null, fg_long: null, xp_made: null,
    });
  });

  it('maps a kicker box score and sums return TDs', () => {
    const cols = mapNflGameStats({
      field_goals_made: 2, field_goal_attempts: 3,
      long_field_goal_made: 53, extra_points_made: 2,
      kick_return_touchdowns: 1, punt_return_touchdowns: 1,
    });
    expect(cols).toMatchObject({
      fg_made: 2, fg_att: 3, fg_long: 53, xp_made: 2, ret_td: 2,
    });
  });

  it('rounds fractional inputs and rejects non-numeric values', () => {
    const cols = mapNflGameStats({ passing_yards: 258.4, rushing_yards: '57' });
    expect(cols.pass_yd).toBe(258);
    expect(cols.rush_yd).toBeNull();
  });
});

describe('mapDstGameStats', () => {
  it("takes sacks/INTs/fumble recoveries from the OPPONENT's row and def TDs from its own", () => {
    const cols = mapDstGameStats({
      ownRow: { sacks: 1, interceptions_thrown: 3, fumbles_lost: 2, defensive_touchdowns: 1 },
      oppRow: { sacks: 4, interceptions_thrown: 2, fumbles_lost: 1, defensive_touchdowns: 0 },
      opponentScore: 13,
    });
    expect(cols).toEqual({
      dst_sacks: 4,        // opponent's offense was sacked 4 times = our sacks
      dst_int: 2,          // opponent threw 2 INTs = our takeaways
      dst_fum_rec: 1,      // opponent lost 1 fumble
      dst_td: 1,           // our own defensive TD
      dst_pts_allowed: 13,
      dst_pa_pts: 4,       // 7-13 tier
    });
  });

  it('degrades to score-only when team_stats rows are missing (live mid-game)', () => {
    const cols = mapDstGameStats({ ownRow: undefined, oppRow: undefined, opponentScore: 0 });
    expect(cols).toEqual({
      dst_sacks: 0, dst_int: 0, dst_fum_rec: 0, dst_td: 0,
      dst_pts_allowed: 0, dst_pa_pts: 10,
    });
  });
});
