import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { queryKeys } from '@/constants/queryKeys';
import { sendNotification } from '@/lib/notifications';
import { supabase } from '@/lib/supabase';

// Data source: league_players flagged on_trade_block, plus the
// toggle_trade_block_interest RPC for expressing interest.

export interface TradeBlockPlayer {
  player_id: string;
  name: string;
  position: string;
  pro_team: string;
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
    queryKey: queryKeys.tradeBlock(leagueId!),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('league_players')
        .select('player_id, team_id, trade_block_note, trade_block_interest, players(name, position, pro_team), teams(name)')
        .eq('league_id', leagueId!)
        .eq('on_trade_block', true);
      if (error) throw error;
      if (!data || data.length === 0) return [];

      // Collect all unique team IDs from interest arrays to resolve names
      const allInterestIds = new Set<string>();
      for (const row of data) {
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
      for (const row of data) {
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
          pro_team: row.players?.pro_team ?? '',
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
      await queryClient.cancelQueries({ queryKey: queryKeys.tradeBlock(leagueId!) });
      const previous = queryClient.getQueryData<TradeBlockTeamGroup[]>(queryKeys.tradeBlock(leagueId!));

      queryClient.setQueryData<TradeBlockTeamGroup[]>(queryKeys.tradeBlock(leagueId!), (old) => {
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
        queryClient.setQueryData(queryKeys.tradeBlock(leagueId!), context.previous);
      }
    },
    onSettled: (_data, _error, vars) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.tradeBlock(leagueId!) });
      // If interest was added at the 2-team threshold, a rumor chat message was created
      if (vars.currentInterest.length === 1) {
        queryClient.invalidateQueries({ queryKey: queryKeys.conversations(leagueId!) });
      }
    },
  });
}
