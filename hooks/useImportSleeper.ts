import { useMutation } from '@tanstack/react-query';

import { supabase } from '@/lib/supabase';

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

      if (res.error) throw new Error(res.error.message ?? 'Preview failed');
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

      if (res.error) throw new Error(res.error.message ?? 'Import failed');
      return res.data as SleeperImportResult;
    },
  });
}
