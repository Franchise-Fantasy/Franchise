import { useMutation } from '@tanstack/react-query';

import { supabase } from '@/lib/supabase';

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
  team_name: string;
  wins: number | null;
  losses: number | null;
  ties: number | null;
  points_for: number | null;
  points_against: number | null;
  standing: number | null;
}

export interface HistoryExtractionResult {
  season: string | null;
  teams: HistoryTeam[];
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
  return useMutation<RosterExtractionResult, Error, { images: ImageData[]; team_name?: string }>({
    mutationFn: async ({ images, team_name }) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not logged in');

      if (estimatePayloadBytes(images) > MAX_PAYLOAD_BYTES) {
        throw new Error('Screenshots are too large. Try using fewer images or lower quality screenshots.');
      }

      const res = await supabase.functions.invoke('import-screenshot-league', {
        body: { action: 'extract_roster', images, team_name },
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
        console.warn('extract_history error:', JSON.stringify(res.error), 'data:', JSON.stringify(res.data));
        throw new Error(msg);
      }
      return res.data as HistoryExtractionResult;
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

export interface SearchOrCreateResult {
  created: boolean;
  players: { id: string; name: string; pro_team: string | null; position: string | null }[];
}

export function useSearchOrCreatePlayer() {
  return useMutation<SearchOrCreateResult, Error, { name: string; position?: string }>({
    mutationFn: async ({ name, position }) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not logged in');

      const res = await supabase.functions.invoke('import-screenshot-league', {
        body: { action: 'search_or_create_player', name, position },
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
