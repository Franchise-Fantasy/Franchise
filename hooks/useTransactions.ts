import { useAppState } from '@/context/AppStateProvider';
import { supabase } from '@/lib/supabase';
import { useInfiniteQuery } from '@tanstack/react-query';

const PAGE_SIZE = 20;

export interface TransactionItem {
  id: string;
  player_id: string | null;
  draft_pick_id: string | null;
  team_from_id: string | null;
  team_to_id: string | null;
  player: { name: string; position: string; nba_team: string } | null;
  team_from: { name: string } | null;
  team_to: { name: string } | null;
}

export interface Transaction {
  id: string;
  league_id: string;
  type: string;
  notes: string | null;
  created_at: string;
  league_transaction_items: TransactionItem[];
}

export function useTransactions() {
  const { leagueId } = useAppState();

  return useInfiniteQuery({
    queryKey: ['transactions', leagueId],
    queryFn: async ({ pageParam = 0 }) => {
      const from = pageParam * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      const { data, error } = await supabase
        .from('league_transactions')
        .select(`
          id, league_id, type, notes, created_at,
          league_transaction_items (
            id, player_id, draft_pick_id, team_from_id, team_to_id,
            player:players ( name, position, nba_team ),
            team_from:teams!league_transaction_items_team_from_id_fkey ( name ),
            team_to:teams!league_transaction_items_team_to_id_fkey ( name )
          )
        `)
        .eq('league_id', leagueId!)
        .order('created_at', { ascending: false })
        .range(from, to);

      if (error) throw error;
      return data as Transaction[];
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length === PAGE_SIZE ? allPages.length : undefined,
    enabled: !!leagueId,
  });
}
