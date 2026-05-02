// Shared types for the NBA Playoff Archive feature.
// Mirrors the JSON shape returned by the pro_archive_* RPCs.

export type Conference = 'East' | 'West';
export type SeriesConference = Conference | 'Finals';
export type FirstRoundFormat = 'best_of_3' | 'best_of_5' | 'best_of_7';

export interface ArchiveYear {
  season: number;
  num_teams: number;
  has_play_in: boolean;
  first_round_format: FirstRoundFormat;
  champion_franchise_id: string | null;
  finals_mvp_player_name: string | null;
  finals_mvp_bbref_id: string | null;
  finals_mvp_franchise_id: string | null;
  finals_mvp_stat_line: string | null;
}

export interface ArchiveFranchiseSeason {
  franchise_id: string;
  name: string;
  city: string;
  tricode: string;
  primary_color: string | null;
  secondary_color: string | null;
  logo_key: string | null;
  conference: Conference;
  current_name: string;
  current_city: string;
}

export interface ArchiveSeries {
  id: string;
  season: number;
  round: number;
  conference: SeriesConference;
  bracket_position: number;
  franchise_a_id: string | null;
  franchise_b_id: string | null;
  seed_a: number | null;
  seed_b: number | null;
  winner_franchise_id: string | null;
  wins_a: number;
  wins_b: number;
}

// One row of the per-game box (top 5 by minutes per side).
// Populated from pro_playoff_game_box via the bracket RPC.
export interface ArchiveGameBoxLine {
  rank: number;
  player_id: string | null;
  player_name: string;
  minutes_seconds: number | null;
  pts: number | null;
  reb: number | null;
  ast: number | null;
  stl: number | null;
  blk: number | null;
  plus_minus: number | null;
  stat_line: string | null;
}

export interface ArchiveGame {
  series_id: string;
  game_num: number;
  winner_franchise_id: string | null;
  home_franchise_id: string | null;
  away_franchise_id: string | null;
  home_score: number | null;
  away_score: number | null;
  ot_periods: number;
  played_on: string | null;
  // Top 5 box-score lines per side, ranked by minutes played. side 'a'
  // corresponds to series.franchise_a_id, 'b' to franchise_b_id. Populated
  // by scripts/scrape-game-headlines.mjs from the NBA Stats boxscore API.
  box: {
    a: ArchiveGameBoxLine[];
    b: ArchiveGameBoxLine[];
  };
  // Legacy headline columns — kept on the read shape for back-compat
  // during the rollout. The UI prefers `box` once populated. A future
  // migration can drop these from the schema entirely.
  top_a_player_id: string | null;
  top_a_player_name: string | null;
  top_a_stat_line: string | null;
  top_a_game_score: number | null;
  top_a_plus_minus: number | null;
  top_a_secondary_player_id: string | null;
  top_a_secondary_player_name: string | null;
  top_a_secondary_stat_line: string | null;
  top_a_secondary_game_score: number | null;
  top_a_secondary_plus_minus: number | null;
  top_b_player_id: string | null;
  top_b_player_name: string | null;
  top_b_stat_line: string | null;
  top_b_game_score: number | null;
  top_b_plus_minus: number | null;
  top_b_secondary_player_id: string | null;
  top_b_secondary_player_name: string | null;
  top_b_secondary_stat_line: string | null;
  top_b_secondary_game_score: number | null;
  top_b_secondary_plus_minus: number | null;
}

export interface ArchiveBracket {
  year: ArchiveYear | null;
  franchises: ArchiveFranchiseSeason[];
  series: ArchiveSeries[];
  games: ArchiveGame[];
}

export interface ArchiveStanding {
  franchise_id: string;
  wins: number;
  losses: number;
  conference: Conference;
  conference_seed: number;
  pts_per_game: number | null;
  pts_allowed_per_game: number | null;
  srs: number | null;
  // joined from pro_franchise_season:
  name: string;
  city: string;
  tricode: string;
  primary_color: string | null;
  secondary_color: string | null;
  logo_key: string | null;
}

export interface ArchiveStandingsPayload {
  standings: ArchiveStanding[];
}

export interface ArchivePlayerStat {
  season: number;
  franchise_id: string;
  bbref_player_id: string;
  player_name: string;
  gp: number;
  min_per: number | null;
  pts_per: number | null;
  reb_per: number | null;
  ast_per: number | null;
  stl_per: number | null;
  blk_per: number | null;
  fg_pct: number | null;
  tp_pct: number | null;
  ft_pct: number | null;
}

// Regular-season awards + selection teams. Returned by pro_archive_awards(season).
// Solo awards (mvp/dpoy/etc) have a single entry with rank=1; selection teams
// (all_nba_first/etc) have 5 entries ranked 1..5.
export type AwardType =
  | 'mvp'
  | 'dpoy'
  | 'roy'
  | 'sixth_man'
  | 'mip'
  | 'all_nba_first'
  | 'all_nba_second'
  | 'all_nba_third'
  | 'all_defense_first'
  | 'all_defense_second'
  | 'all_rookie_first'
  | 'all_rookie_second';

export interface ArchiveAwardEntry {
  rank: number;
  player_name: string;
  bbref_player_id: string | null;
  franchise_id: string | null;
  stat_line: string | null;
}

// Awards keyed by award_type. Missing keys mean we haven't curated that
// award for this season; treat as empty rather than throwing.
export type ArchiveAwards = Partial<Record<AwardType, ArchiveAwardEntry[]>>;

export interface ArchiveTeamRun {
  franchise: {
    franchise_id: string;
    name: string;
    city: string;
    tricode: string;
    primary_color: string | null;
    secondary_color: string | null;
    logo_key: string | null;
    conference: Conference;
  } | null;
  standing: {
    season: number;
    franchise_id: string;
    wins: number;
    losses: number;
    conference: Conference;
    conference_seed: number;
    pts_per_game: number | null;
    pts_allowed_per_game: number | null;
    srs: number | null;
  } | null;
  series: ArchiveSeries[];
  top_players: ArchivePlayerStat[];
}
