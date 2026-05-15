// Shared types for the NFL Playoff Archive feature.
// Mirrors the JSON shape returned by the nfl_archive_* RPCs, which match
// the NBA archive envelope so the React layer can stay consistent.

export type NflConference = string; // 'AFC' | 'NFC' modern; 'AFL' | 'NFL' pre-merger
export type NflDivision = string; // 'AFC East', 'NFC West', etc. — varies by era

export type NflPlayoffFormat =
  | 'pre_merger_1966_1969'
  | 'four_team_1970_1977'
  | 'five_team_1978_1989'
  | 'six_team_1990_2001'
  | 'six_team_2002_2019'
  | 'modern_seven_2020';

export interface NflArchiveYear {
  season: number;
  num_teams: number;
  format: NflPlayoffFormat;
  champion_franchise_id: string | null;
  super_bowl_number: number | null;
  sb_mvp_player_name: string | null;
  sb_mvp_pfr_id: string | null;
  sb_mvp_franchise_id: string | null;
  sb_mvp_stat_line: string | null;
}

export interface NflArchiveFranchiseSeason {
  franchise_id: string;
  name: string;
  city: string;
  tricode: string;
  primary_color: string | null;
  secondary_color: string | null;
  logo_key: string | null;
  conference: NflConference;
  division: NflDivision;
  current_name: string;
  current_city: string;
}

// NFL playoff series == one bracket slot. Always exactly one game; wins_a/b
// are 0/1. Kept as a "series" for parallelism with NBA/NHL bracket rendering.
export interface NflArchiveSeries {
  id: string;
  season: number;
  round: number; // 1=WC, 2=Div, 3=CC, 4=SB (pre-merger: 3=League CG, 4=SB)
  conference: NflConference; // 'AFC' | 'NFC' | 'AFL' | 'NFL' | 'Final'
  bracket_position: number;
  franchise_a_id: string | null;
  franchise_b_id: string | null;
  seed_a: number | null;
  seed_b: number | null;
  winner_franchise_id: string | null;
  wins_a: number;
  wins_b: number;
}

export type NflBoxCategory =
  | 'passer'
  | 'rusher'
  | 'receiver'
  | 'defense'
  | 'kicker'
  | 'returner'
  | 'team';

// One row of the per-game box. Curated headlines, not top-N-by-anything;
// stat_line carries the human-readable summary. Structured columns are
// nullable and populated per-category for sortability.
export interface NflArchiveGameBoxLine {
  rank: number;
  category: NflBoxCategory;
  player_id: string | null;
  player_name: string;
  position: string | null;
  stat_line: string;
  // Passing
  pass_att: number | null;
  pass_cmp: number | null;
  pass_yds: number | null;
  pass_td: number | null;
  pass_int: number | null;
  // Rushing
  rush_att: number | null;
  rush_yds: number | null;
  rush_td: number | null;
  // Receiving
  rec: number | null;
  rec_yds: number | null;
  rec_td: number | null;
  // Defense
  tackles: number | null;
  sacks: number | null;
  int_def: number | null;
  ff: number | null;
  fr: number | null;
  td_def: number | null;
}

// Score-by-quarter for the in-game detail card (replaces NBA-style series
// pips since each NFL playoff "series" is one game). All nullable — pre-1985
// articles often don't carry a linescore. Stored as home/away to match the
// game record's home/away convention; UI remaps to series.franchise_a/b.
export interface NflArchiveQuarterScores {
  q1_home: number | null;
  q1_away: number | null;
  q2_home: number | null;
  q2_away: number | null;
  q3_home: number | null;
  q3_away: number | null;
  q4_home: number | null;
  q4_away: number | null;
  ot_home: number | null;
  ot_away: number | null;
}

export interface NflArchiveGame {
  series_id: string;
  game_num: number;
  home_franchise_id: string | null;
  away_franchise_id: string | null;
  home_score: number | null;
  away_score: number | null;
  ot_periods: number;
  played_on: string | null;
  venue: string | null;
  attendance: number | null;
  quarter_scores: NflArchiveQuarterScores | null;
  /** Curated headline rows per side. side 'a' corresponds to
   *  series.franchise_a_id, 'b' to franchise_b_id. */
  box: {
    a: NflArchiveGameBoxLine[];
    b: NflArchiveGameBoxLine[];
  };
}

export interface NflArchiveBracket {
  year: NflArchiveYear | null;
  franchises: NflArchiveFranchiseSeason[];
  series: NflArchiveSeries[];
  games: NflArchiveGame[];
}

export interface NflArchiveStanding {
  franchise_id: string;
  wins: number;
  losses: number;
  ties: number;
  points_for: number | null;
  points_against: number | null;
  conference: NflConference;
  division: NflDivision;
  conference_seed: number;
  division_seed: number;
  // joined from nfl_franchise_season:
  name: string;
  city: string;
  tricode: string;
  primary_color: string | null;
  secondary_color: string | null;
  logo_key: string | null;
}

export interface NflArchiveStandingsPayload {
  standings: NflArchiveStanding[];
}

export interface NflArchivePlayerStat {
  season: number;
  franchise_id: string;
  pfr_player_id: string;
  player_name: string;
  position: string;
  gp: number;
  approx_value: number | null;
  stat_line: string | null;
  pass_yds: number | null;
  pass_td: number | null;
  pass_int: number | null;
  rush_yds: number | null;
  rush_td: number | null;
  rec: number | null;
  rec_yds: number | null;
  rec_td: number | null;
  tackles: number | null;
  sacks: number | null;
  int_def: number | null;
  ff: number | null;
  fr: number | null;
  td_def: number | null;
}

export type NflAwardType =
  | 'mvp'
  | 'opoy'
  | 'dpoy'
  | 'oroy'
  | 'droy'
  | 'coty'
  | 'comeback'
  | 'walter_payton'
  | 'sb_mvp'
  | 'all_pro_first'
  | 'all_pro_second';

export type NflAwardUnit = '' | 'offense' | 'defense' | 'st';

export interface NflArchiveAwardEntry {
  rank: number;
  unit: NflAwardUnit;
  player_name: string;
  pfr_player_id: string | null;
  franchise_id: string | null;
  position: string | null;
  stat_line: string | null;
}

export type NflArchiveAwards = Partial<Record<NflAwardType, NflArchiveAwardEntry[]>>;

export interface NflArchiveTeamRun {
  franchise: {
    franchise_id: string;
    name: string;
    city: string;
    tricode: string;
    primary_color: string | null;
    secondary_color: string | null;
    logo_key: string | null;
    conference: NflConference;
    division: NflDivision;
  } | null;
  standing: NflArchiveStanding | null;
  series: NflArchiveSeries[];
  top_players: NflArchivePlayerStat[];
}
