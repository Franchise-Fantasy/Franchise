import { useQuery } from '@tanstack/react-query';

import { queryKeys } from '@/constants/queryKeys';
import { supabase } from '@/lib/supabase';

import type { TradeProposalRow } from './types';

// Data source: trade proposals + votes (get_trade_proposals_for_league RPC,
// trade_votes, trade_proposal_teams) plus player headshots for list rendering.

/**
 * Batched lookup of `external_id_nba` for every player referenced across
 * a list of proposals. One round-trip, deduped across all cards on the
 * same surface, so list views (the trades page, league history, chat)
 * can render player headshots without N+1 queries.
 */
export function useTradeProposalsHeadshots(proposals: TradeProposalRow[] | undefined) {
  const playerIds = [
    ...new Set(
      (proposals ?? [])
        .flatMap((p) => p.items)
        .map((i) => i.player_id)
        .filter((id): id is string => !!id),
    ),
  ].sort();

  return useQuery<Record<string, string | null>>({
    queryKey: ['tradePlayerHeadshots', playerIds.join(',')],
    queryFn: async () => {
      if (playerIds.length === 0) return {};
      const { data, error } = await supabase
        .from('player_season_stats')
        .select('player_id, external_id_nba')
        .in('player_id', playerIds);
      if (error) throw error;
      const map: Record<string, string | null> = {};
      for (const row of data ?? []) {
        if (row.player_id) map[row.player_id] = row.external_id_nba ?? null;
      }
      return map;
    },
    enabled: playerIds.length > 0,
    staleTime: 1000 * 60 * 10,
  });
}

export function useTradeProposals(leagueId: string | null) {
  return useQuery<TradeProposalRow[]>({
    queryKey: queryKeys.tradeProposals(leagueId!),
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        'get_trade_proposals_for_league',
        { p_league_id: leagueId! },
      );
      if (error) throw error;
      return ((data ?? []) as unknown) as TradeProposalRow[];
    },
    enabled: !!leagueId,
    staleTime: 1000 * 60 * 2,
  });
}

export function useTradeVotes(proposalId: string | null) {
  return useQuery({
    queryKey: queryKeys.tradeVotes(proposalId!),
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

export function useMyPendingTrades(teamId: string | null, leagueId: string | null) {
  return useQuery<number>({
    queryKey: queryKeys.pendingTradeCount(teamId!, leagueId!),
    queryFn: async () => {
      // Count trades where I need to respond (pending) or select drops (pending_drops with empty drop_player_ids).
      // The drops query fetches rows and filters client-side because PostgREST's array-equality syntax
      // for the empty-array literal is brittle (was previously cast `'{}' as any` and silently never matched).
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
          .select('drop_player_ids, trade_proposals!inner(id)')
          .eq('team_id', teamId!)
          .eq('trade_proposals.league_id', leagueId!)
          .eq('trade_proposals.status', 'pending_drops'),
      ]);
      if (pendingRes.error) throw pendingRes.error;
      if (dropsRes.error) throw dropsRes.error;
      const dropCount = (dropsRes.data ?? []).filter(
        (r) => !r.drop_player_ids || r.drop_player_ids.length === 0,
      ).length;
      return (pendingRes.count ?? 0) + dropCount;
    },
    enabled: !!teamId && !!leagueId,
    staleTime: 1000 * 60 * 5,
  });
}
