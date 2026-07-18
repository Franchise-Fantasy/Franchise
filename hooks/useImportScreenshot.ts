import { useMutation } from '@tanstack/react-query';

import { type Sport } from '@/constants/LeagueDefaults';
import { supabase } from '@/lib/supabase';
import { logger } from '@/utils/logger';

// --- Types ---

export interface ExtractedPlayer {
  player_name: string;
  position: string | null;
  roster_slot: string | null;
}

export interface ScreenshotPlayerMatch {
  index: number;
  extracted_name: string;
  position: string | null;
  roster_slot: string | null;
  matched_player_id: string;
  matched_name: string;
  matched_team: string;
  matched_position: string;
  confidence: 'high' | 'medium';
}

export interface ScreenshotUnmatched {
  index: number;
  extracted_name: string;
  position: string | null;
  roster_slot: string | null;
  confidence: 'low' | 'none';
}

export interface RosterExtractionResult {
  extracted_count: number;
  matched: ScreenshotPlayerMatch[];
  unmatched: ScreenshotUnmatched[];
}

export interface SettingsExtractionResult {
  league_name: string | null;
  team_count: number | null;
  scoring_type: string | null;
  scoring_values: Record<string, number> | null;
  roster_positions: { position: string; count: number }[] | null;
}

export interface HistoryTeam {
  /** The league team this row imports as — rewritten to a current team name during reconciliation. */
  team_name: string;
  wins: number | null;
  losses: number | null;
  ties: number | null;
  points_for: number | null;
  points_against: number | null;
  standing: number | null;
  /** Division label as extracted from the screenshot (e.g. "East Division"), not yet mapped to 1/2. */
  division?: string | null;
  playoff_result?: string | null;
  /** The original extracted/typed name before it was matched to a league team (for display + future era-name snapshot). */
  source_name?: string | null;
}

export interface HistoryBracketMatchup {
  team_a: string;
  team_a_seed?: number | null;
  team_a_score?: number | null;
  team_b: string;
  team_b_seed?: number | null;
  team_b_score?: number | null;
  /** Team name of the winner (must equal team_a or team_b), or null. */
  winner?: string | null;
}

export interface HistoryBracket {
  /** Rounds earliest-first, championship last. Excludes the 3rd-place game. */
  rounds: { matchups: HistoryBracketMatchup[] }[];
  third_place?: HistoryBracketMatchup | null;
}

export interface HistoryExtractionResult {
  season: string | null;
  teams: HistoryTeam[];
  /** Playoff bracket, when a bracket/playoff screen was in the screenshots. */
  bracket?: HistoryBracket | null;
}

export interface ScreenshotTeamData {
  team_name: string;
  players: {
    player_id: string;
    position: string;
    roster_slot: string | null;
  }[];
}

export interface ScreenshotImportResult {
  league_id: string;
  teams_created: number;
  players_imported: number;
  /** Past-season standings rows the client sent (0 if no history was imported). */
  history_provided?: number;
  /** How many of those rows actually matched a team and were saved. */
  history_inserted?: number;
  /** Historical team names that matched no created team and were skipped. */
  history_unmatched?: string[];
  /** Players listed on more than one team; kept on the first, skipped elsewhere. */
  duplicate_players?: { player_id: string; name: string }[];
  /** DB error message if a history insert chunk failed outright (else null). */
  history_error?: string | null;
  message: string;
}

export interface ImageData {
  base64: string;
  media_type: string;
}

// --- Helpers ---

/** Estimate JSON payload size in bytes from base64 images */
function estimatePayloadBytes(images: ImageData[]): number {
  return images.reduce((sum, img) => sum + img.base64.length, 0);
}

const MAX_PAYLOAD_BYTES = 20 * 1024 * 1024; // 20MB safety limit

// --- Hooks ---

export function useExtractRoster() {
  return useMutation<RosterExtractionResult, Error, { images: ImageData[]; team_name?: string; sport: Sport }>({
    mutationFn: async ({ images, team_name, sport }) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not logged in');

      if (estimatePayloadBytes(images) > MAX_PAYLOAD_BYTES) {
        throw new Error('Screenshots are too large. Try using fewer images or lower quality screenshots.');
      }

      const res = await supabase.functions.invoke('import-screenshot-league', {
        body: { action: 'extract_roster', images, team_name, sport },
      });

      if (res.error) {
        // Try to extract the actual error message from the response
        let msg = 'Roster extraction failed';
        try {
          const body = typeof res.error.message === 'string' ? JSON.parse(res.error.message) : null;
          if (body?.error) msg = body.error;
        } catch {
          if (res.error.message) msg = res.error.message;
        }
        throw new Error(msg);
      }
      return res.data as RosterExtractionResult;
    },
  });
}

export function useExtractSettings() {
  return useMutation<SettingsExtractionResult, Error, { images: ImageData[] }>({
    mutationFn: async ({ images }) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not logged in');

      if (estimatePayloadBytes(images) > MAX_PAYLOAD_BYTES) {
        throw new Error('Screenshots are too large. Try using fewer images or lower quality screenshots.');
      }

      const res = await supabase.functions.invoke('import-screenshot-league', {
        body: { action: 'extract_settings', images },
      });

      if (res.error) {
        let msg = 'Settings extraction failed';
        try {
          const body = typeof res.error.message === 'string' ? JSON.parse(res.error.message) : null;
          if (body?.error) msg = body.error;
        } catch {
          if (res.error.message) msg = res.error.message;
        }
        throw new Error(msg);
      }
      return res.data as SettingsExtractionResult;
    },
  });
}

export function useExtractHistory() {
  return useMutation<HistoryExtractionResult, Error, { images: ImageData[] }>({
    mutationFn: async ({ images }) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not logged in');

      if (estimatePayloadBytes(images) > MAX_PAYLOAD_BYTES) {
        throw new Error('Screenshots are too large. Try using fewer images or lower quality screenshots.');
      }

      const res = await supabase.functions.invoke('import-screenshot-league', {
        body: { action: 'extract_history', images },
      });

      if (res.error) {
        let msg = 'History extraction failed';
        try {
          const body = typeof res.error.message === 'string' ? JSON.parse(res.error.message) : null;
          if (body?.error) msg = body.error;
        } catch {
          if (res.error.message) msg = res.error.message;
        }
        // Also check if data contains error info (some 500s include response body in data)
        if (msg === 'History extraction failed' && res.data?.error) {
          msg = res.data.error;
        }
        logger.warn('extract_history error', { error: res.error, data: res.data });
        throw new Error(msg);
      }
      return res.data as HistoryExtractionResult;
    },
  });
}

export interface ExtractedTradedPick {
  year: number | null;
  round: number | null;
  original_team: string;
  new_owner: string;
}

export interface TradedPicksExtractionResult {
  picks: ExtractedTradedPick[];
}

export function useExtractTradedPicks() {
  return useMutation<TradedPicksExtractionResult, Error, { images: ImageData[]; team_names?: string[]; draft_year?: number }>({
    mutationFn: async ({ images, team_names, draft_year }) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not logged in');

      if (estimatePayloadBytes(images) > MAX_PAYLOAD_BYTES) {
        throw new Error('Screenshots are too large. Try fewer images or lower quality.');
      }

      const res = await supabase.functions.invoke('import-screenshot-league', {
        body: { action: 'extract_traded_picks', images, team_names, draft_year },
      });

      if (res.error) {
        let msg = 'Pick extraction failed';
        try {
          const body = typeof res.error.message === 'string' ? JSON.parse(res.error.message) : null;
          if (body?.error) msg = body.error;
        } catch {
          if (res.error.message) msg = res.error.message;
        }
        if (msg === 'Pick extraction failed' && res.data?.error) msg = res.data.error;
        logger.warn('extract_traded_picks error', { error: res.error, data: res.data });
        throw new Error(msg);
      }
      return res.data as TradedPicksExtractionResult;
    },
  });
}

export function useScreenshotImport() {
  return useMutation<ScreenshotImportResult, Error, any>({
    mutationFn: async (payload: any) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not logged in');

      const res = await supabase.functions.invoke('import-screenshot-league', {
        body: { action: 'execute', ...payload },
      });

      if (res.error) {
        let msg = 'Import failed';
        try {
          const body = typeof res.error.message === 'string' ? JSON.parse(res.error.message) : null;
          if (body?.error) msg = body.error;
        } catch {
          if (res.error.message) msg = res.error.message;
        }
        throw new Error(msg);
      }
      return res.data as ScreenshotImportResult;
    },
  });
}

export interface ImportTeamRosterResult {
  team_id: string;
  players_imported: number;
  message: string;
}

export function useImportTeamRoster() {
  return useMutation<
    ImportTeamRosterResult,
    Error,
    { league_id: string; team_id: string; players: ScreenshotTeamData['players'] }
  >({
    mutationFn: async (payload) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not logged in');

      const res = await supabase.functions.invoke('import-screenshot-league', {
        body: { action: 'import_team_roster', ...payload },
      });

      if (res.error) {
        let msg = 'Roster import failed';
        try {
          const body = typeof res.error.message === 'string' ? JSON.parse(res.error.message) : null;
          if (body?.error) msg = body.error;
        } catch {
          if (res.error.message) msg = res.error.message;
        }
        throw new Error(msg);
      }
      return res.data as ImportTeamRosterResult;
    },
  });
}

export interface SearchOrCreateResult {
  created: boolean;
  players: { id: string; name: string; pro_team: string | null; position: string | null }[];
}

export function useSearchOrCreatePlayer() {
  return useMutation<SearchOrCreateResult, Error, { name: string; position?: string; sport: Sport }>({
    mutationFn: async ({ name, position, sport }) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not logged in');

      const res = await supabase.functions.invoke('import-screenshot-league', {
        body: { action: 'search_or_create_player', name, position, sport },
      });

      if (res.error) {
        let msg = 'Player search failed';
        try {
          const body = typeof res.error.message === 'string' ? JSON.parse(res.error.message) : null;
          if (body?.error) msg = body.error;
        } catch {
          if (res.error.message) msg = res.error.message;
        }
        throw new Error(msg);
      }
      return res.data as SearchOrCreateResult;
    },
  });
}
