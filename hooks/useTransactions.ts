import { useInfiniteQuery } from '@tanstack/react-query';

import { queryKeys } from '@/constants/queryKeys';
import { useAppState } from '@/context/AppStateProvider';
import { supabase } from '@/lib/supabase';


const PAGE_SIZE = 20;

export interface TransactionItem {
  id: string;
  player_id: string | null;
  draft_pick_id: string | null;
  team_from_id: string | null;
  team_to_id: string | null;
  player: { name: string; position: string; pro_team: string } | null;
  draft_pick: { season: string; round: number } | null;
  team_from: { name: string; logo_key: string | null } | null;
  team_to: { name: string; logo_key: string | null } | null;
}

export interface Transaction {
  id: string;
  league_id: string;
  type: string;
  notes: string | null;
  created_at: string;
  team_id: string | null;
  group_id: string | null;
  /** Winning FAAB bid in whole dollars; null for standard/free-agent moves. */
  bid_amount: number | null;
  initiator: { name: string; logo_key: string | null } | null;
  league_transaction_items: TransactionItem[];
}

/**
 * Collapse rows sharing a non-null `group_id` (an add and its forced drop done
 * in one user action) into a single transaction whose items are the union of
 * both sides. The list is newest-first, so the first row seen for a group keeps
 * its position and the paired row folds into it. Notes are dropped because the
 * card prefers per-item asset lines ("X added", "Y dropped") for grouped moves.
 *
 * Merging is purely for display — the underlying rows stay separate, so
 * acquisition-limit counts and player history are unaffected. Call on the
 * fully flattened page list (not per page) so a pair split across a page
 * boundary still collapses once both rows are loaded.
 */
export function mergeTransactionGroups(txns: Transaction[]): Transaction[] {
  const merged: Transaction[] = [];
  const groupPos = new Map<string, number>();

  for (const txn of txns) {
    if (txn.group_id) {
      const pos = groupPos.get(txn.group_id);
      if (pos !== undefined) {
        const base = merged[pos];
        merged[pos] = {
          ...base,
          notes: null,
          league_transaction_items: [
            ...base.league_transaction_items,
            ...txn.league_transaction_items,
          ],
        };
        continue;
      }
      groupPos.set(txn.group_id, merged.length);
    }
    merged.push(txn);
  }
  return merged;
}

export function useTransactions(typeFilter?: string) {
  const { leagueId } = useAppState();

  return useInfiniteQuery({
    queryKey: queryKeys.transactions(leagueId!, typeFilter ?? 'all'),
    queryFn: async ({ pageParam = 0 }) => {
      const from = pageParam * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      let query = supabase
        .from('league_transactions')
        .select(`
          id, league_id, type, notes, created_at, team_id, group_id, bid_amount,
          initiator:teams!league_transactions_team_id_fkey ( name, logo_key ),
          league_transaction_items (
            id, player_id, draft_pick_id, team_from_id, team_to_id,
            player:players ( name, position, pro_team ),
            draft_pick:draft_picks ( season, round ),
            team_from:teams!league_transaction_items_team_from_id_fkey ( name, logo_key ),
            team_to:teams!league_transaction_items_team_to_id_fkey ( name, logo_key )
          )
        `)
        .eq('league_id', leagueId!)
        .order('created_at', { ascending: false })
        .range(from, to);

      if (typeFilter) {
        query = query.eq('type', typeFilter);
      }

      const { data, error } = await query;

      if (error) throw error;
      return (data ?? []).map((row) => ({
        ...row,
        initiator: Array.isArray(row.initiator) ? row.initiator[0] ?? null : row.initiator,
        league_transaction_items: (row.league_transaction_items ?? []).map((item) => ({
          ...item,
          player: Array.isArray(item.player) ? item.player[0] ?? null : item.player,
          draft_pick: Array.isArray(item.draft_pick) ? item.draft_pick[0] ?? null : item.draft_pick,
          team_from: Array.isArray(item.team_from) ? item.team_from[0] ?? null : item.team_from,
          team_to: Array.isArray(item.team_to) ? item.team_to[0] ?? null : item.team_to,
        })),
      })) as Transaction[];
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length === PAGE_SIZE ? allPages.length : undefined,
    enabled: !!leagueId,
    staleTime: 1000 * 60 * 10,
  });
}
