import { supabase } from '@/lib/supabase';
import { useQuery } from '@tanstack/react-query';
import { CURRENT_NBA_SEASON } from '@/constants/LeagueDefaults';

export interface TradeProposalRow {
  id: string;
  league_id: string;
  proposed_by_team_id: string;
  status: string;
  proposed_at: string;
  accepted_at: string | null;
  review_expires_at: string | null;
  completed_at: string | null;
  transaction_id: string | null;
  notes: string | null;
  teams: Array<{
    id: string;
    team_id: string;
    status: string;
    team_name: string;
  }>;
  items: Array<{
    id: string;
    player_id: string | null;
    draft_pick_id: string | null;
    from_team_id: string;
    to_team_id: string;
    player_name: string | null;
    player_position: string | null;
    player_nba_team: string | null;
    pick_season: string | null;
    pick_round: number | null;
    pick_original_team_name: string | null;
  }>;
}

export function useTradeProposals(leagueId: string | null) {
  return useQuery<TradeProposalRow[]>({
    queryKey: ['tradeProposals', leagueId],
    queryFn: async () => {
      // Fetch proposals
      const { data: proposals, error } = await supabase
        .from('trade_proposals')
        .select('*')
        .eq('league_id', leagueId!)
        .order('proposed_at', { ascending: false });
      if (error) throw error;
      if (!proposals || proposals.length === 0) return [];

      const proposalIds = proposals.map((p) => p.id);

      // Fetch teams for all proposals
      const { data: proposalTeams, error: teamsError } = await supabase
        .from('trade_proposal_teams')
        .select('id, proposal_id, team_id, status, teams(name)')
        .in('proposal_id', proposalIds);
      if (teamsError) throw teamsError;

      // Fetch items for all proposals
      const { data: proposalItems, error: itemsError } = await supabase
        .from('trade_proposal_items')
        .select('id, proposal_id, player_id, draft_pick_id, from_team_id, to_team_id, players(name, position, nba_team), draft_picks(season, round, original_team_id)')
        .in('proposal_id', proposalIds);
      if (itemsError) throw itemsError;

      // Collect original_team_ids to resolve names
      const origTeamIds = (proposalItems ?? [])
        .filter((i: any) => i.draft_picks?.original_team_id)
        .map((i: any) => i.draft_picks.original_team_id);
      let origTeamNameMap: Record<string, string> = {};
      if (origTeamIds.length > 0) {
        const { data: origTeams } = await supabase
          .from('teams')
          .select('id, name')
          .in('id', [...new Set(origTeamIds)]);
        if (origTeams) {
          origTeamNameMap = Object.fromEntries(origTeams.map((t) => [t.id, t.name]));
        }
      }

      return proposals.map((p) => ({
        ...p,
        teams: (proposalTeams ?? [])
          .filter((t: any) => t.proposal_id === p.id)
          .map((t: any) => ({
            id: t.id,
            team_id: t.team_id,
            status: t.status,
            team_name: t.teams?.name ?? 'Unknown',
          })),
        items: (proposalItems ?? [])
          .filter((i: any) => i.proposal_id === p.id)
          .map((i: any) => ({
            id: i.id,
            player_id: i.player_id,
            draft_pick_id: i.draft_pick_id,
            from_team_id: i.from_team_id,
            to_team_id: i.to_team_id,
            player_name: i.players?.name ?? null,
            player_position: i.players?.position ?? null,
            player_nba_team: i.players?.nba_team ?? null,
            pick_season: i.draft_picks?.season ?? null,
            pick_round: i.draft_picks?.round ?? null,
            pick_original_team_name: i.draft_picks?.original_team_id
              ? origTeamNameMap[i.draft_picks.original_team_id] ?? null
              : null,
          })),
      }));
    },
    enabled: !!leagueId,
  });
}

export function useTradeVotes(proposalId: string | null) {
  return useQuery({
    queryKey: ['tradeVotes', proposalId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('trade_votes')
        .select('id, proposal_id, team_id, vote, voted_at, teams(name)')
        .eq('proposal_id', proposalId!);
      if (error) throw error;
      return (data ?? []).map((v: any) => ({
        ...v,
        team_name: v.teams?.name ?? 'Unknown',
      }));
    },
    enabled: !!proposalId,
  });
}

export function useTeamTradablePicks(teamId: string | null, leagueId: string | null) {
  return useQuery({
    queryKey: ['tradablePicks', teamId, leagueId],
    queryFn: async () => {
      // Get max_future_seasons from league
      const { data: league, error: leagueError } = await supabase
        .from('leagues')
        .select('max_future_seasons')
        .eq('id', leagueId!)
        .single();
      if (leagueError) throw leagueError;

      const maxFuture = league?.max_future_seasons ?? 3;
      // Parse current season start year (e.g., '2025-26' -> 2025)
      const currentStartYear = parseInt(CURRENT_NBA_SEASON.split('-')[0], 10);

      // Build list of valid seasons
      const validSeasons: string[] = [];
      for (let i = 0; i <= maxFuture; i++) {
        const startYear = currentStartYear + i;
        const endYear = (startYear + 1) % 100;
        validSeasons.push(`${startYear}-${String(endYear).padStart(2, '0')}`);
      }

      // Fetch picks owned by this team that haven't been used
      const { data: picks, error: picksError } = await supabase
        .from('draft_picks')
        .select('id, season, round, pick_number, current_team_id, original_team_id, player_id, league_id')
        .eq('current_team_id', teamId!)
        .eq('league_id', leagueId!)
        .is('player_id', null)
        .in('season', validSeasons)
        .order('season', { ascending: true })
        .order('round', { ascending: true });
      if (picksError) throw picksError;

      // Resolve original team names
      const origIds = [...new Set((picks ?? []).map((p) => p.original_team_id).filter(Boolean))];
      let nameMap: Record<string, string> = {};
      if (origIds.length > 0) {
        const { data: teams } = await supabase.from('teams').select('id, name').in('id', origIds);
        if (teams) nameMap = Object.fromEntries(teams.map((t) => [t.id, t.name]));
      }

      return (picks ?? []).map((p) => ({
        ...p,
        original_team_name: nameMap[p.original_team_id] ?? 'Unknown',
      }));
    },
    enabled: !!teamId && !!leagueId,
  });
}

export function useMyPendingTrades(teamId: string | null, leagueId: string | null) {
  return useQuery<number>({
    queryKey: ['pendingTradeCount', teamId, leagueId],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('trade_proposal_teams')
        .select('id', { count: 'exact', head: true })
        .eq('team_id', teamId!)
        .eq('status', 'pending');
      if (error) throw error;
      return count ?? 0;
    },
    enabled: !!teamId && !!leagueId,
  });
}

export interface TradeBlockPlayer {
  player_id: string;
  name: string;
  position: string;
  nba_team: string;
  team_id: string;
  team_name: string;
}

export interface TradeBlockTeamGroup {
  team_id: string;
  team_name: string;
  players: TradeBlockPlayer[];
}

export function useTradeBlock(leagueId: string | null) {
  return useQuery<TradeBlockTeamGroup[]>({
    queryKey: ['tradeBlock', leagueId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('league_players')
        .select('player_id, team_id, players(name, position, nba_team), teams(name)')
        .eq('league_id', leagueId!)
        .eq('on_trade_block', true);
      if (error) throw error;
      if (!data || data.length === 0) return [];

      // Group by team
      const grouped: Record<string, TradeBlockTeamGroup> = {};
      for (const row of data as any[]) {
        const tid = row.team_id;
        if (!grouped[tid]) {
          grouped[tid] = {
            team_id: tid,
            team_name: row.teams?.name ?? 'Unknown',
            players: [],
          };
        }
        grouped[tid].players.push({
          player_id: row.player_id,
          name: row.players?.name ?? 'Unknown',
          position: row.players?.position ?? '',
          nba_team: row.players?.nba_team ?? '',
          team_id: tid,
          team_name: row.teams?.name ?? 'Unknown',
        });
      }
      return Object.values(grouped);
    },
    enabled: !!leagueId,
  });
}
