// Shared types for the League History hooks. Split out of the former
// monolithic useLeagueHistory.ts so each data-source module (season results,
// matchup records, drafts, brackets) can import only what it needs.

export interface ChampionEntry {
  season: string;
  champion: { id: string; name: string } | null;
  runnerUp: { id: string; name: string } | null;
}

export interface TeamSeasonRow {
  id: string;
  team_id: string;
  season: string;
  /** The team's name that season (rebrands); null falls back to the live team.name. */
  team_name: string | null;
  wins: number;
  losses: number;
  ties: number;
  points_for: number;
  points_against: number;
  final_standing: number;
  division: number | null;
  playoff_result: string;
  team: { id: string; name: string; tricode: string | null; logo_key: string | null };
}

export interface RecordEntry {
  label: string;
  value: string;
  teamName: string;
  detail: string; // e.g. season or "Week 4, 2025-26"
}

export interface H2HRecord {
  wins: number;
  losses: number;
  ties: number;
}

export interface MatchupRow {
  id: string;
  schedule_id: string;
  home_team_id: string;
  away_team_id: string | null;
  home_score: number;
  away_score: number;
  winner_team_id: string | null;
  is_finalized: boolean;
  playoff_round: number | null;
}

export interface ScheduleRow {
  id: string;
  season: string;
  week_number: number;
}

export interface H2HData {
  teams: { id: string; name: string; tricode: string | null }[];
  records: Record<string, H2HRecord>; // key: `${teamA}_${teamB}`
  matchups: (MatchupRow & { season: string; week_number: number })[];
}

export interface DraftSummary {
  id: string;
  season: string;
  type: string;
  draft_type: string;
  rounds: number;
  status: string;
}

export interface DraftHistoryPick {
  id: string;
  draft_id: string;
  pick_number: number;
  round: number;
  slot_number: number;
  current_team_id: string;
  original_team_id: string;
  player_name: string | null;
  player_position: string | null;
  current_team_name: string;
  current_team_tricode: string | null;
  original_team_name: string;
  original_team_tricode: string | null;
  isTraded: boolean;
}

export interface BracketSlotHistory {
  id: string;
  season: string;
  round: number;
  bracket_position: number;
  matchup_id: string | null;
  team_a_id: string | null;
  team_a_seed: number | null;
  team_a_score: number | null;
  team_b_id: string | null;
  team_b_seed: number | null;
  team_b_score: number | null;
  winner_id: string | null;
  is_bye: boolean;
  is_third_place: boolean;
}

export interface BracketHistoryData {
  bracketsBySeason: Map<string, BracketSlotHistory[]>;
  seasons: string[]; // newest first
  teamMap: Map<string, { id: string; name: string; tricode: string | null; logo_key: string | null }>;
}
