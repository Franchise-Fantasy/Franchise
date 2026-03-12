import { CURRENT_NBA_SEASON } from '@/constants/LeagueDefaults';
import { supabase } from '@/lib/supabase';
import { useQuery } from '@tanstack/react-query';

export interface DraftHubPick {
  id: string;
  season: string;
  round: number;
  slot_number: number | null;
  current_team_id: string;
  original_team_id: string;
  current_team_name: string;
  original_team_name: string;
  isTraded: boolean;
  protection_threshold: number | null;
  protection_owner_id: string | null;
  protection_owner_name: string | null;
  // Set by simulation resolution
  wasProtected?: boolean;
  wasConveyed?: boolean;
  wasSwapped?: boolean;
}

export interface DraftHubSwap {
  id: string;
  season: string;
  round: number;
  beneficiary_team_id: string;
  counterparty_team_id: string;
  beneficiary_team_name: string;
  counterparty_team_name: string;
}

export interface DraftHubTeam {
  id: string;
  name: string;
  wins: number;
  losses: number;
  points_for: number;
}

export interface DraftHubLeagueSettings {
  playoffTeams: number;
  lotteryDraws: number;
  lotteryOdds: number[] | null;
  rookieDraftRounds: number;
  pickConditionsEnabled: boolean;
}

export interface DraftHubData {
  picks: DraftHubPick[];
  swaps: DraftHubSwap[];
  teams: DraftHubTeam[];
  validSeasons: string[];
  leagueSettings: DraftHubLeagueSettings;
}

export function useDraftHub(leagueId: string | null) {
  return useQuery<DraftHubData>({
    queryKey: ['draftHub', leagueId],
    queryFn: async () => {
      const { data: league, error: leagueError } = await supabase
        .from('leagues')
        .select('max_future_seasons, playoff_teams, lottery_draws, lottery_odds, rookie_draft_rounds, season, pick_conditions_enabled')
        .eq('id', leagueId!)
        .single();
      if (leagueError) throw leagueError;

      const maxFuture = league?.max_future_seasons ?? 3;
      const currentStartYear = parseInt(CURRENT_NBA_SEASON.split('-')[0], 10);

      const validSeasons: string[] = [];
      for (let i = 1; i <= maxFuture; i++) {
        const startYear = currentStartYear + i;
        const endYear = (startYear + 1) % 100;
        validSeasons.push(`${startYear}-${String(endYear).padStart(2, '0')}`);
      }

      const rookieDraftRounds = league?.rookie_draft_rounds ?? 2;

      const { data: picks, error: picksError } = await supabase
        .from('draft_picks')
        .select('id, season, round, slot_number, current_team_id, original_team_id, player_id, protection_threshold, protection_owner_id')
        .eq('league_id', leagueId!)
        .is('player_id', null)
        .in('season', validSeasons)
        .lte('round', rookieDraftRounds)
        .order('season', { ascending: true })
        .order('round', { ascending: true })
        .order('slot_number', { ascending: true });
      if (picksError) throw picksError;

      // Fetch unresolved pick swaps
      const { data: swapRows, error: swapsError } = await supabase
        .from('pick_swaps')
        .select('id, season, round, beneficiary_team_id, counterparty_team_id')
        .eq('league_id', leagueId!)
        .eq('resolved', false);
      if (swapsError) throw swapsError;

      const { data: teams, error: teamsError } = await supabase
        .from('teams')
        .select('id, name, wins, losses, points_for')
        .eq('league_id', leagueId!)
        .order('wins', { ascending: false })
        .order('points_for', { ascending: false });
      if (teamsError) throw teamsError;

      const nameMap: Record<string, string> = {};
      for (const t of teams ?? []) {
        nameMap[t.id] = t.name;
      }

      const mappedPicks: DraftHubPick[] = (picks ?? []).map((p) => ({
        id: p.id,
        season: p.season,
        round: p.round,
        slot_number: p.slot_number,
        current_team_id: p.current_team_id,
        original_team_id: p.original_team_id,
        current_team_name: nameMap[p.current_team_id] ?? 'Unknown',
        original_team_name: nameMap[p.original_team_id] ?? 'Unknown',
        isTraded: p.current_team_id !== p.original_team_id,
        protection_threshold: p.protection_threshold ?? null,
        protection_owner_id: p.protection_owner_id ?? null,
        protection_owner_name: p.protection_owner_id ? (nameMap[p.protection_owner_id] ?? null) : null,
      }));

      const mappedSwaps: DraftHubSwap[] = (swapRows ?? []).map((s) => ({
        id: s.id,
        season: s.season,
        round: s.round,
        beneficiary_team_id: s.beneficiary_team_id,
        counterparty_team_id: s.counterparty_team_id,
        beneficiary_team_name: nameMap[s.beneficiary_team_id] ?? 'Unknown',
        counterparty_team_name: nameMap[s.counterparty_team_id] ?? 'Unknown',
      }));

      return {
        picks: mappedPicks,
        swaps: mappedSwaps,
        teams: (teams ?? []) as DraftHubTeam[],
        validSeasons,
        leagueSettings: {
          playoffTeams: league?.playoff_teams ?? 4,
          lotteryDraws: league?.lottery_draws ?? 4,
          lotteryOdds: league?.lottery_odds ?? null,
          rookieDraftRounds: league?.rookie_draft_rounds ?? 2,
          pickConditionsEnabled: league?.pick_conditions_enabled ?? false,
        },
      };
    },
    enabled: !!leagueId,
    staleTime: 1000 * 60 * 5,
  });
}
