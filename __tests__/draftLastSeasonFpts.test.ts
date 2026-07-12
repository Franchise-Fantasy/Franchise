import type { PlayerSeasonStats, ScoringWeight } from '@/types/player';
import { buildAdjustedPlayers } from '@/utils/freeAgent/freeAgentStats';
import { calculateAvgFantasyPoints } from '@/utils/scoring/fantasyPoints';

// Real shapes pulled from prod: an offseason player_season_stats row (the
// 2026-27 matview, so every average is NULL and games_played is 0) and the
// player's player_historical_stats row for 2025-26. The "Last Season" pill in
// the draft board merges the second onto the first, and the FPTS column has to
// survive that merge — the totals it scores are rebuilt from avg × GP.
const WEIGHTS: ScoringWeight[] = [
  { stat_name: 'PTS', point_value: 1 },
  { stat_name: 'REB', point_value: 2 },
  { stat_name: 'AST', point_value: 2 },
  { stat_name: 'STL', point_value: 3 },
  { stat_name: 'BLK', point_value: 3 },
  { stat_name: 'TO', point_value: -2 },
  { stat_name: 'FGM', point_value: 2 },
  { stat_name: 'FGA', point_value: -1 },
  { stat_name: 'FTM', point_value: 1 },
  { stat_name: 'FTA', point_value: -0.75 },
  { stat_name: '3PM', point_value: 2.5 },
  { stat_name: '3PA', point_value: -1 },
  { stat_name: 'PF', point_value: 0 },
  { stat_name: 'DD', point_value: 5 },
  { stat_name: 'TD', point_value: 10 },
] as ScoringWeight[];

const offseasonRow = {
  player_id: 'booker',
  name: 'Devin Booker',
  position: 'PG/SG',
  pro_team: 'PHX',
  status: 'ACT',
  games_played: 0,
  avg_pts: null,
  avg_reb: null,
  avg_ast: null,
  total_pts: 0,
  total_reb: 0,
  total_ast: 0,
} as unknown as PlayerSeasonStats;

const historicalRow = {
  player_id: 'booker',
  season: '2025-26',
  sport: 'nba',
  games_played: 64,
  avg_pts: '26.1',
  avg_reb: '3.9',
  avg_ast: '6.0',
  avg_stl: '0.8',
  avg_blk: '0.3',
  avg_tov: '3.1',
  avg_fgm: '8.5',
  avg_fga: '18.7',
  avg_ftm: '7.1',
  avg_fta: '8.1',
  avg_3pm: '1.9',
  avg_3pa: '5.5',
  avg_min: '34.2',
  avg_pf: '2.4',
  total_dd: 6,
  total_td: 0,
};

describe('draft board — Last Season FPTS', () => {
  it('merges the historical line onto the offseason row', () => {
    const [merged] = buildAdjustedPlayers(
      [offseasonRow],
      undefined,
      [historicalRow],
      'lastSeason',
    )!;
    expect(merged.games_played).toBe(64);
    expect(Number(merged.avg_pts)).toBeCloseTo(26.1);
  });

  it('scores a non-zero FPTS off the merged row', () => {
    const [merged] = buildAdjustedPlayers(
      [offseasonRow],
      undefined,
      [historicalRow],
      'lastSeason',
    )!;
    const fpts = calculateAvgFantasyPoints(merged, WEIGHTS);
    // ~42 by hand; the point is that it is not 0, which is what a dropped
    // games_played or dropped totals would produce.
    expect(fpts).toBeGreaterThan(30);
  });
});
