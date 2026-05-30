export interface RosterSlot {
  position: string;
  label: string;
  count: number;
}

export const NBA_POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C'] as const;
export type NbaPosition = (typeof NBA_POSITIONS)[number];

// WNBA reports bare-letter positions (G/F/C) so the spectrum used for
// roster slots and position limits is shorter. PG/SG/SF/PF don't exist
// as roster concepts in WNBA leagues.
export const WNBA_POSITIONS = ['G', 'F', 'C'] as const;
export type WnbaPosition = (typeof WNBA_POSITIONS)[number];

export type LimitablePosition = NbaPosition | WnbaPosition;
export type PositionLimits = Partial<Record<LimitablePosition, number | null>>;

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

export const WNBA_DEFAULT_ROSTER_SLOTS: RosterSlot[] = [
  { position: 'G', label: 'Guard', count: 2 },
  { position: 'F', label: 'Forward', count: 2 },
  { position: 'C', label: 'Center', count: 1 },
  { position: 'UTIL', label: 'Utility', count: 2 },
  { position: 'BE', label: 'Bench', count: 3 },
  { position: 'IR', label: 'Injured Reserve', count: 0 },
  { position: 'TAXI', label: 'Taxi Squad', count: 0 },
];

/** Returns the default roster slot template for the given sport. */
export function getDefaultRosterSlots(sport: Sport): RosterSlot[] {
  if (sport === 'wnba') return WNBA_DEFAULT_ROSTER_SLOTS.map((s) => ({ ...s }));
  return DEFAULT_ROSTER_SLOTS.map((s) => ({ ...s }));
}

/** Positions used for per-position roster caps. WNBA omits PG/SG/SF/PF. */
export function getLimitablePositions(sport: Sport): readonly LimitablePosition[] {
  return sport === 'wnba' ? WNBA_POSITIONS : NBA_POSITIONS;
}

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
// Pick clock bounds, in seconds. Tap-typing into the NumberStepper clamps to
// the same range — kept wide so async/snail drafts can sit at the cap.
export const TIME_PER_PICK_MIN = 15;
export const TIME_PER_PICK_MAX = 300;
export const TIME_PER_PICK_STEP = 15;

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

export const STEP_LABELS = ['Basics', 'Roster', 'Scoring', 'Waivers', 'Season', 'Trade', 'Draft', 'Review'];

// ── Sport ────────────────────────────────────────────────────────────────────
// All sport-aware code (hooks, queries, season strings) keys off this type.
// `'nba'` and `'wnba'` are the DB-side values; `'NBA'` / `'WNBA'` are the
// labels shown in the wizard and other UI.

// Sports the app is structurally aware of. Only `nba` and `wnba` are wired
// end-to-end today; `nfl`, `nhl`, `mlb` are future expansions — the type
// includes them so call sites that switch on sport stay exhaustive-checked
// while we scaffold theming, position systems, etc. Adding a new sport in
// production also requires:
//   1. ALTER TABLE leagues to widen the CHECK constraint
//   2. Add to SPORT_THEMES in constants/Colors.ts
//   3. Build the sport-specific data ingestion, position spectrum, etc.
export const SPORT_OPTIONS = ['NBA', 'WNBA'] as const;
export type SportOption = (typeof SPORT_OPTIONS)[number];
export type Sport = 'nba' | 'wnba' | 'nfl' | 'nhl' | 'mlb';

export const SPORT_TO_DB: Record<SportOption, Sport> = {
  NBA: 'nba',
  WNBA: 'wnba',
};
export const SPORT_DISPLAY: Record<Sport, string> = {
  nba: 'NBA',
  wnba: 'WNBA',
  nfl: 'NFL',
  nhl: 'NHL',
  mlb: 'MLB',
};

// Hardcoded regular season end dates per season string. Update each year or
// replace with a live query once game_schedule is populated.
// NBA uses dash format ("2025-26"), WNBA uses single-year format ("2026").
export const NBA_SEASON_END: Record<string, string> = {
  '2024-25': '2025-04-13',
  '2025-26': '2026-04-12',
  '2026-27': '2027-04-11',
};

export const WNBA_SEASON_END: Record<string, string> = {
  '2025': '2025-09-19',
  '2026': '2026-09-13',
  '2027': '2027-09-12',
};

// Opening-night dates per season, used as the default seasonStartDate when
// the wizard pre-fills it. Mirrors the *_SEASON_END shape — bump yearly.
export const NBA_SEASON_START: Record<string, string> = {
  '2024-25': '2024-10-22',
  '2025-26': '2025-10-21',
  '2026-27': '2026-10-20',
};

export const WNBA_SEASON_START: Record<string, string> = {
  '2025': '2025-05-16',
  '2026': '2026-05-15',
  '2027': '2027-05-15',
};

export const CURRENT_NBA_SEASON = '2025-26';
export const CURRENT_WNBA_SEASON = '2026';

export function getCurrentSeason(sport: Sport): string {
  return sport === 'wnba' ? CURRENT_WNBA_SEASON : CURRENT_NBA_SEASON;
}

// Previous season label, derived from CURRENT_*_SEASON.
// NBA "2025-26" → "2024-25"; WNBA "2026" → "2025".
export function getPreviousSeason(sport: Sport): string {
  const startYear = parseInt(getCurrentSeason(sport).split('-')[0], 10);
  return formatSeason(startYear - 1, sport);
}

export function getSeasonEnd(sport: Sport, season: string): string | undefined {
  return sport === 'wnba' ? WNBA_SEASON_END[season] : NBA_SEASON_END[season];
}

export function getSeasonStart(sport: Sport, season: string): string | undefined {
  return sport === 'wnba' ? WNBA_SEASON_START[season] : NBA_SEASON_START[season];
}

// Hardcoded month/day per sport when next-season league creation becomes
// available. Picked to land post-Finals / pre-Summer League (NBA) and
// post-Finals / pre-Draft (WNBA). Adjust as the calendar shifts.
const SPORT_NEXT_SEASON_OPENS: Record<Sport, { month: number; day: number } | undefined> = {
  nba: { month: 7, day: 1 },
  wnba: { month: 11, day: 1 },
  nfl: undefined,
  nhl: undefined,
  mlb: undefined,
};

/** Minimum weeks remaining in the current season for it to still be worth
 *  creating a league for — below this the regular season is too short to
 *  produce a meaningful playoff arc. Scaled per-sport: NBA's 25-week season
 *  affords a higher floor than WNBA's ~17-week season. Both land near 40%
 *  of total season length so the cutoff feels proportionally consistent. */
const SPORT_MIN_WEEKS_REMAINING: Record<Sport, number> = {
  nba: 10,
  wnba: 7,
  nfl: 6,
  nhl: 10,
  mlb: 12,
};

export function getMinWeeksRemaining(sport: Sport): number {
  return SPORT_MIN_WEEKS_REMAINING[sport] ?? 10;
}

export interface SeasonCreationStatus {
  /** Sport this status describes. */
  sport: Sport;
  /** Season the wizard would create for if this sport were picked — the
   *  current season when its window is open, otherwise the upcoming one.
   *  Always populated so the UI can show a season label per tile. */
  season: string;
  /** Hardcoded opening-night date (yyyy-mm-dd) for `season`, if known. */
  defaultStartDate: string | null;
  /** Whether the wizard can be entered for this sport right now. */
  available: boolean;
  /** When `!available`, a short human label for when the window opens
   *  ("Jul 1"). Composed into "Opens {opensAt}" by the tile component. */
  opensAt?: string;
}


/** Returns whether a league can currently be created for `sport`. If the
 *  current season has < SEASON_MIN_WEEKS_REMAINING weeks left, falls forward
 *  to the next season once today ≥ that sport's hardcoded open date. */
export function getCreationStatus(sport: Sport, today: Date = new Date()): SeasonCreationStatus {
  const currentSeason = getCurrentSeason(sport);
  const currentEnd = getSeasonEnd(sport, currentSeason);
  const todayMidnight = new Date(today);
  todayMidnight.setHours(0, 0, 0, 0);

  // Is the current season still creatable (≥ MIN weeks left between today
  // and the regular-season end)?
  if (currentEnd) {
    const [ey, em, ed] = currentEnd.split('-').map(Number);
    const endDate = new Date(ey, em - 1, ed);
    const msPerWeek = 7 * 24 * 60 * 60 * 1000;
    const weeksRemaining = Math.floor((endDate.getTime() - todayMidnight.getTime()) / msPerWeek);
    if (weeksRemaining >= getMinWeeksRemaining(sport)) {
      return {
        sport,
        season: currentSeason,
        defaultStartDate: getSeasonStart(sport, currentSeason) ?? null,
        available: true,
      };
    }
  }

  // Current season's window closed — fall forward to next season. Show it
  // as the tile's "season" label either way (available once opens past, or
  // gated until then).
  const opens = SPORT_NEXT_SEASON_OPENS[sport];
  const nextSeasonStartYear = parseSeasonStartYear(currentSeason) + 1;
  const nextSeason = formatSeason(nextSeasonStartYear, sport);
  if (opens) {
    const openDate = new Date(todayMidnight.getFullYear(), opens.month - 1, opens.day);
    if (todayMidnight >= openDate) {
      return {
        sport,
        season: nextSeason,
        defaultStartDate: getSeasonStart(sport, nextSeason) ?? null,
        available: true,
      };
    }
    const openLabel = openDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return {
      sport,
      season: nextSeason,
      defaultStartDate: null,
      available: false,
      opensAt: openLabel,
    };
  }

  return {
    sport,
    season: nextSeason,
    defaultStartDate: null,
    available: false,
  };
}

// Realistic upper bound on the rookie pool each year — caps fantasy rookie
// draft rounds so total picks (rounds × teams) can't exceed the players that
// will actually be available. NBA = 60 (2-round real draft × 30 teams);
// WNBA = 36 (modern 3-round × 12 teams).
const ROOKIE_POOL_SIZE: Partial<Record<Sport, number>> = {
  nba: 60,
  wnba: 36,
};

// Absolute ceiling on the rounds stepper regardless of league size — keeps
// small leagues from selecting absurd round counts (4 teams × 15 rounds = 60
// rookies, technically valid by pool but nonsensical for play).
const ROOKIE_ROUNDS_CEILING = 5;

export function getMaxRookieDraftRounds(sport: Sport, teams: number): number {
  const pool = ROOKIE_POOL_SIZE[sport] ?? 60;
  const byPool = Math.max(1, Math.floor(pool / Math.max(1, teams)));
  return Math.min(ROOKIE_ROUNDS_CEILING, byPool);
}

/** Strict majority: ⌊teams/2⌋ + 1 — ensures a veto vote always requires more
 *  than half the league regardless of team count. */
export function defaultVotesToVeto(teams: number): number {
  return Math.floor(teams / 2) + 1;
}

/** Common real-world convention is a deadline 4 weeks before playoffs. */
export function defaultTradeDeadlineWeek(regularSeasonWeeks: number): number {
  return Math.max(1, regularSeasonWeeks - 4);
}

/** Hard cap on playoff weeks per sport. 4 weeks supports a 16-team
 *  bracket; 3 weeks tops out at 8 teams. WNBA's shorter regular season
 *  + smaller typical league size means 3 weeks is the practical ceiling.
 *  Note: `PLAYOFF_OPTIONS` in utils/league/lottery only defines
 *  meaningful team counts for 1-4 weeks; anything ≥ 5 falls through
 *  to `2 ** weeks` which produces unreachable team counts. */
const SPORT_MAX_PLAYOFF_WEEKS: Record<Sport, number> = {
  nba: 4,
  wnba: 3,
  nfl: 4,
  nhl: 4,
  mlb: 4,
};

export function getMaxPlayoffWeeks(sport: Sport): number {
  return SPORT_MAX_PLAYOFF_WEEKS[sport] ?? 4;
}

// Format a season string from its starting calendar year, sport-aware.
// NBA seasons span two years ('2025-26'); WNBA seasons are single-year ('2026').
export function formatSeason(startYear: number, sport: Sport): string {
  if (sport === 'wnba') return String(startYear);
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}

// Inverse of formatSeason — extracts the starting calendar year. Works for
// both formats since WNBA has no dash (split('-')[0] returns the whole string).
export function parseSeasonStartYear(season: string): number {
  return parseInt(season.split('-')[0], 10);
}

// Whether a stored `season_start_date` (yyyy-mm-dd) actually belongs to the
// given season. NBA seasons span two calendar years ("2025-26" → 2025 & 2026);
// WNBA is single-year. After `advance-season` the season string is bumped but
// `season_start_date` still holds the prior season's date, so this returns
// false until the commissioner sets the new date — the cue to show a "TBD"
// placeholder instead of a misleading old date.
export function startDateBelongsToSeason(
  season: string,
  startDate: string | null | undefined,
): boolean {
  if (!startDate) return false;
  const startYear = parseSeasonStartYear(season);
  const dateYear = Number(startDate.slice(0, 4));
  return dateYear === startYear || dateYear === startYear + 1;
}

// Rough opening month per sport, for the placeholder shown before a season's
// start date has been set. NBA tips off mid-October; the WNBA in mid-May.
export const SPORT_OPENING_MONTH: Partial<Record<Sport, string>> = {
  nba: 'Oct',
  wnba: 'May',
};

export type DraftType = (typeof DRAFT_TYPE_OPTIONS)[number];

export interface LeagueWizardState {
  sport: Sport;
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
  timePerPick: number;
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
  /** null = no max, 1 = rookies only, 2-4 = max years of pro experience */
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
