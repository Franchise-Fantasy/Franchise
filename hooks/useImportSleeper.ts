import { useMutation } from '@tanstack/react-query';

import { type Sport } from '@/constants/LeagueDefaults';
import { supabase } from '@/lib/supabase';

// Supabase wraps a non-2xx edge response in a FunctionsHttpError whose
// `.message` is a generic "non-2xx status code" string; the real reason (e.g.
// "This is a nfl league. Only NBA leagues are supported.") sits in the JSON
// body on `.context`. Pull it out so the wizard shows *why* the import failed
// instead of the opaque wrapper (mirrors TeamAssigner / lottery-room).
async function edgeErrorMessage(error: any, fallback: string): Promise<string> {
  try {
    const body = await error?.context?.json?.();
    if (body?.error) return body.error;
  } catch {
    // fall through to the generic message
  }
  return error?.message ?? fallback;
}

// --- Types ---

export interface SleeperPreviewTeam {
  roster_id: number;
  owner_id: string;
  display_name: string;
  team_name: string;
  players: number;
  starters: string[];
  wins: number;
  losses: number;
  fpts: number;
}

export interface SleeperPlayerMatch {
  sleeper_id: string;
  sleeper_name: string;
  sleeper_team: string | null;
  matched_player_id: string | null;
  matched_name: string | null;
  confidence: 'high' | 'medium' | 'low' | 'none';
}

export interface SleeperUnmatched {
  sleeper_id: string;
  name: string;
  team: string | null;
  position: string | null;
  confidence: 'low' | 'none';
}

export interface SleeperTradedPick {
  season: string;
  round: number;
  roster_id: number;
  owner_id: number;
  previous_owner_id: number;
}

export interface SleeperHistoricalTeam {
  roster_id: number;
  name: string;
  wins: number;
  losses: number;
  ties: number;
  fpts: number;
  fpts_against: number;
  standing: number;
}

export interface SleeperHistoricalSeason {
  season: string;
  league_id: string;
  teams: SleeperHistoricalTeam[];
}

export interface SleeperPreviewResult {
  /** Sport detected from the Sleeper league (nba or nfl). */
  sport: Sport;
  league: {
    name: string;
    season: string;
    total_rosters: number;
    roster_positions: string[];
    scoring_settings: Record<string, number>;
    position_counts: Record<string, number>;
    draft_id: string | null;
    previous_league_id: string | null;
    status: string;
    settings: Record<string, any>;
  };
  teams: SleeperPreviewTeam[];
  traded_picks: SleeperTradedPick[];
  player_matches: SleeperPlayerMatch[];
  unmatched_players: SleeperUnmatched[];
  historical_seasons: SleeperHistoricalSeason[];
}

export interface SleeperImportResult {
  league_id: string;
  teams_created: number;
  players_imported: number;
  /** Players skipped because they were already rostered on another team (the
   *  league_players UNIQUE(league_id, player_id) guard). Surfaced in `message`. */
  duplicate_players?: { player_id: string; name: string }[];
  message: string;
}

// --- Hooks ---

export function useSleeperPreview() {
  return useMutation<SleeperPreviewResult, Error, string>({
    mutationFn: async (sleeperLeagueId: string) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not logged in');

      const res = await supabase.functions.invoke('import-sleeper-league', {
        body: { action: 'preview', sleeper_league_id: sleeperLeagueId },
      });

      if (res.error) throw new Error(await edgeErrorMessage(res.error, 'Preview failed'));
      return res.data as SleeperPreviewResult;
    },
  });
}

export function useSleeperImport() {
  return useMutation<SleeperImportResult, Error, any>({
    mutationFn: async (payload: any) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not logged in');

      const res = await supabase.functions.invoke('import-sleeper-league', {
        body: { action: 'execute', ...payload },
      });

      if (res.error) throw new Error(await edgeErrorMessage(res.error, 'Import failed'));
      return res.data as SleeperImportResult;
    },
  });
}
