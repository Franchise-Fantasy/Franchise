import { schedulableEnd, type MergeWindow } from '@/utils/league/scheduleWindows';
import { getSportModule } from '@/utils/sports/registry';

export interface RosterSlot {
  position: string;
  label: string;
  count: number;
}

// Position token tuples stay declared here (`as const`) because they carry the
// Nba/Wnba/NflPosition types. The behavioral copies live in
// utils/sports/registry.ts; a unit test asserts the two stay identical.
export const NBA_POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C'] as const;
export type NbaPosition = (typeof NBA_POSITIONS)[number];

// WNBA reports bare-letter positions (G/F/C) so the spectrum used for
// roster slots and position limits is shorter. PG/SG/SF/PF don't exist
// as roster concepts in WNBA leagues.
export const WNBA_POSITIONS = ['G', 'F', 'C'] as const;
export type WnbaPosition = (typeof WNBA_POSITIONS)[number];

// NFL positions are disjoint categories (no spectrum). DST is the synthetic
// team-defense entity; K is normalized from BDL's "PK" token at ingest.
export const NFL_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DST'] as const;
export type NflPosition = (typeof NFL_POSITIONS)[number];

export type LimitablePosition = NbaPosition | WnbaPosition | NflPosition;
export type PositionLimits = Partial<Record<LimitablePosition, number | null>>;

export interface ScoringCategory {
  stat_name: string;
  label: string;
  point_value: number;
}

// Roster/scoring defaults are sourced from the sports registry (the single
// source shared with edge functions). Copied on init so accidental in-place
// mutation by a consumer can't corrupt the registry.
export const DEFAULT_ROSTER_SLOTS: RosterSlot[] =
  getSportModule('nba').defaultRosterSlots.map((s) => ({ ...s }));

export const WNBA_DEFAULT_ROSTER_SLOTS: RosterSlot[] =
  getSportModule('wnba').defaultRosterSlots.map((s) => ({ ...s }));

/** Returns the default roster slot template for the given sport. */
export function getDefaultRosterSlots(sport: Sport): RosterSlot[] {
  return getSportModule(sport).defaultRosterSlots.map((s) => ({ ...s }));
}

/** Positions used for per-position roster caps and filter chips. */
export function getLimitablePositions(sport: Sport): readonly LimitablePosition[] {
  return getSportModule(sport).positions as readonly LimitablePosition[];
}

export const DEFAULT_SCORING: ScoringCategory[] =
  getSportModule('nba').defaultScoring.map((s) => ({ ...s }));

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

// How waiver priority order re-seeds at each season rollover (advance-season).
// Only consulted for leagues that actually use waiver priority (Standard, and
// FAAB when faabTiebreak === 'Waiver Priority').
export const WAIVER_PRIORITY_RESET_OPTIONS = ['Reverse Standings', 'Keep', 'Random'] as const;
export type WaiverPriorityResetOption = (typeof WAIVER_PRIORITY_RESET_OPTIONS)[number];

export const WAIVER_PRIORITY_RESET_TO_DB: Record<WaiverPriorityResetOption, string> = {
  'Reverse Standings': 'reverse_standings',
  'Keep': 'keep',
  'Random': 'random',
};
export const WAIVER_PRIORITY_RESET_DISPLAY: Record<string, WaiverPriorityResetOption> = {
  reverse_standings: 'Reverse Standings',
  keep: 'Keep',
  random: 'Random',
};

// How an EXACT equal-bid tie is broken in a FAAB league (process-waivers).
export const FAAB_TIEBREAK_OPTIONS = ['Earliest Bid', 'Waiver Priority'] as const;
export type FaabTiebreakOption = (typeof FAAB_TIEBREAK_OPTIONS)[number];

export const FAAB_TIEBREAK_TO_DB: Record<FaabTiebreakOption, string> = {
  'Earliest Bid': 'earliest_bid',
  'Waiver Priority': 'waiver_priority',
};
export const FAAB_TIEBREAK_DISPLAY: Record<string, FaabTiebreakOption> = {
  earliest_bid: 'Earliest Bid',
  waiver_priority: 'Waiver Priority',
};

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

export const PLAYOFF_SEEDING_OPTIONS = ['Standard', 'Reseed', 'Higher Seed Picks'] as const;
export type PlayoffSeedingOption = (typeof PLAYOFF_SEEDING_OPTIONS)[number];

// A single seeding choice drives two DB columns: the format enum and the reseed
// flag. buildNextRound (utils/league/playoff.ts) only re-ranks when
// format='standard' AND reseed=true, so "Standard" is a fixed bracket and
// "Reseed" re-ranks each round. The legacy 'Fixed Bracket' label is kept here so
// in-progress create-league drafts saved before this change still resolve.
export const SEEDING_TO_DB: Record<string, { format: string; reseed: boolean }> = {
  'Standard': { format: 'standard', reseed: false },
  'Reseed': { format: 'standard', reseed: true },
  'Higher Seed Picks': { format: 'higher_seed_picks', reseed: false },
  'Fixed Bracket': { format: 'standard', reseed: false }, // legacy label
};

/**
 * Map the stored (format, reseed) columns back to a UI label. Legacy 'fixed'
 * rows — and any 'standard' row with reseed off — are the fixed bracket =
 * "Standard"; they behave identically in buildNextRound.
 */
export function seedingDisplay(format: string, reseed: boolean): PlayoffSeedingOption {
  if (format === 'higher_seed_picks') return 'Higher Seed Picks';
  if (format === 'standard' && reseed) return 'Reseed';
  return 'Standard';
}

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
// NFL is internal-test only: the SportSelector hides its tile behind
// profiles.is_admin (useIsAdmin), and the leagues_nfl_admin_gate DB trigger
// enforces the same server-side.
export const SPORT_OPTIONS = ['NBA', 'WNBA', 'NFL'] as const;
export type SportOption = (typeof SPORT_OPTIONS)[number];
export type Sport = 'nba' | 'wnba' | 'nfl' | 'nhl' | 'mlb';

export const SPORT_TO_DB: Record<SportOption, Sport> = {
  NBA: 'nba',
  WNBA: 'wnba',
  NFL: 'nfl',
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
  '2027-28': '2028-04-09',
};

export const WNBA_SEASON_END: Record<string, string> = {
  '2025': '2025-09-19',
  '2026': '2026-09-24',
  '2027': '2027-09-12',
};

// NFL seasons are single-year like WNBA. End = the MONDAY closing the last
// fantasy week (NFL weeks are Tue–Mon), not the last real game day — week 18's
// games end Sat/Sun but their fantasy week runs through Monday, and
// computeMaxWeeks drops any week whose endDate is past this cap. 2025/2026
// derive from real BDL dates; 2027 is an estimate — season_config overrides it.
export const NFL_SEASON_END: Record<string, string> = {
  '2025': '2026-01-05',
  '2026': '2027-01-11',
  '2027': '2028-01-10',
};

// Opening-night dates per season, used as the default seasonStartDate when
// the wizard pre-fills it. Mirrors the *_SEASON_END shape — bump yearly.
export const NBA_SEASON_START: Record<string, string> = {
  '2024-25': '2024-10-22',
  '2025-26': '2025-10-21',
  '2026-27': '2026-10-20',
  '2027-28': '2027-10-19',
};

export const WNBA_SEASON_START: Record<string, string> = {
  '2025': '2025-05-16',
  '2026': '2026-05-08',
  '2027': '2027-05-15',
};

// Kickoff (opening game) dates. 2026 opener is Wed Sep 9 per BDL; 2027 is an
// estimate (Thu after Labor Day) — season_config overrides it.
export const NFL_SEASON_START: Record<string, string> = {
  '2025': '2025-09-04',
  '2026': '2026-09-09',
  '2027': '2027-09-09',
};

export const CURRENT_NBA_SEASON = '2026-27';
export const CURRENT_WNBA_SEASON = '2026';
export const CURRENT_NFL_SEASON = '2026';

// ── Season config cache ───────────────────────────────────────────────────
// Hydrated from the `season_config` table on app startup (see
// hooks/useSeasonConfig). Until then — and if the fetch fails or runs offline —
// the lookups below fall back to the hardcoded constants above, so the table is
// a no-deploy override, never a hard dependency.
export interface SeasonConfigRow {
  sport: Sport;
  season: string;
  start_date: string;
  end_date: string;
  creation_opens_at: string | null;
  is_current: boolean;
  /** Calendar windows that collapse into "double weeks" — see getMergeWindows. */
  merge_windows: MergeWindow[];
}

let seasonConfigCache: SeasonConfigRow[] | null = null;

/** Populate the season-config cache. Called once from the hydration hook; an
 *  empty array clears it so the hardcoded fallbacks resume. */
export function setSeasonConfigCache(rows: SeasonConfigRow[]): void {
  seasonConfigCache = rows.length > 0 ? rows : null;
}

function cachedSeasonRow(sport: Sport, season: string): SeasonConfigRow | undefined {
  return seasonConfigCache?.find((r) => r.sport === sport && r.season === season);
}

export function getCurrentSeason(sport: Sport): string {
  const current = seasonConfigCache?.find((r) => r.sport === sport && r.is_current);
  if (current) return current.season;
  if (sport === 'wnba') return CURRENT_WNBA_SEASON;
  if (sport === 'nfl') return CURRENT_NFL_SEASON;
  return CURRENT_NBA_SEASON;
}

// Previous season label, derived from CURRENT_*_SEASON.
// NBA "2025-26" → "2024-25"; WNBA "2026" → "2025".
export function getPreviousSeason(sport: Sport): string {
  const startYear = parseInt(getCurrentSeason(sport).split('-')[0], 10);
  return formatSeason(startYear - 1, sport);
}

// Whether a league's most recent rookie draft has been committed. `null`
// means the league isn't in its offseason at all.
export function isRookieDraftComplete(offseasonStep: string | null | undefined): boolean {
  return offseasonStep === 'rookie_draft_complete' || offseasonStep === 'ready_for_new_season';
}

// Start-year offset for "the next rookie draft class" relative to a league's
// own `season` row. During the regular season the upcoming draft is for next
// year's class (offset +1). `advance-season` flips `league.season` to the new
// year at the START of the offseason, and the incoming rookie draft — the one
// the lottery seeds — is for THAT season itself (offset 0), until this
// league's own draft completes. Shared by useDraftHub (pick/lottery windows)
// and useNextRookieDraftYear (Prospects tab) so the two can't drift apart.
export function rookieDraftStartOffset(offseasonStep: string | null | undefined): 0 | 1 {
  const inOffseason = offseasonStep != null;
  return inOffseason && !isRookieDraftComplete(offseasonStep) ? 0 : 1;
}

export function getSeasonEnd(sport: Sport, season: string): string | undefined {
  const cached = cachedSeasonRow(sport, season);
  if (cached) return cached.end_date;
  if (sport === 'wnba') return WNBA_SEASON_END[season];
  if (sport === 'nfl') return NFL_SEASON_END[season];
  return NBA_SEASON_END[season];
}

export function getSeasonStart(sport: Sport, season: string): string | undefined {
  const cached = cachedSeasonRow(sport, season);
  if (cached) return cached.start_date;
  if (sport === 'wnba') return WNBA_SEASON_START[season];
  if (sport === 'nfl') return NFL_SEASON_START[season];
  return NBA_SEASON_START[season];
}

/** Last date a fantasy season for this sport+season may be scheduled to. A
 *  terminal merge window (the WNBA FIBA break) walls off the season end — the
 *  regular season AND playoffs must finish before it — so the effective end is
 *  the day before the break, not the pro season's listed end. Returns the pro
 *  end unchanged when there's no terminal break. Drives the create/edit
 *  start-date picker max and the season-end preview. */
export function getSchedulableSeasonEnd(sport: Sport, season: string): string | undefined {
  const end = getSeasonEnd(sport, season);
  return end ? schedulableEnd(end, getMergeWindows(sport, season)) : undefined;
}

// Hardcoded merge-window fallbacks — mirror the season_config.merge_windows seed
// so the create-league wizard preview reflects double weeks even before the
// cache hydrates (or offline). The authoritative copy lives in season_config
// (edit-via-SQL, no deploy); keep this in sync when adding a season's windows.
// See utils/league/scheduleWindows for the merge semantics.
export const NBA_MERGE_WINDOWS: Record<string, MergeWindow[]> = {
  '2025-26': [
    { start: '2026-02-09', end: '2026-02-22', label: 'All-Star Break', optional: false },
    { start: '2025-12-08', end: '2025-12-21', label: 'NBA Cup Knockouts', optional: true },
  ],
  // 2026-27 (real dates): All-Star weekend Feb 19-21, 2027 → the two straddling
  // half-weeks (Feb 15-21 + Feb 22-28) merge. NBA Cup knockouts run Dec 4-5 (QF),
  // Dec 8-9 (SF), Dec 11 (Final); only the SF/Final stretch (Dec 8-11) is light,
  // so the Cup week (Dec 7-13) merges BACKWARD into the quarterfinal week
  // (Nov 30-Dec 6) — window starts Dec 4 so the whole knockout run lands in one
  // matchup ending Sun Dec 13. Both window ends are Sundays to keep weeks aligned.
  '2026-27': [
    { start: '2027-02-15', end: '2027-02-28', label: 'All-Star Break', optional: false },
    { start: '2026-12-04', end: '2026-12-13', label: 'NBA Cup Knockouts', optional: true },
  ],
};

export const WNBA_MERGE_WINDOWS: Record<string, MergeWindow[]> = {
  '2026': [
    { start: '2026-07-20', end: '2026-08-02', label: 'All-Star Break', optional: false },
    // `terminal`: the fantasy season ends BEFORE the FIBA break (Aug 31) rather
    // than scheduling through it, so playoffs/championship can't straddle the
    // 17-day gap. The post-break Sep 17–24 games go unused (like NBA fantasy
    // ending before the real playoffs).
    { start: '2026-08-31', end: '2026-09-24', label: 'FIBA World Cup Break', optional: false, terminal: true },
  ],
};

/** Merge windows for a sport+season (cache-first, hardcoded fallback). The
 *  edge function reads season_config directly; this mirrors it for the wizard. */
export function getMergeWindows(sport: Sport, season: string): MergeWindow[] {
  const cached = cachedSeasonRow(sport, season);
  if (cached) return cached.merge_windows ?? [];
  // NFL has no league-wide breaks — byes are per-team, handled by useTeamByes,
  // not by double weeks.
  if (sport === 'nfl') return [];
  return (sport === 'wnba' ? WNBA_MERGE_WINDOWS : NBA_MERGE_WINDOWS)[season] ?? [];
}

// Hardcoded month/day per sport when next-season league creation becomes
// available. Picked to land AFTER that sport's rookie draft, so the new rookie
// class is already in the player pool (otherwise a dynasty league drafts last
// year's rookies): NBA post-late-June draft (Jul 1, pre-Summer League), WNBA
// post-mid-April draft (Apr 20, a few weeks before the mid-May tipoff). Adjust
// as the calendar shifts; per-year overrides live in season_config.creation_opens_at.
const SPORT_NEXT_SEASON_OPENS: Record<Sport, { month: number; day: number } | undefined> = {
  nba: { month: 7, day: 1 },
  wnba: { month: 4, day: 20 },
  nfl: { month: 5, day: 1 }, // post-late-April NFL draft
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


// User IDs allowed to create a league BEFORE a season's normal opening date
// (owner / dev). The opening gate exists so dynasty rookie drafts land after the
// new rookie class syncs; these accounts knowingly bypass it for early setup or
// testing. This is a UX gate only (no server enforcement), so an allowlist here
// is sufficient. IDs are not secret — they already appear in repo seed scripts.
const EARLY_CREATION_USER_IDS = new Set<string>([
  'a3adaf6b-20b5-4059-b860-d49f146c78fd', // jjspoels@gmail.com (owner)
]);

/** Whether `userId` may create a league before a season's opening date. */
export function canBypassCreationWindow(userId: string | null | undefined): boolean {
  return !!userId && EARLY_CREATION_USER_IDS.has(userId);
}

/** Returns whether a league can currently be created for `sport`. If the
 *  current season has < SEASON_MIN_WEEKS_REMAINING weeks left, falls forward
 *  to the next season once today ≥ that sport's hardcoded open date.
 *  `opts.bypassOpenDate` (allowlisted accounts) opens the next season early. */
export function getCreationStatus(
  sport: Sport,
  today: Date = new Date(),
  opts: { bypassOpenDate?: boolean } = {},
): SeasonCreationStatus {
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
      // Opening-night defaults are hardcoded per season — once the season is
      // mid-flight (e.g. creating a WNBA league in June, after May 15 tipoff),
      // the date is in the past. Null it out so the wizard falls back to
      // defaultSeasonStart() (tomorrow, floored to opening night).
      const defaultStart = getSeasonStart(sport, currentSeason) ?? null;
      const isPast = defaultStart
        ? new Date(`${defaultStart}T00:00:00`).getTime() < todayMidnight.getTime()
        : false;
      return {
        sport,
        season: currentSeason,
        defaultStartDate: isPast ? null : defaultStart,
        available: true,
      };
    }
  }

  // Current season's window closed — fall forward to next season. Show it
  // as the tile's "season" label either way (available once opens past, or
  // gated until then).
  const nextSeasonStartYear = parseSeasonStartYear(currentSeason) + 1;
  const nextSeason = formatSeason(nextSeasonStartYear, sport);

  // Prefer a concrete opens date from season_config (set when the schedule is
  // known); otherwise the recurring hardcoded month/day for the current year.
  const nextRow = cachedSeasonRow(sport, nextSeason);
  const opens = SPORT_NEXT_SEASON_OPENS[sport];
  let openDate: Date | null = null;
  if (nextRow?.creation_opens_at) {
    const [oy, om, od] = nextRow.creation_opens_at.split('-').map(Number);
    openDate = new Date(oy, om - 1, od);
  } else if (opens) {
    openDate = new Date(todayMidnight.getFullYear(), opens.month - 1, opens.day);
  }

  if (openDate) {
    if (todayMidnight >= openDate || opts.bypassOpenDate) {
      const defaultStart = getSeasonStart(sport, nextSeason) ?? null;
      const isPast = defaultStart
        ? new Date(`${defaultStart}T00:00:00`).getTime() < todayMidnight.getTime()
        : false;
      return {
        sport,
        season: nextSeason,
        defaultStartDate: isPast ? null : defaultStart,
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

/** The date `season`'s rookie class becomes draftable — once that sport's real
 *  draft has happened (and sync-players has ingested the class). Mirrors the
 *  next-season-creation gate so the offseason rookie draft can't be scheduled
 *  before its rookies exist (else it drafts last year's class): prefers the
 *  season_config `creation_opens_at` override, else the hardcoded post-draft
 *  month/day for the season's start year. Null when the sport has no open date. */
export function getRookieClassAvailableDate(sport: Sport, season: string): Date | null {
  const row = cachedSeasonRow(sport, season);
  if (row?.creation_opens_at) {
    const [y, m, d] = row.creation_opens_at.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  const opens = SPORT_NEXT_SEASON_OPENS[sport];
  if (!opens) return null;
  return new Date(parseSeasonStartYear(season), opens.month - 1, opens.day);
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
// NBA seasons span two years ('2025-26'); WNBA and NFL are single-year
// ('2026') — the registry's seasonFormat is the source of truth.
export function formatSeason(startYear: number, sport: Sport): string {
  if (getSportModule(sport).seasonFormat === 'single-year') return String(startYear);
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}

// Compact, apostrophe-prefixed season label for tight chips/badges.
// WNBA/NFL '2025' → "'25"; NBA '2024-25' → "'24-'25".
export function formatSeasonShort(season: string, sport: Sport): string {
  if (getSportModule(sport).seasonFormat === 'single-year') return `'${season.slice(-2)}`;
  const [start, end] = season.split('-');
  return `'${start.slice(-2)}-'${end}`;
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
// start date has been set. NBA tips off mid-October; the WNBA in mid-May;
// the NFL in early September.
export const SPORT_OPENING_MONTH: Partial<Record<Sport, string>> = {
  nba: 'Oct',
  wnba: 'May',
  nfl: 'Sep',
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
  /** Round after which the pick clock speeds up. null = no acceleration. */
  accelerateAfterRound?: number | null;
  /** Seconds-per-pick once past `accelerateAfterRound` (only used when set). */
  acceleratedTimePerPick?: number;
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
  /** How waiver priority re-seeds each new season (Standard / FAAB-by-priority). */
  waiverPriorityReset: WaiverPriorityResetOption;
  /** How an exact equal-bid FAAB tie is resolved. */
  faabTiebreak: FaabTiebreakOption;
  regularSeasonWeeks: number;
  playoffWeeks: number;
  /** Combine the optional NBA Cup knockout week into a double week (NBA only).
   *  All-Star / FIBA double weeks are unilateral and not gated by this. */
  combineCupWeek?: boolean;
  playoffTeams: number;
  playoffSeedingFormat: PlayoffSeedingOption;
  pickConditionsEnabled: boolean;
  draftPickTradingEnabled: boolean;
  /** 0 = no deadline, 1+ = quick-set "Deadline Week" shortcut (drives the
   *  NumberStepper); the actual persisted value is `tradeDeadlineDate`. */
  tradeDeadlineWeek: number;
  /** ISO date (YYYY-MM-DD) trades lock after, or null for no deadline. This
   *  is what actually gets saved — `tradeDeadlineWeek` only exists so the
   *  wizard can offer a "pick by week" shortcut that derives it. */
  tradeDeadlineDate: string | null;
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
