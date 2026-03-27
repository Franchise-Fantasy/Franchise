import { supabase } from '@/lib/supabase';
import { useQuery } from '@tanstack/react-query';

export interface PlayerHistoryEvent {
  id: string;
  type: 'draft' | 'trade' | 'waiver' | 'commissioner';
  date: string;
  description: string;
  teamTo?: string;
  teamFrom?: string;
  /** For trade events, the league_transactions.id so we can look up trade details */
  transactionId?: string;
}

export function usePlayerHistory(playerId: string | undefined, leagueId: string) {
  return useQuery({
    queryKey: ['playerHistory', leagueId, playerId],
    queryFn: async (): Promise<PlayerHistoryEvent[]> => {
      const events: PlayerHistoryEvent[] = [];

      // 1. Draft origin — check draft_picks for this player in this league
      const { data: draftPick } = await supabase
        .from('draft_picks')
        .select('id, round, pick_number, season, selected_at, team:teams!draft_picks_current_team_id_fkey ( name )')
        .eq('league_id', leagueId)
        .eq('player_id', playerId!)
        .limit(1)
        .maybeSingle();

      if (draftPick?.selected_at) {
        const team = Array.isArray(draftPick.team) ? draftPick.team[0] : draftPick.team;
        const teamName = team?.name ?? 'Unknown';
        events.push({
          id: `draft-${draftPick.id}`,
          type: 'draft',
          date: draftPick.selected_at,
          description: `Drafted by ${teamName} (Rd ${draftPick.round}, Pick ${draftPick.pick_number})`,
          teamTo: teamName,
        });
      }

      // 2. Transaction items — trades, waivers, commissioner actions
      const { data: txnItems } = await supabase
        .from('league_transaction_items')
        .select(`
          id,
          transaction_id,
          team_from:teams!league_transaction_items_team_from_id_fkey ( name ),
          team_to:teams!league_transaction_items_team_to_id_fkey ( name ),
          league_transactions!inner (
            id, type, created_at, notes
          )
        `)
        .eq('player_id', playerId!)
        .eq('league_transactions.league_id', leagueId)
        .order('league_transactions(created_at)', { ascending: true });

      for (const item of txnItems ?? []) {
        const txn = Array.isArray(item.league_transactions) ? item.league_transactions[0] : item.league_transactions;
        if (!txn) continue;

        const teamFrom = (Array.isArray(item.team_from) ? item.team_from[0] : item.team_from)?.name;
        const teamTo = (Array.isArray(item.team_to) ? item.team_to[0] : item.team_to)?.name;

        let description: string;
        switch (txn.type) {
          case 'trade':
            description = teamFrom && teamTo
              ? `Traded from ${teamFrom} to ${teamTo}`
              : `Traded to ${teamTo ?? 'Unknown'}`;
            break;
          case 'waiver':
            if (teamFrom && teamTo) description = `Claimed by ${teamTo} (dropped by ${teamFrom})`;
            else if (teamTo) description = `Added by ${teamTo}`;
            else if (teamFrom) description = `Dropped by ${teamFrom}`;
            else description = 'Waiver transaction';
            break;
          case 'commissioner':
            if (teamFrom && teamTo) description = `Moved from ${teamFrom} to ${teamTo} (Commissioner)`;
            else if (teamTo) description = `Added to ${teamTo} (Commissioner)`;
            else if (teamFrom) description = `Removed from ${teamFrom} (Commissioner)`;
            else description = 'Commissioner action';
            break;
          default:
            description = txn.notes ?? `${txn.type} transaction`;
        }

        events.push({
          id: item.id,
          type: txn.type as PlayerHistoryEvent['type'],
          date: txn.created_at,
          description,
          teamFrom,
          teamTo,
          transactionId: txn.type === 'trade' ? (item.transaction_id ?? txn.id) : undefined,
        });
      }

      // Sort most recent first
      events.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      return events;
    },
    enabled: !!playerId && !!leagueId,
    staleTime: 1000 * 60 * 10,
  });
}
