// Shared types for the NHL Playoff Archive feature.
// Mirrors the JSON shape returned by the nhl_archive_* RPCs, which match
// the NBA archive envelope so the React layer can stay consistent.

export type NhlConference = string; // 'East' | 'West' historically; permissive for old eras
export type NhlDivision = string; // Atlantic/Metro/Central/Pacific etc., changes by era
export type NhlPlayoffFormat =
  | 'division_bracket_1980_1993'
  | 'conference_bracket_1994_2013'
  | 'divisional_2014_present';

export interface NhlArchiveYear {
  season: number;
  num_teams: number;
  format: NhlPlayoffFormat;
  champion_franchise_id: string | null;
  conn_smythe_player_name: string | null;
  conn_smythe_hr_id: string | null;
  conn_smythe_franchise_id: string | null;
  conn_smythe_stat_line: string | null;
}

export interface NhlArchiveFranchiseSeason {
  franchise_id: string;
  name: string;
  city: string;
  tricode: string;
  primary_color: string | null;
  secondary_color: string | null;
  logo_key: string | null;
  conference: NhlConference;
  division: NhlDivision;
  current_name: string;
  current_city: string;
}

export interface NhlArchiveSeries {
  id: string;
  season: number;
  round: number;
  conference: NhlConference;
  division: NhlDivision | null;
  bracket_position: number;
  franchise_a_id: string | null;
  franchise_b_id: string | null;
  seed_a: number | null;
  seed_b: number | null;
  winner_franchise_id: string | null;
  wins_a: number;
  wins_b: number;
}

export interface NhlArchiveGame {
  series_id: string;
  game_num: number;
  home_franchise_id: string | null;
  away_franchise_id: string | null;
  home_score: number | null;
  away_score: number | null;
  ot_periods: number;
  shootout: boolean;
  played_on: string | null;
}

export interface NhlArchiveBracket {
  year: NhlArchiveYear | null;
  franchises: NhlArchiveFranchiseSeason[];
  series: NhlArchiveSeries[];
  games: NhlArchiveGame[];
}

export interface NhlArchiveStanding {
  franchise_id: string;
  wins: number;
  losses: number;
  otl: number;
  points: number;
  conference: NhlConference;
  division: NhlDivision;
  conference_seed: number;
  division_seed: number;
  goals_for: number | null;
  goals_against: number | null;
  // joined from nhl_franchise_season:
  name: string;
  city: string;
  tricode: string;
  primary_color: string | null;
  secondary_color: string | null;
  logo_key: string | null;
}

export interface NhlArchiveStandingsPayload {
  standings: NhlArchiveStanding[];
}

export type NhlPlayerPosition = 'F' | 'D' | 'G';

export interface NhlArchivePlayerStat {
  season: number;
  franchise_id: string;
  hr_player_id: string;
  player_name: string;
  position: NhlPlayerPosition;
  gp: number;
  goals: number | null;
  assists: number | null;
  points: number | null;
  plus_minus: number | null;
  pim: number | null;
  sog: number | null;
  wins: number | null;
  losses: number | null;
  gaa: number | null;
  sv_pct: number | null;
  shutouts: number | null;
}

export type NhlAwardType =
  | 'hart'
  | 'norris'
  | 'vezina'
  | 'calder'
  | 'selke'
  | 'lady_byng'
  | 'jack_adams'
  | 'ted_lindsay'
  | 'rocket_richard'
  | 'art_ross'
  | 'conn_smythe'
  | 'presidents_trophy'
  | 'all_star_first'
  | 'all_star_second'
  | 'all_rookie';

export interface NhlArchiveAwardEntry {
  rank: number;
  player_name: string;
  hr_player_id: string | null;
  franchise_id: string | null;
  position: string | null;
  stat_line: string | null;
}

export type NhlArchiveAwards = Partial<Record<NhlAwardType, NhlArchiveAwardEntry[]>>;

export interface NhlArchiveTeamRun {
  franchise: {
    franchise_id: string;
    name: string;
    city: string;
    tricode: string;
    primary_color: string | null;
    secondary_color: string | null;
    logo_key: string | null;
    conference: NhlConference;
    division: NhlDivision;
  } | null;
  standing: NhlArchiveStanding | null;
  series: NhlArchiveSeries[];
  top_players: NhlArchivePlayerStat[];
}
