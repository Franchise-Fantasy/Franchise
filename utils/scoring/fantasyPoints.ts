import { PlayerGameLog, PlayerSeasonStats, ScoringWeight } from '@/types/player';

// Maps league_scoring_settings stat_name to player_season_stats total column
export const STAT_TO_TOTAL: Record<string, keyof PlayerSeasonStats> = {
  PTS: 'total_pts',
  REB: 'total_reb',
  AST: 'total_ast',
  STL: 'total_stl',
  BLK: 'total_blk',
  TO: 'total_tov',
  '3PM': 'total_3pm',
  '3PA': 'total_3pa',
  FGM: 'total_fgm',
  FGA: 'total_fga',
  FTM: 'total_ftm',
  FTA: 'total_fta',
  PF: 'total_pf',
  DD: 'total_dd',
  TD: 'total_td',
};

// Maps league_scoring_settings stat_name to player_games column
export const STAT_TO_GAME: Record<string, keyof PlayerGameLog> = {
  PTS: 'pts',
  REB: 'reb',
  AST: 'ast',
  STL: 'stl',
  BLK: 'blk',
  TO: 'tov',
  '3PM': '3pm',
  '3PA': '3pa',
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
  return Math.round((totalFantasy / player.games_played) * 100) / 100;
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
      if (val == null) continue;
      total += (typeof val === 'boolean' ? (val ? 1 : 0) : (val as number)) * weight.point_value;
    }
  }
  return Math.round(total * 100) / 100;
}

// Returns per-stat breakdown of fantasy points for a single game.
export interface FptsBreakdownRow {
  stat_name: string;
  stat_value: number;
  point_value: number;
  points: number;
}

export function getFantasyPointsBreakdown(
  game: PlayerGameLog | Record<string, number | boolean>,
  scoringWeights: ScoringWeight[]
): { rows: FptsBreakdownRow[]; total: number } {
  const rows: FptsBreakdownRow[] = [];
  let total = 0;
  for (const weight of scoringWeights) {
    const field = STAT_TO_GAME[weight.stat_name];
    if (!field) continue;
    const raw = (game as any)[field];
    if (raw == null) continue;
    const stat_value = typeof raw === 'boolean' ? (raw ? 1 : 0) : (raw as number);
    const points = Math.round(stat_value * weight.point_value * 100) / 100;
    total += points;
    rows.push({ stat_name: weight.stat_name, stat_value, point_value: weight.point_value, points });
  }
  return { rows, total: Math.round(total * 100) / 100 };
}

// Format a score: show hundredths only when non-zero (e.g. 42.5 not 42.50, but 42.75 stays)
export function formatScore(n: number): string {
  return n % 1 !== 0 && Math.round(n * 100) % 10 !== 0 ? n.toFixed(2) : n.toFixed(1);
}
