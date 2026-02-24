import { PlayerGameLog, PlayerSeasonStats, ScoringWeight } from '@/types/player';

// Maps league_scoring_settings stat_name to player_season_stats total column
const STAT_TO_TOTAL: Record<string, keyof PlayerSeasonStats> = {
  PTS: 'total_pts',
  REB: 'total_reb',
  AST: 'total_ast',
  STL: 'total_stl',
  BLK: 'total_blk',
  TO: 'total_tov',
  '3PM': 'total_3pm',
  FGM: 'total_fgm',
  FGA: 'total_fga',
  FTM: 'total_ftm',
  FTA: 'total_fta',
  PF: 'total_pf',
  DD: 'total_dd',
  TD: 'total_td',
};

// Maps league_scoring_settings stat_name to player_games column
const STAT_TO_GAME: Record<string, keyof PlayerGameLog> = {
  PTS: 'pts',
  REB: 'reb',
  AST: 'ast',
  STL: 'stl',
  BLK: 'blk',
  TO: 'tov',
  '3PM': '3pm',
  FGM: 'fgm',
  FGA: 'fga',
  FTM: 'ftm',
  FTA: 'fta',
  PF: 'pf',
  DD: 'double_double',
  TD: 'triple_double',
};

// Computes true average FPTS per game using season totals, then dividing by games played.
// This avoids rounding drift from averaging stats first then multiplying by weights.
export function calculateAvgFantasyPoints(
  player: PlayerSeasonStats,
  scoringWeights: ScoringWeight[]
): number {
  if (player.games_played === 0) return 0;

  let totalFantasy = 0;
  for (const weight of scoringWeights) {
    const field = STAT_TO_TOTAL[weight.stat_name];
    if (field) {
      totalFantasy += (player[field] as number) * weight.point_value;
    }
  }
  return Math.round((totalFantasy / player.games_played) * 10) / 10;
}

// Computes fantasy points for a single game.
export function calculateGameFantasyPoints(
  game: PlayerGameLog,
  scoringWeights: ScoringWeight[]
): number {
  let total = 0;
  for (const weight of scoringWeights) {
    const field = STAT_TO_GAME[weight.stat_name];
    if (field) {
      const val = game[field];
      total += (typeof val === 'boolean' ? (val ? 1 : 0) : (val as number)) * weight.point_value;
    }
  }
  return Math.round(total * 10) / 10;
}
