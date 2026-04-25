import { computeMaxWeeks } from '@/components/create-league/StepSeason';
import {
  CURRENT_NBA_SEASON,
  DEFAULT_CATEGORIES,
  DEFAULT_ROSTER_SLOTS,
  DEFAULT_SCORING,
  type LeagueWizardState,
} from '@/constants/LeagueDefaults';
import type {
  HistoryExtractionResult,
  ImageData,
  ScreenshotPlayerMatch,
  ScreenshotUnmatched,
  SettingsExtractionResult,
} from '@/hooks/useImportScreenshot';

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

export const STEP_LABELS = ['Basics', 'Settings', 'Rosters', 'History', 'Config', 'Review'];

const maxWeeks = computeMaxWeeks(CURRENT_NBA_SEASON);

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
  | { type: 'RESET_CATEGORIES' };

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
  waiverDayOfWeek: 3,
  season: CURRENT_NBA_SEASON,
  seasonStartDate: null,
  regularSeasonWeeks: Math.max(1, maxWeeks - 3),
  playoffWeeks: 3,
  playoffTeams: 6,
  playoffSeedingFormat: 'Standard',
  reseedEachRound: false,
  pickConditionsEnabled: false,
  draftPickTradingEnabled: true,
  tradeDeadlineWeek: 0,
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
};

// ─── Reducer ──────────────────────────────────────────────────────

export function reducer(state: ScreenshotImportState, action: Action): ScreenshotImportState {
  switch (action.type) {
    case 'HYDRATE':
      return action.state;

    case 'SET_WIZARD_FIELD':
      return { ...state, wizardState: { ...state.wizardState, [action.field]: action.value } };

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
      return {
        ...state,
        wizardState: { ...state.wizardState, teams: count },
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
      const scoring = state.wizardState.scoring.map(s => {
        const val = action.scoring[s.stat_name];
        return val !== undefined ? { ...s, point_value: val } : s;
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

export const STORAGE_KEY = '@screenshot_import_wizard';

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
    step,
  };
}

export function deserializeState(p: PersistedState): ScreenshotImportState {
  return {
    wizardState: p.wizardState,
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
  };
}
