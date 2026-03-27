import { supabase } from '@/lib/supabase';
import { PlayerSeasonStats } from '@/types/player';
import { useQuery } from '@tanstack/react-query';

export type TradeRosterPlayer = PlayerSeasonStats & { roster_slot: string | null };

export function useTeamRosterForTrade(teamId: string | null, leagueId: string | null) {
  return useQuery<TradeRosterPlayer[]>({
    queryKey: ['teamRosterForTrade', teamId, leagueId],
    queryFn: async () => {
      const lpRes = await supabase
        .from('league_players')
        .select('player_id, roster_slot')
        .eq('team_id', teamId!)
        .eq('league_id', leagueId!);

      if (lpRes.error) throw lpRes.error;
      if (!lpRes.data || lpRes.data.length === 0) return [];

      const slotMap = new Map(lpRes.data.map((lp) => [lp.player_id, lp.roster_slot]));
      const playerIds = lpRes.data.map((lp) => lp.player_id);

      const statsRes = await supabase
        .from('player_season_stats')
        .select('*')
        .in('player_id', playerIds);

      if (statsRes.error) throw statsRes.error;

      return ((statsRes.data ?? []) as PlayerSeasonStats[])
        .map((p) => ({ ...p, roster_slot: slotMap.get(p.player_id) ?? null })) as TradeRosterPlayer[];
    },
    enabled: !!teamId && !!leagueId,
    staleTime: 1000 * 60 * 5,
  });
}

// Returns sets of player_ids and draft_pick_ids that are locked in active trade proposals for a given team
export function useLockedTradeAssets(teamId: string | null, leagueId: string | null) {
  return useQuery({
    queryKey: ['lockedTradeAssets', teamId, leagueId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('trade_proposal_items')
        .select('player_id, draft_pick_id, proposal_id, trade_proposals!inner(status)')
        .eq('from_team_id', teamId!)
        .in('trade_proposals.status', ['in_review', 'delayed', 'pending_drops']);
      if (error) throw error;

      const lockedPlayerIds = new Set<string>();
      const lockedPickIds = new Set<string>();
      for (const item of data ?? []) {
        if (item.player_id) lockedPlayerIds.add(item.player_id);
        if (item.draft_pick_id) lockedPickIds.add(item.draft_pick_id);
      }
      return { lockedPlayerIds, lockedPickIds };
    },
    enabled: !!teamId && !!leagueId,
    staleTime: 1000 * 60 * 2,
  });
}

// Returns player_ids that are queued for drop via pending_transactions OR pending waiver claims
export function usePendingDropPlayerIds(teamId: string | null, leagueId: string | null) {
  return useQuery({
    queryKey: ['pendingDropPlayerIds', teamId, leagueId],
    queryFn: async () => {
      const [txnRes, waiverRes] = await Promise.all([
        supabase
          .from('pending_transactions')
          .select('player_id')
          .eq('team_id', teamId!)
          .eq('league_id', leagueId!)
          .eq('status', 'pending')
          .in('action_type', ['drop', 'add_drop']),
        supabase
          .from('waiver_claims')
          .select('drop_player_id')
          .eq('team_id', teamId!)
          .eq('league_id', leagueId!)
          .eq('status', 'pending')
          .not('drop_player_id', 'is', null),
      ]);
      if (txnRes.error) throw txnRes.error;
      if (waiverRes.error) throw waiverRes.error;

      const ids = new Set<string>();
      for (const r of txnRes.data ?? []) ids.add(r.player_id as string);
      for (const r of waiverRes.data ?? []) ids.add(r.drop_player_id as string);
      return ids;
    },
    enabled: !!teamId && !!leagueId,
    staleTime: 1000 * 60 * 2,
  });
}
