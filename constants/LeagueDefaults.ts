export interface RosterSlot {
  position: string;
  label: string;
  count: number;
}

export const NBA_POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C'] as const;
export type NbaPosition = (typeof NBA_POSITIONS)[number];
export type PositionLimits = Partial<Record<NbaPosition, number | null>>;

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
  { position: 'TAXI', label: 'Taxi Squad', count: 0 },
];

export const DEFAULT_SCORING: ScoringCategory[] = [
  { stat_name: 'PTS', label: 'Points', point_value: 1 },
  { stat_name: 'REB', label: 'Rebounds', point_value: 1.2 },
  { stat_name: 'AST', label: 'Assists', point_value: 1.5 },
  { stat_name: 'STL', label: 'Steals', point_value: 3 },
  { stat_name: 'BLK', label: 'Blocks', point_value: 3 },
  { stat_name: 'TO', label: 'Turnovers', point_value: -1 },
  { stat_name: '3PM', label: '3-Pointers Made', point_value: 1 },
  { stat_name: '3PA', label: '3-Pointers Attempted', point_value: 0 },
  { stat_name: 'FGM', label: 'Field Goals Made', point_value: 2 },
  { stat_name: 'FGA', label: 'Field Goals Attempted', point_value: -1 },
  { stat_name: 'FTM', label: 'Free Throws Made', point_value: 1 },
  { stat_name: 'FTA', label: 'Free Throws Attempted', point_value: -1 },
  { stat_name: 'PF', label: 'Personal Fouls', point_value: -1 },
  { stat_name: 'DD', label: 'Double Doubles', point_value: 0 },
  { stat_name: 'TD', label: 'Triple Doubles', point_value: 0 },
];

// ── Scoring Type ──────────────────────────────────────────────────────────────

export const SCORING_TYPE_OPTIONS = ['Points', 'H2H Categories'] as const;
export type ScoringTypeOption = (typeof SCORING_TYPE_OPTIONS)[number];

export const SCORING_TYPE_TO_DB: Record<string, string> = {
  'Points': 'points',
  'H2H Categories': 'h2h_categories',
};
export const SCORING_TYPE_DISPLAY: Record<string, string> = {
  points: 'Points',
  h2h_categories: 'H2H Categories',
};

export interface CategoryConfig {
  stat_name: string;
  label: string;
  is_enabled: boolean;
  inverse: boolean;
  is_percentage: boolean;
  numerator?: string;
  denominator?: string;
}

export const DEFAULT_CATEGORIES: CategoryConfig[] = [
  // Standard 9-cat (enabled by default)
  { stat_name: 'PTS', label: 'Points', is_enabled: true, inverse: false, is_percentage: false },
  { stat_name: 'REB', label: 'Rebounds', is_enabled: true, inverse: false, is_percentage: false },
  { stat_name: 'AST', label: 'Assists', is_enabled: true, inverse: false, is_percentage: false },
  { stat_name: 'STL', label: 'Steals', is_enabled: true, inverse: false, is_percentage: false },
  { stat_name: 'BLK', label: 'Blocks', is_enabled: true, inverse: false, is_percentage: false },
  { stat_name: 'TO', label: 'Turnovers', is_enabled: true, inverse: true, is_percentage: false },
  { stat_name: '3PM', label: '3-Pointers Made', is_enabled: true, inverse: false, is_percentage: false },
  { stat_name: 'FG%', label: 'Field Goal %', is_enabled: true, inverse: false, is_percentage: true, numerator: 'FGM', denominator: 'FGA' },
  { stat_name: 'FT%', label: 'Free Throw %', is_enabled: true, inverse: false, is_percentage: true, numerator: 'FTM', denominator: 'FTA' },
  // Additional categories (disabled by default)
  { stat_name: 'FGM', label: 'Field Goals Made', is_enabled: false, inverse: false, is_percentage: false },
  { stat_name: 'FGA', label: 'Field Goals Attempted', is_enabled: false, inverse: false, is_percentage: false },
  { stat_name: 'FTM', label: 'Free Throws Made', is_enabled: false, inverse: false, is_percentage: false },
  { stat_name: 'FTA', label: 'Free Throws Attempted', is_enabled: false, inverse: false, is_percentage: false },
  { stat_name: 'PF', label: 'Personal Fouls', is_enabled: false, inverse: true, is_percentage: false },
  { stat_name: 'DD', label: 'Double Doubles', is_enabled: false, inverse: false, is_percentage: false },
  { stat_name: 'TD', label: 'Triple Doubles', is_enabled: false, inverse: false, is_percentage: false },
  { stat_name: '3PA', label: '3-Pointers Attempted', is_enabled: false, inverse: false, is_percentage: false },
];

// ── League Type ──────────────────────────────────────────────────────────────

export const LEAGUE_TYPE_OPTIONS = ['Dynasty', 'Keeper', 'Redraft'] as const;
export type LeagueTypeOption = (typeof LEAGUE_TYPE_OPTIONS)[number];

export const LEAGUE_TYPE_TO_DB: Record<LeagueTypeOption, string> = {
  Dynasty: 'dynasty',
  Keeper: 'keeper',
  Redraft: 'redraft',
};
export const LEAGUE_TYPE_DISPLAY: Record<string, string> = {
  dynasty: 'Dynasty',
  keeper: 'Keeper',
  redraft: 'Redraft',
};

export const DRAFT_TYPE_OPTIONS = ['Snake', 'Linear'] as const;
export const TIME_PER_PICK_OPTIONS = [60, 90, 120] as const;

export const TRADE_VETO_OPTIONS = ['Commissioner', 'League Vote', 'None'] as const;
export type TradeVetoOption = (typeof TRADE_VETO_OPTIONS)[number];

export const WAIVER_TYPE_OPTIONS = ['Standard', 'FAAB', 'None'] as const;
export type WaiverTypeOption = (typeof WAIVER_TYPE_OPTIONS)[number];

export const WAIVER_DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export const PLAYER_LOCK_OPTIONS = ['Daily', 'Individual'] as const;
export type PlayerLockOption = (typeof PLAYER_LOCK_OPTIONS)[number];

export const PLAYER_LOCK_TO_DB: Record<PlayerLockOption, string> = {
  'Daily': 'daily',
  'Individual': 'individual',
};
export const PLAYER_LOCK_DISPLAY: Record<string, string> = {
  daily: 'Daily',
  individual: 'Individual',
};

export const ROOKIE_DRAFT_ORDER_OPTIONS = ['Reverse Record', 'Lottery'] as const;
export type RookieDraftOrderOption = (typeof ROOKIE_DRAFT_ORDER_OPTIONS)[number];

export const INITIAL_DRAFT_ORDER_OPTIONS = ['Random', 'Manual'] as const;
export type InitialDraftOrderOption = (typeof INITIAL_DRAFT_ORDER_OPTIONS)[number];

export const INITIAL_DRAFT_ORDER_TO_DB: Record<InitialDraftOrderOption, string> = {
  Random: 'random',
  Manual: 'manual',
};
export const INITIAL_DRAFT_ORDER_DISPLAY: Record<string, string> = {
  random: 'Random',
  manual: 'Manual',
};

export const PLAYOFF_SEEDING_OPTIONS = ['Standard', 'Fixed Bracket', 'Higher Seed Picks'] as const;
export type PlayoffSeedingOption = (typeof PLAYOFF_SEEDING_OPTIONS)[number];

export const SEEDING_TO_DB: Record<string, string> = {
  'Standard': 'standard',
  'Fixed Bracket': 'fixed',
  'Higher Seed Picks': 'higher_seed_picks',
};
export const SEEDING_DISPLAY: Record<string, string> = {
  standard: 'Standard',
  fixed: 'Fixed Bracket',
  higher_seed_picks: 'Higher Seed Picks',
};

// ── Tiebreaker ──────────────────────────────────────────────────────────────

export const TIEBREAKER_OPTIONS = ['Head-to-Head', 'Total Points'] as const;
export type TiebreakerOption = (typeof TIEBREAKER_OPTIONS)[number];

export const TIEBREAKER_TO_DB: Record<TiebreakerOption, string[]> = {
  'Head-to-Head': ['head_to_head', 'points_for'],
  'Total Points': ['points_for', 'head_to_head'],
};
export const TIEBREAKER_DISPLAY: Record<string, string> = {
  head_to_head: 'Head-to-Head',
  points_for: 'Total Points',
};

export const TAXI_EXPERIENCE_OPTIONS = [
  { label: 'Rookies Only', value: 1 },
  { label: '2 Years', value: 2 },
  { label: '3 Years', value: 3 },
  { label: '4 Years', value: 4 },
  { label: 'No Max', value: null },
] as const;

export const STEP_LABELS = ['Basics', 'Roster', 'Scoring', 'Trade', 'Waivers', 'Season', 'Draft', 'Review'];

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
  leagueType: LeagueTypeOption;
  keeperCount: number;
  name: string;
  teams: number;
  isPrivate: boolean;
  rosterSlots: RosterSlot[];
  scoringType: ScoringTypeOption;
  scoring: ScoringCategory[];
  categories: CategoryConfig[];
  draftType: DraftType;
  initialDraftOrder: InitialDraftOrderOption;
  timePerPick: TimePerPick;
  maxDraftYears: number;
  tradeVetoType: TradeVetoOption;
  tradeReviewPeriodHours: number;
  tradeVotesToVeto: number;
  rookieDraftRounds: number;
  rookieDraftOrder: RookieDraftOrderOption;
  lotteryDraws: number;
  lotteryOdds: number[] | null;
  season: string;
  /** ISO date string (YYYY-MM-DD) for the fantasy season start, or null for auto */
  seasonStartDate: string | null;
  waiverType: WaiverTypeOption;
  waiverPeriodDays: number;
  faabBudget: number;
  waiverDayOfWeek: number;
  regularSeasonWeeks: number;
  playoffWeeks: number;
  playoffTeams: number;
  playoffSeedingFormat: PlayoffSeedingOption;
  reseedEachRound: boolean;
  pickConditionsEnabled: boolean;
  draftPickTradingEnabled: boolean;
  /** 0 = no deadline, 1+ = trades locked after this week ends */
  tradeDeadlineWeek: number;
  /** 0 = free league, positive = buy-in amount in dollars */
  buyIn: number;
  venmoUsername: string;
  cashappTag: string;
  paypalUsername: string;
  /** null = no max, 1 = rookies only, 2-4 = max years of NBA experience */
  taxiMaxExperience: number | null;
  /** null = unlimited, positive = max adds per matchup week */
  weeklyAcquisitionLimit: number | null;
  /** Lock mode for free-agent adds once games start */
  playerLockType: PlayerLockOption;
  /** Auto-announce when multiple teams bid on the same player */
  autoRumorsEnabled: boolean;
  /** Primary tiebreaker method when teams have equal wins */
  tiebreakerPrimary: TiebreakerOption;
  /** 1 = no divisions, 2 = two divisions */
  divisionCount: 1 | 2;
  division1Name: string;
  division2Name: string;
  /** Per-position roster limits. Empty object = no limits. */
  positionLimits: PositionLimits;
}
