/**
 * Per-sport rules registry — the single source of truth for what makes each
 * sport different: positions, default roster slots, scoring defaults/presets,
 * stat-name → DB-column maps, season-string format, and fantasy-week shape.
 *
 * Zero dependencies on purpose (same pattern as rosterSlotsShared.ts /
 * scheduleWindows.ts): this file must stay importable from both Metro
 * (client, via `@/utils/sports/registry`) and Deno edge functions (via
 * `../../../utils/sports/registry.ts`), so no `@/` aliases and no
 * internal imports.
 *
 * Incremental adoption: NBA/WNBA entries are transcriptions of the previously
 * hardcoded constants. `utils/scoring/fantasyPoints.ts` and
 * `constants/LeagueDefaults.ts` re-export from here so existing import paths
 * keep working — do not redefine these maps elsewhere.
 */

export type RegistrySport = 'nba' | 'wnba' | 'nfl';

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

/** Display config for box-score style stat rows (player detail / game logs). */
export interface BoxScoreRow {
  /** player_games column name */
  key: string;
  label: string;
}

export interface SportModule {
  sport: RegistrySport;
  /**
   * Whether a taxi squad can be offered. Taxi eligibility is "years of pro
   * experience", derived from `players.draft_year`. True for every sport today:
   * basketball reads the column straight off BDL, and NFL — whose feed carries
   * no draft year — derives it from BDL's `experience` string in sync-players
   * (see utils/sports/nflExperience.ts). Keep the flag: a future sport whose
   * feed has neither must set it false rather than offer a squad no player can
   * be sent to.
   */
  supportsTaxi: boolean;
  /** 'cross-year' → "2025-26" (NBA); 'single-year' → "2026" (WNBA/NFL). */
  seasonFormat: 'single-year' | 'cross-year';
  /**
   * Day-of-week fantasy weeks END on (0=Sunday, 1=Monday). NBA/WNBA weeks are
   * Mon–Sun. NFL weeks are Tue–Mon: a Sunday end would strand Monday Night
   * Football in the following fantasy week.
   */
  weekEndDow: 0 | 1;
  /** Position tokens used for filter chips and per-position roster limits. */
  positions: readonly string[];
  defaultRosterSlots: readonly RosterSlot[];
  /** H2H-categories scoring is basketball-only; NFL leagues are points-only. */
  supportsCategories: boolean;
  defaultScoring: readonly ScoringCategory[];
  /** Named scoring presets (NFL: standard / half_ppr / full_ppr). */
  scoringPresets?: Record<string, readonly ScoringCategory[]>;
  /** league_scoring_settings stat_name → player_games column */
  statToGame: Record<string, string>;
  /** league_scoring_settings stat_name → player_season_stats total_* column */
  statToTotal: Record<string, string>;
  /** league_scoring_settings stat_name → player_projections proj_* column */
  statToProj: Record<string, string>;
  boxScoreRows: readonly BoxScoreRow[];
}

// ── Basketball (shared by NBA + WNBA — identical stat schema) ────────────────

const BASKETBALL_STAT_TO_TOTAL: Record<string, string> = {
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

const BASKETBALL_STAT_TO_GAME: Record<string, string> = {
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

// DD/TD/PF intentionally absent — the projections model doesn't project them,
// so they contribute 0 (same limitation as seasonAvgRowToFpts).
const BASKETBALL_STAT_TO_PROJ: Record<string, string> = {
  PTS: 'proj_pts',
  REB: 'proj_reb',
  AST: 'proj_ast',
  STL: 'proj_stl',
  BLK: 'proj_blk',
  TO: 'proj_tov',
  '3PM': 'proj_3pm',
  '3PA': 'proj_3pa',
  FGM: 'proj_fgm',
  FGA: 'proj_fga',
  FTM: 'proj_ftm',
  FTA: 'proj_fta',
};

const BASKETBALL_DEFAULT_SCORING: ScoringCategory[] = [
  { stat_name: 'PTS', label: 'Points', point_value: 1 },
  { stat_name: 'REB', label: 'Rebounds', point_value: 1.2 },
  { stat_name: 'AST', label: 'Assists', point_value: 1.5 },
  { stat_name: 'STL', label: 'Steals', point_value: 3 },
  { stat_name: 'BLK', label: 'Blocks', point_value: 3 },
  { stat_name: 'TO', label: 'Turnovers', point_value: -1 },
  { stat_name: '3PM', label: '3-Pointers Made', point_value: 1 },
  { stat_name: '3PA', label: '3-Pointers Attempted', point_value: -0.5 },
  { stat_name: 'FGM', label: 'Field Goals Made', point_value: 2 },
  { stat_name: 'FGA', label: 'Field Goals Attempted', point_value: -1 },
  { stat_name: 'FTM', label: 'Free Throws Made', point_value: 1 },
  { stat_name: 'FTA', label: 'Free Throws Attempted', point_value: -1 },
  // Personal fouls default to 0 (unscored) — the near-universal norm on
  // ESPN/Yahoo/Sleeper. A -1 default silently penalized fouls in leagues that
  // never scored them, most visibly on screenshot imports where an unread PF
  // stat kept this default. Leagues that DO penalize fouls set it in the editor.
  { stat_name: 'PF', label: 'Personal Fouls', point_value: 0 },
  { stat_name: 'DD', label: 'Double Doubles', point_value: 0 },
  { stat_name: 'TD', label: 'Triple Doubles', point_value: 0 },
];

const BASKETBALL_BOX_SCORE_ROWS: BoxScoreRow[] = [
  { key: 'pts', label: 'PTS' },
  { key: 'reb', label: 'REB' },
  { key: 'ast', label: 'AST' },
  { key: 'stl', label: 'STL' },
  { key: 'blk', label: 'BLK' },
  { key: 'tov', label: 'TO' },
  { key: 'min', label: 'MIN' },
];

const NBA_MODULE: SportModule = {
  sport: 'nba',
  seasonFormat: 'cross-year',
  weekEndDow: 0,
  positions: ['PG', 'SG', 'SF', 'PF', 'C'],
  defaultRosterSlots: [
    { position: 'PG', label: 'Point Guard', count: 1 },
    { position: 'SG', label: 'Shooting Guard', count: 1 },
    { position: 'SF', label: 'Small Forward', count: 1 },
    { position: 'PF', label: 'Power Forward', count: 1 },
    { position: 'C', label: 'Center', count: 1 },
    { position: 'G', label: 'Guard', count: 1 },
    { position: 'F', label: 'Forward', count: 1 },
    { position: 'UTIL', label: 'Utility', count: 3 },
    { position: 'BE', label: 'Bench', count: 3 },
    { position: 'IR', label: 'Injured Reserve', count: 1 },
    { position: 'TAXI', label: 'Taxi Squad', count: 0 },
  ],
  supportsCategories: true,
  supportsTaxi: true,
  defaultScoring: BASKETBALL_DEFAULT_SCORING,
  statToGame: BASKETBALL_STAT_TO_GAME,
  statToTotal: BASKETBALL_STAT_TO_TOTAL,
  statToProj: BASKETBALL_STAT_TO_PROJ,
  boxScoreRows: BASKETBALL_BOX_SCORE_ROWS,
};

const WNBA_MODULE: SportModule = {
  sport: 'wnba',
  seasonFormat: 'single-year',
  weekEndDow: 0,
  // WNBA reports bare-letter positions (G/F/C); PG/SG/SF/PF don't exist as
  // roster concepts in WNBA leagues.
  positions: ['G', 'F', 'C'],
  defaultRosterSlots: [
    { position: 'G', label: 'Guard', count: 2 },
    { position: 'F', label: 'Forward', count: 2 },
    { position: 'C', label: 'Center', count: 1 },
    { position: 'UTIL', label: 'Utility', count: 2 },
    { position: 'BE', label: 'Bench', count: 3 },
    { position: 'IR', label: 'Injured Reserve', count: 1 },
    { position: 'TAXI', label: 'Taxi Squad', count: 0 },
  ],
  supportsCategories: true,
  supportsTaxi: true,
  defaultScoring: BASKETBALL_DEFAULT_SCORING,
  statToGame: BASKETBALL_STAT_TO_GAME,
  statToTotal: BASKETBALL_STAT_TO_TOTAL,
  statToProj: BASKETBALL_STAT_TO_PROJ,
  boxScoreRows: BASKETBALL_BOX_SCORE_ROWS,
};

// ── NFL ──────────────────────────────────────────────────────────────────────

/**
 * NFL scoring, parameterized by points-per-reception (0 standard, 0.5 half,
 * 1 full). D/ST points-allowed is tiered, which doesn't fit flat stat×weight —
 * poll-live-stats computes the tier result into the derived `dst_pa_pts`
 * column at ingest, and DST_PA's point_value is a scale factor on it
 * (1 = standard tiers, 0 = disabled).
 *
 * Kicker limitation (v1): BDL's per-game stats have no FG distance splits at
 * the ALL-STAR tier, so FG scoring is flat. `fg_long` is stored for a future
 * long-FG bonus stat.
 *
 * Not in the presets (BDL ALL-STAR provides no stat for them, verified
 * 2026-07-10): two-point conversions and D/ST safeties. The `two_pt` /
 * `dst_safety` columns exist for a future upgrade; a preset entry today
 * would just be a weight on a permanently-zero stat.
 */
function nflScoring(recPts: number): ScoringCategory[] {
  return [
    { stat_name: 'PASS_YD', label: 'Passing Yards', point_value: 0.04 },
    { stat_name: 'PASS_TD', label: 'Passing TDs', point_value: 4 },
    { stat_name: 'PASS_INT', label: 'Interceptions Thrown', point_value: -2 },
    { stat_name: 'RUSH_YD', label: 'Rushing Yards', point_value: 0.1 },
    { stat_name: 'RUSH_TD', label: 'Rushing TDs', point_value: 6 },
    { stat_name: 'REC', label: 'Receptions', point_value: recPts },
    { stat_name: 'REC_YD', label: 'Receiving Yards', point_value: 0.1 },
    { stat_name: 'REC_TD', label: 'Receiving TDs', point_value: 6 },
    { stat_name: 'FUM_LOST', label: 'Fumbles Lost', point_value: -2 },
    { stat_name: 'RET_TD', label: 'Return TDs', point_value: 6 },
    { stat_name: 'FG', label: 'Field Goals Made', point_value: 3 },
    { stat_name: 'XP', label: 'Extra Points Made', point_value: 1 },
    { stat_name: 'DST_SACK', label: 'Sacks (D/ST)', point_value: 1 },
    { stat_name: 'DST_INT', label: 'Interceptions (D/ST)', point_value: 2 },
    { stat_name: 'DST_FUM_REC', label: 'Fumble Recoveries (D/ST)', point_value: 2 },
    { stat_name: 'DST_TD', label: 'D/ST Touchdowns', point_value: 6 },
    // The stat is the TIER RESULT (dst_pa_pts: shutout +10 … 35+ allowed −4,
    // see DST_PA_TIERS in utils/scoring/nflStatLine.ts), so the weight is a
    // ×1 scale factor — NOT points-per-point-allowed, and not negative.
    { stat_name: 'DST_PA', label: 'Points Allowed Tier (D/ST)', point_value: 1 },
  ];
}

export const NFL_SCORING_PRESETS: Record<string, readonly ScoringCategory[]> = {
  standard: nflScoring(0),
  half_ppr: nflScoring(0.5),
  full_ppr: nflScoring(1),
};

const NFL_STAT_TO_GAME: Record<string, string> = {
  PASS_YD: 'pass_yd',
  PASS_TD: 'pass_td',
  PASS_INT: 'pass_int',
  RUSH_YD: 'rush_yd',
  RUSH_TD: 'rush_td',
  REC: 'rec',
  REC_YD: 'rec_yd',
  REC_TD: 'rec_td',
  FUM_LOST: 'fum_lost',
  TWO_PT: 'two_pt',
  RET_TD: 'ret_td',
  FG: 'fg_made',
  XP: 'xp_made',
  DST_SACK: 'dst_sacks',
  DST_INT: 'dst_int',
  DST_FUM_REC: 'dst_fum_rec',
  DST_TD: 'dst_td',
  DST_SAFETY: 'dst_safety',
  DST_PA: 'dst_pa_pts',
};

const NFL_STAT_TO_TOTAL: Record<string, string> = Object.fromEntries(
  Object.entries(NFL_STAT_TO_GAME).map(([stat, col]) => [stat, `total_${col}`]),
);

const NFL_MODULE: SportModule = {
  sport: 'nfl',
  seasonFormat: 'single-year',
  weekEndDow: 1,
  positions: ['QB', 'RB', 'WR', 'TE', 'K', 'DST'],
  defaultRosterSlots: [
    { position: 'QB', label: 'Quarterback', count: 1 },
    { position: 'RB', label: 'Running Back', count: 2 },
    { position: 'WR', label: 'Wide Receiver', count: 2 },
    { position: 'TE', label: 'Tight End', count: 1 },
    { position: 'FLEX', label: 'Flex (RB/WR/TE)', count: 1 },
    // Superflex is the opt-in second-QB seat — 0 by default, the wizard's
    // stepper turns it on (count-0 slots aren't written to league_roster_config).
    { position: 'SFLX', label: 'Superflex (QB/RB/WR/TE)', count: 0 },
    { position: 'K', label: 'Kicker', count: 1 },
    { position: 'DST', label: 'Defense/Special Teams', count: 1 },
    { position: 'BE', label: 'Bench', count: 6 },
    { position: 'IR', label: 'Injured Reserve', count: 1 },
    { position: 'TAXI', label: 'Taxi Squad', count: 0 },
  ],
  supportsCategories: false,
  supportsTaxi: true,
  defaultScoring: NFL_SCORING_PRESETS.half_ppr,
  scoringPresets: NFL_SCORING_PRESETS,
  statToGame: NFL_STAT_TO_GAME,
  statToTotal: NFL_STAT_TO_TOTAL,
  // No NFL projections in v1 — the projections engine is basketball-only.
  statToProj: {},
  // Skill-position default rows; K/DST get position-specific treatment when
  // the display surfaces are wired (Phase 3).
  boxScoreRows: [
    { key: 'pass_yd', label: 'Pass Yds' },
    { key: 'pass_td', label: 'Pass TD' },
    { key: 'pass_int', label: 'INT' },
    { key: 'rush_yd', label: 'Rush Yds' },
    { key: 'rush_td', label: 'Rush TD' },
    { key: 'rec', label: 'Rec' },
    { key: 'rec_yd', label: 'Rec Yds' },
    { key: 'rec_td', label: 'Rec TD' },
    { key: 'fum_lost', label: 'Fum Lost' },
  ],
};

// ── Lookup ───────────────────────────────────────────────────────────────────

const MODULES: Record<RegistrySport, SportModule> = {
  nba: NBA_MODULE,
  wnba: WNBA_MODULE,
  nfl: NFL_MODULE,
};

/**
 * Returns the sport module, falling back to NBA for unknown/absent sports —
 * the same "default nba" convention the rest of the app uses.
 */
export function getSportModule(sport: string | null | undefined): SportModule {
  return MODULES[(sport ?? 'nba') as RegistrySport] ?? MODULES.nba;
}

/**
 * Stepper increment for a scoring row, derived from that stat's DEFAULT weight.
 *
 * Basketball weights are whole/half points (PTS 1, REB 1.2, STL 3), so 0.5 is
 * the right nudge. NFL yardage is fractional by nature — passing yards are
 * 0.04/yd and rushing/receiving 0.1/yd — and a 0.5 step can't express them at
 * all: one tap on PASS_YD would take 0.04 → 0.54, a 13× scoring change. Stats
 * whose default is a fraction below a half-point step by 0.01 instead.
 */
export function scoringStep(defaultPointValue: number): number {
  const v = Math.abs(defaultPointValue);
  return v > 0 && v < 0.5 ? 0.01 : 0.5;
}
