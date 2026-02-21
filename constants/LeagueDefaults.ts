export interface RosterSlot {
  position: string;
  label: string;
  count: number;
}

export interface ScoringCategory {
  stat_name: string;
  label: string;
  point_value: number;
}

export const DEFAULT_ROSTER_SLOTS: RosterSlot[] = [
  { position: 'PG', label: 'Point Guard', count: 1 },
  { position: 'SG', label: 'Shooting Guard', count: 1 },
  { position: 'SF', label: 'Small Forward', count: 1 },
  { position: 'PF', label: 'Power Forward', count: 1 },
  { position: 'C', label: 'Center', count: 1 },
  { position: 'G', label: 'Guard', count: 1 },
  { position: 'F', label: 'Forward', count: 1 },
  { position: 'UTIL', label: 'Utility', count: 3 },
  { position: 'BE', label: 'Bench', count: 3 },
  { position: 'IR', label: 'Injured Reserve', count: 0 },
];

export const DEFAULT_SCORING: ScoringCategory[] = [
  { stat_name: 'PTS', label: 'Points', point_value: 1 },
  { stat_name: 'REB', label: 'Rebounds', point_value: 1.2 },
  { stat_name: 'AST', label: 'Assists', point_value: 1.5 },
  { stat_name: 'STL', label: 'Steals', point_value: 3 },
  { stat_name: 'BLK', label: 'Blocks', point_value: 3 },
  { stat_name: 'TO', label: 'Turnovers', point_value: -1 },
  { stat_name: '3PM', label: '3-Pointers Made', point_value: 1 },
  { stat_name: 'FGM', label: 'Field Goals Made', point_value: 2 },
  { stat_name: 'FGA', label: 'Field Goals Attempted', point_value: -1 },
  { stat_name: 'FTM', label: 'Free Throws Made', point_value: 1 },
  { stat_name: 'FTA', label: 'Free Throws Attempted', point_value: -1 },
];

export const DRAFT_TYPE_OPTIONS = ['Snake', 'Linear'] as const;
export const TIME_PER_PICK_OPTIONS = [60, 90, 120] as const;

export const STEP_LABELS = ['Basics', 'Roster', 'Scoring', 'Draft', 'Season', 'Review'];

// Hardcoded NBA regular season end dates per season string.
// Update each year or replace with a live query once nba_schedule is populated.
export const NBA_SEASON_END: Record<string, string> = {
  '2024-25': '2025-04-13',
  '2025-26': '2026-04-12',
};

export const CURRENT_NBA_SEASON = '2025-26';

export type DraftType = (typeof DRAFT_TYPE_OPTIONS)[number];
export type TimePerPick = (typeof TIME_PER_PICK_OPTIONS)[number];

export interface LeagueWizardState {
  name: string;
  teams: number;
  isPrivate: boolean;
  rosterSlots: RosterSlot[];
  scoring: ScoringCategory[];
  draftType: DraftType;
  timePerPick: TimePerPick;
  maxDraftYears: number;
  season: string;
  regularSeasonWeeks: number;
  playoffWeeks: number;
}
