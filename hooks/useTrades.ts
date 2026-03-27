import { supabase } from '@/lib/supabase';
import { sendNotification } from '@/lib/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CURRENT_NBA_SEASON } from '@/constants/LeagueDefaults';

export interface TradeItemRow {
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
  protection_threshold: number | null;
  pick_swap_season: string | null;
  pick_swap_round: number | null;
}

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
  counteroffer_of: string | null;
  teams: Array<{
    id: string;
    team_id: string;
    status: string;
    team_name: string;
  }>;
  items: TradeItemRow[];
  /** Items from the original proposal this counters — used for "NEW" badges */
  original_items?: TradeItemRow[];
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
      const counterofferOfIds = proposals
        .filter((p) => p.counteroffer_of)
        .map((p) => p.counteroffer_of!);

      // Fetch teams, items, and counteroffer items in parallel
      const [teamsRes, itemsRes, origItemsRes] = await Promise.all([
        supabase
          .from('trade_proposal_teams')
          .select('id, proposal_id, team_id, status, teams(name)')
          .in('proposal_id', proposalIds),
        supabase
          .from('trade_proposal_items')
          .select('id, proposal_id, player_id, draft_pick_id, from_team_id, to_team_id, protection_threshold, pick_swap_season, pick_swap_round, players(name, position, nba_team), draft_picks(season, round, original_team_id)')
          .in('proposal_id', proposalIds),
        counterofferOfIds.length > 0
          ? supabase
              .from('trade_proposal_items')
              .select('id, proposal_id, player_id, draft_pick_id, from_team_id, to_team_id, protection_threshold, pick_swap_season, pick_swap_round, players(name, position, nba_team), draft_picks(season, round, original_team_id)')
              .in('proposal_id', counterofferOfIds)
          : Promise.resolve({ data: [] as any[], error: null }),
      ]);
      if (teamsRes.error) throw teamsRes.error;
      if (itemsRes.error) throw itemsRes.error;
      if (origItemsRes.error) throw origItemsRes.error;

      const proposalTeams = teamsRes.data;
      const proposalItems = itemsRes.data;

      // Collect original_team_ids from both item sets to resolve names in one query
      const allItems = [...(proposalItems ?? []), ...(origItemsRes.data ?? [])] as any[];
      const origTeamIds = [...new Set(
        allItems
          .filter((i: any) => i.draft_picks?.original_team_id)
          .map((i: any) => i.draft_picks.original_team_id),
      )];
      let origTeamNameMap: Record<string, string> = {};
      if (origTeamIds.length > 0) {
        const { data: origTeams } = await supabase
          .from('teams')
          .select('id, name')
          .in('id', origTeamIds);
        if (origTeams) {
          origTeamNameMap = Object.fromEntries(origTeams.map((t) => [t.id, t.name]));
        }
      }

      // Build counteroffer original items map
      let originalItemsMap: Record<string, TradeItemRow[]> = {};
      for (const i of (origItemsRes.data ?? []) as any[]) {
        const pid = i.proposal_id;
        if (!originalItemsMap[pid]) originalItemsMap[pid] = [];
        originalItemsMap[pid].push({
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
          protection_threshold: i.protection_threshold ?? null,
          pick_swap_season: i.pick_swap_season ?? null,
          pick_swap_round: i.pick_swap_round ?? null,
        });
      }

      const mapItem = (i: any): TradeItemRow => ({
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
        protection_threshold: i.protection_threshold ?? null,
        pick_swap_season: i.pick_swap_season ?? null,
        pick_swap_round: i.pick_swap_round ?? null,
      });

      // Build a set of proposal IDs that have been superseded by a counteroffer
      const supersededIds = new Set(counterofferOfIds);

      return proposals
        .filter((p) => !supersededIds.has(p.id) || p.status !== 'cancelled')
        .map((p) => ({
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
            .map(mapItem),
          original_items: p.counteroffer_of
            ? originalItemsMap[p.counteroffer_of]
            : undefined,
        }));
    },
    enabled: !!leagueId,
    staleTime: 30_000,
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
    staleTime: 30_000,
  });
}

export function useTeamTradablePicks(teamId: string | null, leagueId: string | null, draftPickTradingEnabled: boolean = true) {
  return useQuery({
    queryKey: ['tradablePicks', teamId, leagueId, draftPickTradingEnabled],
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

      // Current season (for in-progress initial draft) + future rookie drafts.
      // max_future_seasons=3 means the next 3 rookie drafts (offset 1..3 from current season).
      const validSeasons: string[] = [];
      for (let i = 0; i <= maxFuture; i++) {
        const startYear = currentStartYear + i;
        const endYear = (startYear + 1) % 100;
        validSeasons.push(`${startYear}-${String(endYear).padStart(2, '0')}`);
      }

      // Fetch picks owned by this team that haven't been used
      // Join drafts(type) to distinguish initial vs rookie draft picks
      const { data: picks, error: picksError } = await supabase
        .from('draft_picks')
        .select('id, season, round, pick_number, current_team_id, original_team_id, player_id, league_id, drafts(type)')
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

      const results = (picks ?? []).map((p) => ({
        ...p,
        original_team_name: nameMap[p.original_team_id] ?? 'Unknown',
      }));

      // When draft pick trading is disabled, exclude initial draft picks only
      // Rookie draft picks (type='rookie') and future picks (no draft) remain tradeable
      if (!draftPickTradingEnabled) {
        return results.filter((p) => (p.drafts as any)?.type !== 'initial');
      }
      return results;
    },
    enabled: !!teamId && !!leagueId,
    staleTime: 1000 * 60 * 5,
  });
}

export function useMyPendingTrades(teamId: string | null, leagueId: string | null) {
  return useQuery<number>({
    queryKey: ['pendingTradeCount', teamId, leagueId],
    queryFn: async () => {
      // Count trades where I need to respond (pending) or select a drop (pending_drops without drop_player_id)
      const [pendingRes, dropsRes] = await Promise.all([
        supabase
          .from('trade_proposal_teams')
          .select('id, trade_proposals!inner(id)', { count: 'exact', head: true })
          .eq('team_id', teamId!)
          .eq('status', 'pending')
          .eq('trade_proposals.league_id', leagueId!)
          .eq('trade_proposals.status', 'pending'),
        supabase
          .from('trade_proposal_teams')
          .select('id, trade_proposals!inner(id)', { count: 'exact', head: true })
          .eq('team_id', teamId!)
          .is('drop_player_id', null)
          .eq('trade_proposals.league_id', leagueId!)
          .eq('trade_proposals.status', 'pending_drops'),
      ]);
      if (pendingRes.error) throw pendingRes.error;
      if (dropsRes.error) throw dropsRes.error;
      return (pendingRes.count ?? 0) + (dropsRes.count ?? 0);
    },
    enabled: !!teamId && !!leagueId,
    staleTime: 1000 * 60 * 5,
  });
}

export interface TradeBlockPlayer {
  player_id: string;
  name: string;
  position: string;
  nba_team: string;
  team_id: string;
  team_name: string;
  trade_block_note: string | null;
  trade_block_interest: string[];
  /** Map of team_id → team_name for teams that expressed interest */
  interest_team_names: Record<string, string>;
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
        .select('player_id, team_id, trade_block_note, trade_block_interest, players(name, position, nba_team), teams(name)')
        .eq('league_id', leagueId!)
        .eq('on_trade_block', true);
      if (error) throw error;
      if (!data || data.length === 0) return [];

      // Collect all unique team IDs from interest arrays to resolve names
      const allInterestIds = new Set<string>();
      for (const row of data as any[]) {
        for (const id of row.trade_block_interest ?? []) allInterestIds.add(id);
      }
      let teamNameMap: Record<string, string> = {};
      if (allInterestIds.size > 0) {
        const { data: teams } = await supabase
          .from('teams')
          .select('id, name')
          .in('id', [...allInterestIds]);
        if (teams) {
          for (const t of teams) teamNameMap[t.id] = t.name;
        }
      }

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
        const interest: string[] = row.trade_block_interest ?? [];
        const interestNames: Record<string, string> = {};
        for (const id of interest) {
          interestNames[id] = teamNameMap[id] ?? 'Unknown';
        }
        grouped[tid].players.push({
          player_id: row.player_id,
          name: row.players?.name ?? 'Unknown',
          position: row.players?.position ?? '',
          nba_team: row.players?.nba_team ?? '',
          team_id: tid,
          team_name: row.teams?.name ?? 'Unknown',
          trade_block_note: row.trade_block_note ?? null,
          trade_block_interest: interest,
          interest_team_names: interestNames,
        });
      }
      return Object.values(grouped);
    },
    enabled: !!leagueId,
    staleTime: 1000 * 60 * 5,
  });
}

export function useToggleTradeBlockInterest(leagueId: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      playerId,
      teamId,
      currentInterest,
      ownerTeamId,
      playerName,
    }: {
      playerId: string;
      teamId: string;
      currentInterest: string[];
      ownerTeamId?: string;
      playerName?: string;
    }) => {
      const { data, error } = await supabase.rpc('toggle_trade_block_interest', {
        p_league_id: leagueId!,
        p_player_id: playerId,
        p_team_id: teamId,
      });
      if (error) throw error;

      // RPC returns true when interest was added — notify the player's owner
      if (data === true && ownerTeamId && playerName) {
        sendNotification({
          league_id: leagueId!,
          team_ids: [ownerTeamId],
          category: 'trade_block',
          title: 'Trade Block Interest',
          body: `A team is interested in ${playerName}`,
        });
      }

      // When we just crossed the 2-team threshold, push-notify about the rumor
      // (the RPC already created the rumor + chat message atomically)
      if (data === true && playerName && currentInterest.length === 1) {
        sendNotification({
          league_id: leagueId!,
          category: 'trade_rumors',
          title: 'Trade Rumor',
          body: `${playerName} is attracting attention on the trade block — multiple teams have expressed interest`,
          data: { screen: 'chat' },
        });
      }
    },
    onMutate: async ({ playerId, teamId, currentInterest }) => {
      await queryClient.cancelQueries({ queryKey: ['tradeBlock', leagueId] });
      const previous = queryClient.getQueryData<TradeBlockTeamGroup[]>(['tradeBlock', leagueId]);

      queryClient.setQueryData<TradeBlockTeamGroup[]>(['tradeBlock', leagueId], (old) => {
        if (!old) return old;
        return old.map((group) => ({
          ...group,
          players: group.players.map((p) => {
            if (p.player_id !== playerId) return p;
            const isInterested = currentInterest.includes(teamId);
            return {
              ...p,
              trade_block_interest: isInterested
                ? p.trade_block_interest.filter((id) => id !== teamId)
                : [...p.trade_block_interest, teamId],
            };
          }),
        }));
      });

      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['tradeBlock', leagueId], context.previous);
      }
    },
    onSettled: (_data, _error, vars) => {
      queryClient.invalidateQueries({ queryKey: ['tradeBlock', leagueId] });
      // If interest was added at the 2-team threshold, a rumor chat message was created
      if (vars.currentInterest.length === 1) {
        queryClient.invalidateQueries({ queryKey: ['conversations', leagueId] });
      }
    },
  });
}
