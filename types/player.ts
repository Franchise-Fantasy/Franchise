export interface PlayerSeasonStats {
  player_id: string;
  name: string;
  position: string;
  nba_team: string;
  status: string;
  external_id_nba: string | null;
  games_played: number;
  // Totals
  total_pts: number;
  total_reb: number;
  total_ast: number;
  total_stl: number;
  total_blk: number;
  total_tov: number;
  total_fgm: number;
  total_fga: number;
  total_3pm: number;
  total_3pa: number;
  total_ftm: number;
  total_fta: number;
  total_pf: number;
  total_dd: number;
  total_td: number;
  // Averages
  avg_min: number;
  avg_pts: number;
  avg_reb: number;
  avg_ast: number;
  avg_stl: number;
  avg_blk: number;
  avg_tov: number;
  avg_fgm: number;
  avg_fga: number;
  avg_3pm: number;
  avg_3pa: number;
  avg_ftm: number;
  avg_fta: number;
  avg_pf: number;
}

export interface PlayerGameLog {
  id: string;
  game_id: string;
  matchup?: string;
  game_date?: string;
  min: number;
  pts: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  tov: number;
  fgm: number;
  fga: number;
  '3pm': number;
  '3pa': number;
  ftm: number;
  fta: number;
  pf: number;
  double_double: boolean;
  triple_double: boolean;
}

export interface ScoringWeight {
  stat_name: string;
  point_value: number;
}
