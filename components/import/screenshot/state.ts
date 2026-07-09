import {
  CURRENT_NBA_SEASON,
  DEFAULT_CATEGORIES,
  DEFAULT_ROSTER_SLOTS,
  DEFAULT_SCORING,
  getCurrentSeason,
  type LeagueWizardState,
} from '@/constants/LeagueDefaults';
import type {
  HistoryExtractionResult,
  ImageData,
  ScreenshotPlayerMatch,
  ScreenshotUnmatched,
  SettingsExtractionResult,
} from '@/hooks/useImportScreenshot';
import { clampLotteryState, defaultPlayoffSetup, maxPlayoffWeeksForTeams } from '@/utils/league/lottery';
import {
  applyCupWeekToggle,
  computeMaxWeeks,
  deriveTradeDeadlineDate,
  deriveTradeDeadlineWeek,
} from '@/utils/league/seasonWeeks';

import type { DraftPhase, TradedPickDraft } from '../draftPhase';

/**
 * State + reducer + initial values for the Screenshot Import flow.
 *
 * Extracted out of `ScreenshotImport.tsx` so the orchestrator
 * component can stay focused on the step router, chrome, and nav —
 * and so individual step subcomponents (once extracted) can import
 * the types + action creators without pulling in the whole monolith.
 *
 * Design follows the same `dispatch` pattern as create-league /
 * import-league: a single reducer owns every wizard-state mutation,
 * action creators stay simple, step components call them via the
 * handlers the orchestrator wires up.
 */

// League-level config now comes BEFORE the per-team rosters so the league can
// be created from the Rosters step ("finish rosters later"). Team names are set
// up front in the Teams step so traded-pick / lottery / history references
// (all keyed on team name) stay stable across the later steps.
export const STEP_LABELS = ['Basics', 'Teams', 'Settings', 'Waivers', 'Season', 'Trade', 'Draft', 'History', 'Rosters', 'Review'];

const maxWeeks = computeMaxWeeks(CURRENT_NBA_SEASON);
// Teams-first playoff defaults for the initial 10-team template — re-clamped
// by the reducer whenever the team count changes.
const playoffDefaults = defaultPlayoffSetup(10, maxWeeks);

// ─── Types ────────────────────────────────────────────────────────

export interface TeamRosterData {
  team_name: string;
  images: ImageData[];
  matched: ScreenshotPlayerMatch[];
  unmatched: ScreenshotUnmatched[];
  resolvedMappings: Map<number, { player_id: string; name: string; position: string }>;
  skippedPlayers: Set<number>;
  extracted: boolean;
}

export interface HistorySeasonData {
  images: ImageData[];
  extracted: HistoryExtractionResult | null;
}

export interface ScreenshotImportState {
  wizardState: LeagueWizardState;
  teams: TeamRosterData[];
  currentTeamIndex: number;
  settingsImages: ImageData[];
  settingsExtracted: SettingsExtractionResult | null;
  settingsMode: 'choose' | 'screenshot' | 'manual';
  historySeasons: HistorySeasonData[];
  currentHistoryIndex: number;
  draftPhase: DraftPhase;
  lotteryOrder: string[];
  /** Explicit round-2 order (empty = use the reverse-standings/round-1 default). */
  lotteryOrderR2: string[];
  tradedPicks: TradedPickDraft[];
}

export type Action =
  | { type: 'HYDRATE'; state: ScreenshotImportState }
  | { type: 'SET_WIZARD_FIELD'; field: keyof LeagueWizardState; value: any }
  | { type: 'SET_SCORING'; index: number; value: number }
  | { type: 'SET_ROSTER_SLOT'; index: number; count: number }
  | { type: 'SET_TEAM_COUNT'; count: number }
  | { type: 'SET_TEAM_NAME'; teamIndex: number; name: string }
  | { type: 'SET_TEAM_IMAGES'; teamIndex: number; images: ImageData[] }
  | { type: 'SET_TEAM_EXTRACTION'; teamIndex: number; matched: ScreenshotPlayerMatch[]; unmatched: ScreenshotUnmatched[] }
  | { type: 'RESOLVE_PLAYER'; teamIndex: number; playerIndex: number; playerId: string; name: string; position: string }
  | { type: 'SKIP_PLAYER'; teamIndex: number; playerIndex: number }
  | { type: 'SET_CURRENT_TEAM'; index: number }
  | { type: 'SET_SETTINGS_IMAGES'; images: ImageData[] }
  | { type: 'SET_SETTINGS_EXTRACTED'; data: SettingsExtractionResult }
  | { type: 'SET_SETTINGS_MODE'; mode: 'choose' | 'screenshot' | 'manual' }
  | { type: 'APPLY_EXTRACTED_SCORING'; scoring: Record<string, number> }
  | { type: 'APPLY_EXTRACTED_ROSTER_POSITIONS'; positions: { position: string; count: number }[] }
  | { type: 'SET_HISTORY_SEASON_COUNT'; count: number }
  | { type: 'SET_HISTORY_IMAGES'; seasonIndex: number; images: ImageData[] }
  | { type: 'SET_HISTORY_EXTRACTED'; seasonIndex: number; data: HistoryExtractionResult }
  | { type: 'SET_CURRENT_HISTORY'; index: number }
  | { type: 'RESET_SCORING' }
  | { type: 'RESET_ROSTER' }
  | { type: 'RESET_CATEGORIES' }
  | { type: 'SET_DRAFT_PHASE'; value: DraftPhase }
  | { type: 'SET_LOTTERY_ORDER'; value: string[] }
  | { type: 'SET_LOTTERY_ORDER_R2'; value: string[] }
  | { type: 'SET_TRADED_PICKS'; value: TradedPickDraft[] };

// ─── Helpers ──────────────────────────────────────────────────────

export function createInitialTeams(count: number): TeamRosterData[] {
  return Array.from({ length: count }, (_, i) => ({
    team_name: `Team ${i + 1}`,
    images: [],
    matched: [],
    unmatched: [],
    resolvedMappings: new Map(),
    skippedPlayers: new Set(),
    extracted: false,
  }));
}

export const initialWizard: LeagueWizardState = {
  sport: 'nba',
  leagueType: 'Dynasty',
  keeperCount: 5,
  name: '',
  teams: 10,
  isPrivate: true,
  rosterSlots: DEFAULT_ROSTER_SLOTS.map(s => ({ ...s })),
  scoringType: 'Points',
  scoring: DEFAULT_SCORING.map(s => ({ ...s })),
  categories: DEFAULT_CATEGORIES.map(c => ({ ...c })),
  draftType: 'Snake',
  initialDraftOrder: 'Random',
  timePerPick: 90,
  maxDraftYears: 3,
  tradeVetoType: 'Commissioner',
  tradeReviewPeriodHours: 24,
  tradeVotesToVeto: 4,
  rookieDraftRounds: 2,
  rookieDraftOrder: 'Reverse Record',
  lotteryDraws: 4,
  lotteryOdds: null,
  waiverType: 'Standard',
  waiverPeriodDays: 2,
  faabBudget: 100,
  waiverPriorityReset: 'Reverse Standings',
  faabTiebreak: 'Earliest Bid',
  season: getCurrentSeason('nba'),
  seasonStartDate: null,
  regularSeasonWeeks: Math.max(1, maxWeeks - playoffDefaults.playoffWeeks),
  playoffWeeks: playoffDefaults.playoffWeeks,
  playoffTeams: playoffDefaults.playoffTeams,
  playoffSeedingFormat: 'Standard',
  combineCupWeek: false,
  pickConditionsEnabled: false,
  draftPickTradingEnabled: true,
  tradeDeadlineWeek: 0,
  tradeDeadlineDate: null,
  buyIn: 0,
  venmoUsername: '',
  cashappTag: '',
  paypalUsername: '',
  taxiMaxExperience: null,
  weeklyAcquisitionLimit: null,
  playerLockType: 'Daily',
  autoRumorsEnabled: false,
  tiebreakerPrimary: 'Head-to-Head',
  divisionCount: 1,
  division1Name: 'Division 1',
  division2Name: 'Division 2',
  positionLimits: {},
};

export const initialState: ScreenshotImportState = {
  wizardState: initialWizard,
  teams: createInitialTeams(10),
  currentTeamIndex: 0,
  settingsImages: [],
  settingsExtracted: null,
  settingsMode: 'choose',
  historySeasons: [],
  currentHistoryIndex: 0,
  draftPhase: 'in_season',
  lotteryOrder: [],
  lotteryOrderR2: [],
  tradedPicks: [],
};

// ─── Reducer ──────────────────────────────────────────────────────

export function reducer(state: ScreenshotImportState, action: Action): ScreenshotImportState {
  switch (action.type) {
    case 'HYDRATE':
      return action.state;

    case 'SET_WIZARD_FIELD': {
      const next = { ...state.wizardState, [action.field]: action.value };
      // Keep the playoff structure valid: weeks are capped at what the team
      // count can bracket (2 teams = a 1-week final) and playoffTeams snaps to
      // a valid option for the chosen weeks. Mirrors create-league's reducer —
      // without this a small league keeps the 10-team template's 6-team /
      // 3-week playoff, which the engine can never fill.
      if (action.field === 'playoffWeeks' || action.field === 'playoffTeams') {
        const playoffWeeks = Math.min(next.playoffWeeks, maxPlayoffWeeksForTeams(next.teams));
        return { ...state, wizardState: clampLotteryState({ ...next, playoffWeeks }) };
      }
      // Cup double week consumes/frees one calendar week — re-fit week counts.
      // applyCupWeekToggle clamps tradeDeadlineWeek; re-derive the date too so
      // the persisted deadline moves with the shifted calendar.
      if (action.field === 'combineCupWeek') {
        const toggled = applyCupWeekToggle(next, state.wizardState);
        return { ...state, wizardState: { ...toggled, tradeDeadlineDate: deriveTradeDeadlineDate(toggled) } };
      }
      // When sport changes, snap the season string to that sport's default and
      // recompute week boundaries from the new season's start date. Mirrors
      // the create-league reducer.
      if (action.field === 'sport') {
        const newSport = action.value as 'nba' | 'wnba';
        const newSeason = getCurrentSeason(newSport);
        const newMax = computeMaxWeeks(newSeason, newSport, undefined, next.combineCupWeek ?? false);
        const playoffWeeks = Math.min(
          next.playoffWeeks,
          maxPlayoffWeeksForTeams(next.teams),
          Math.max(1, newMax - 1),
        );
        const regularSeasonWeeks = Math.min(next.regularSeasonWeeks, Math.max(1, newMax - playoffWeeks));
        const tradeDeadlineWeek = next.tradeDeadlineWeek > 0
          ? Math.min(next.tradeDeadlineWeek, regularSeasonWeeks)
          : 0;
        const merged = clampLotteryState({ ...next, season: newSeason, seasonStartDate: null, regularSeasonWeeks, playoffWeeks, tradeDeadlineWeek });
        return {
          ...state,
          wizardState: { ...merged, tradeDeadlineDate: deriveTradeDeadlineDate(merged) },
        };
      }
      // Phases + future picks are dynasty-only — clear them if the league
      // leaves Dynasty so a stale phase can't leak into the payload.
      if (action.field === 'leagueType' && action.value !== 'Dynasty') {
        return { ...state, wizardState: next, draftPhase: 'in_season', lotteryOrder: [], lotteryOrderR2: [], tradedPicks: [] };
      }
      // Trade deadline week is bounded by the (possibly shortened) regular
      // season; re-derive the persisted date so it can't outlive it.
      if (action.field === 'regularSeasonWeeks' && next.tradeDeadlineWeek > 0) {
        const tradeDeadlineWeek = Math.min(next.tradeDeadlineWeek, next.regularSeasonWeeks);
        return {
          ...state,
          wizardState: {
            ...next,
            tradeDeadlineWeek,
            tradeDeadlineDate: deriveTradeDeadlineDate({ ...next, tradeDeadlineWeek }),
          },
        };
      }
      // Deadline WEEK moved (or the on/off toggle set it to 0/a default) —
      // re-derive the persisted date. Deadline DATE fine-tuned — snap the week
      // stepper to the week containing it. The two controls stay in lockstep.
      if (action.field === 'tradeDeadlineWeek') {
        return { ...state, wizardState: { ...next, tradeDeadlineDate: deriveTradeDeadlineDate(next) } };
      }
      if (action.field === 'tradeDeadlineDate') {
        return { ...state, wizardState: { ...next, tradeDeadlineWeek: deriveTradeDeadlineWeek(next) } };
      }
      return { ...state, wizardState: next };
    }

    case 'SET_SCORING': {
      const scoring = [...state.wizardState.scoring];
      scoring[action.index] = { ...scoring[action.index], point_value: action.value };
      return { ...state, wizardState: { ...state.wizardState, scoring } };
    }

    case 'SET_ROSTER_SLOT': {
      const slots = [...state.wizardState.rosterSlots];
      slots[action.index] = { ...slots[action.index], count: action.count };
      return { ...state, wizardState: { ...state.wizardState, rosterSlots: slots } };
    }

    case 'SET_TEAM_COUNT': {
      const count = Math.max(2, Math.min(16, action.count));
      const teams = createInitialTeams(count);
      // Preserve any existing team data
      for (let i = 0; i < Math.min(state.teams.length, count); i++) {
        teams[i] = state.teams[i];
      }
      // Re-clamp the playoff structure to the new team count — a 2-team
      // league can't keep the 10-team template's 6-team / 3-week playoff.
      const wizardState = clampLotteryState({
        ...state.wizardState,
        teams: count,
        playoffWeeks: Math.min(state.wizardState.playoffWeeks, maxPlayoffWeeksForTeams(count)),
      });
      return {
        ...state,
        wizardState,
        teams,
        currentTeamIndex: Math.min(state.currentTeamIndex, count - 1),
      };
    }

    case 'SET_TEAM_NAME': {
      const teams = [...state.teams];
      teams[action.teamIndex] = { ...teams[action.teamIndex], team_name: action.name };
      return { ...state, teams };
    }

    case 'SET_TEAM_IMAGES': {
      const teams = [...state.teams];
      teams[action.teamIndex] = { ...teams[action.teamIndex], images: action.images, extracted: false };
      return { ...state, teams };
    }

    case 'SET_TEAM_EXTRACTION': {
      const teams = [...state.teams];
      teams[action.teamIndex] = {
        ...teams[action.teamIndex],
        matched: action.matched,
        unmatched: action.unmatched,
        extracted: true,
        resolvedMappings: new Map(),
        skippedPlayers: new Set(),
      };
      return { ...state, teams };
    }

    case 'RESOLVE_PLAYER': {
      const teams = [...state.teams];
      const team = { ...teams[action.teamIndex] };
      const newMap = new Map(team.resolvedMappings);
      newMap.set(action.playerIndex, { player_id: action.playerId, name: action.name, position: action.position });
      team.resolvedMappings = newMap;
      teams[action.teamIndex] = team;
      return { ...state, teams };
    }

    case 'SKIP_PLAYER': {
      const teams = [...state.teams];
      const team = { ...teams[action.teamIndex] };
      const newSet = new Set(team.skippedPlayers);
      newSet.add(action.playerIndex);
      team.skippedPlayers = newSet;
      teams[action.teamIndex] = team;
      return { ...state, teams };
    }

    case 'SET_CURRENT_TEAM':
      return { ...state, currentTeamIndex: action.index };

    case 'SET_SETTINGS_IMAGES':
      return { ...state, settingsImages: action.images };

    case 'SET_SETTINGS_EXTRACTED':
      return { ...state, settingsExtracted: action.data };

    case 'SET_SETTINGS_MODE':
      return { ...state, settingsMode: action.mode };

    case 'APPLY_EXTRACTED_SCORING': {
      // The screenshot is authoritative: a stat the OCR didn't read isn't scored
      // by the source league, so it must be 0 — not left at the app's default.
      // Otherwise the app silently injects its own house rules (e.g. the old
      // PF -1) into an imported league. Stats present in the extraction take
      // their read value. The user can still correct any OCR miss in StepScoring.
      const scoring = state.wizardState.scoring.map(s => {
        const val = action.scoring[s.stat_name];
        return { ...s, point_value: val !== undefined ? val : 0 };
      });
      return { ...state, wizardState: { ...state.wizardState, scoring } };
    }

    case 'APPLY_EXTRACTED_ROSTER_POSITIONS': {
      const rosterSlots = state.wizardState.rosterSlots.map(s => {
        const match = action.positions.find(p => p.position.toUpperCase() === s.position);
        return match ? { ...s, count: match.count } : s;
      });
      return { ...state, wizardState: { ...state.wizardState, rosterSlots } };
    }

    case 'SET_HISTORY_SEASON_COUNT': {
      const count = Math.max(0, Math.min(10, action.count));
      const seasons: HistorySeasonData[] = Array.from({ length: count }, (_, i) =>
        state.historySeasons[i] ?? { images: [], extracted: null },
      );
      return {
        ...state,
        historySeasons: seasons,
        currentHistoryIndex: Math.min(state.currentHistoryIndex, Math.max(0, count - 1)),
      };
    }

    case 'SET_HISTORY_IMAGES': {
      const seasons = [...state.historySeasons];
      seasons[action.seasonIndex] = { ...seasons[action.seasonIndex], images: action.images };
      return { ...state, historySeasons: seasons };
    }

    case 'SET_HISTORY_EXTRACTED': {
      const seasons = [...state.historySeasons];
      seasons[action.seasonIndex] = { ...seasons[action.seasonIndex], extracted: action.data };
      return { ...state, historySeasons: seasons };
    }

    case 'SET_CURRENT_HISTORY':
      return { ...state, currentHistoryIndex: action.index };

    case 'RESET_SCORING':
      return { ...state, wizardState: { ...state.wizardState, scoring: DEFAULT_SCORING.map(s => ({ ...s })) } };

    case 'RESET_ROSTER':
      return { ...state, wizardState: { ...state.wizardState, rosterSlots: DEFAULT_ROSTER_SLOTS.map(s => ({ ...s })) } };

    case 'RESET_CATEGORIES':
      return { ...state, wizardState: { ...state.wizardState, categories: DEFAULT_CATEGORIES.map(c => ({ ...c })) } };

    case 'SET_DRAFT_PHASE': {
      // Switching to "Order Set" seeds a full default order (teams' order) so
      // the payload always carries a complete order even without reordering.
      const needsOrder =
        action.value === 'lottery_done' && state.lotteryOrder.length !== state.teams.length;
      const lotteryOrder = needsOrder ? state.teams.map(t => t.team_name) : state.lotteryOrder;
      const lotteryOrderR2 = needsOrder ? [] : state.lotteryOrderR2;
      return { ...state, draftPhase: action.value, lotteryOrder, lotteryOrderR2 };
    }

    case 'SET_LOTTERY_ORDER':
      return { ...state, lotteryOrder: action.value };
    case 'SET_LOTTERY_ORDER_R2':
      return { ...state, lotteryOrderR2: action.value };

    case 'SET_TRADED_PICKS':
      return { ...state, tradedPicks: action.value };

    default:
      return state;
  }
}

// ─── Persistence ──────────────────────────────────────────────────
//
// Screenshot import can take a long time (per-team capture + extract,
// optional history seasons). Users have asked to be able to leave and
// resume — same affordance create-league offers via AsyncStorage.
//
// Two complications screenshot has that create-league doesn't:
//   1. Maps and Sets aren't JSON-serializable. We convert
//      `resolvedMappings` (Map) and `skippedPlayers` (Set) to plain
//      arrays on save and rebuild them on load.
//   2. Image base64 payloads are huge (often hundreds of KB each).
//      Persisting them would blow past AsyncStorage's practical
//      ceiling. We strip all `images` fields on save — once a team's
//      roster is `extracted`, the `matched` + `unmatched` arrays are
//      enough to keep working without re-uploading. Users who left
//      mid-capture (no extraction yet) will need to re-upload.

// v2/v3: bumped whenever the step order changes (a persisted `step` index points
// at a different step under the new layout), so stale drafts are discarded
// cleanly. v3 split the single "Config" step into Waivers/Season/Trade/Draft.
export const STORAGE_KEY = '@screenshot_import_wizard_v3';

interface PersistedTeam {
  team_name: string;
  matched: TeamRosterData['matched'];
  unmatched: TeamRosterData['unmatched'];
  resolvedMappings: [number, { player_id: string; name: string; position: string }][];
  skippedPlayers: number[];
  extracted: boolean;
}

interface PersistedHistorySeason {
  extracted: HistoryExtractionResult | null;
}

export interface PersistedState {
  wizardState: LeagueWizardState;
  teams: PersistedTeam[];
  currentTeamIndex: number;
  settingsExtracted: SettingsExtractionResult | null;
  settingsMode: 'choose' | 'screenshot' | 'manual';
  historySeasons: PersistedHistorySeason[];
  currentHistoryIndex: number;
  draftPhase: DraftPhase;
  lotteryOrder: string[];
  lotteryOrderR2: string[];
  tradedPicks: TradedPickDraft[];
  step: number;
}

export function serializeState(s: ScreenshotImportState, step: number): PersistedState {
  return {
    wizardState: s.wizardState,
    teams: s.teams.map((t) => ({
      team_name: t.team_name,
      matched: t.matched,
      unmatched: t.unmatched,
      resolvedMappings: Array.from(t.resolvedMappings.entries()),
      skippedPlayers: Array.from(t.skippedPlayers),
      extracted: t.extracted,
    })),
    currentTeamIndex: s.currentTeamIndex,
    settingsExtracted: s.settingsExtracted,
    settingsMode: s.settingsMode,
    historySeasons: s.historySeasons.map((h) => ({ extracted: h.extracted })),
    currentHistoryIndex: s.currentHistoryIndex,
    draftPhase: s.draftPhase,
    lotteryOrder: s.lotteryOrder,
    lotteryOrderR2: s.lotteryOrderR2,
    tradedPicks: s.tradedPicks,
    step,
  };
}

export function deserializeState(p: PersistedState): ScreenshotImportState {
  return {
    // Drafts persisted before the playoff clamps existed can carry a bracket
    // the team count can't fill (e.g. 6 playoff teams in a 2-team league) —
    // heal them on restore, same rules as the reducer.
    wizardState: clampLotteryState({
      ...p.wizardState,
      playoffWeeks: Math.min(
        p.wizardState.playoffWeeks,
        maxPlayoffWeeksForTeams(p.wizardState.teams),
      ),
    }),
    teams: p.teams.map((t) => ({
      team_name: t.team_name,
      images: [],
      matched: t.matched ?? [],
      unmatched: t.unmatched ?? [],
      resolvedMappings: new Map(t.resolvedMappings ?? []),
      skippedPlayers: new Set(t.skippedPlayers ?? []),
      extracted: !!t.extracted,
    })),
    currentTeamIndex: p.currentTeamIndex ?? 0,
    settingsImages: [],
    settingsExtracted: p.settingsExtracted ?? null,
    settingsMode: p.settingsMode ?? 'choose',
    historySeasons: (p.historySeasons ?? []).map((h) => ({
      images: [],
      extracted: h.extracted ?? null,
    })),
    currentHistoryIndex: p.currentHistoryIndex ?? 0,
    draftPhase: p.draftPhase ?? 'in_season',
    lotteryOrder: p.lotteryOrder ?? [],
    lotteryOrderR2: p.lotteryOrderR2 ?? [],
    tradedPicks: p.tradedPicks ?? [],
  };
}
