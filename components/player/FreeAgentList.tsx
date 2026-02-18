import { PlayerCard } from '@/components/player/PlayerCard';
import { PlayerDetailModal } from '@/components/player/PlayerDetailModal';
import { PlayerFilterBar } from '@/components/player/PlayerFilterBar';
import { ThemedText } from '@/components/ThemedText';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useLeagueScoring } from '@/hooks/useLeagueScoring';
import { usePlayerFilter } from '@/hooks/usePlayerFilter';
import { supabase } from '@/lib/supabase';
import { PlayerSeasonStats } from '@/types/player';
import { calculateAvgFantasyPoints } from '@/utils/fantasyPoints';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ActivityIndicator, Alert, FlatList, StyleSheet, TouchableOpacity, View } from 'react-native';

interface FreeAgentListProps {
  leagueId: string;
  teamId: string;
}

export function FreeAgentList({ leagueId, teamId }: FreeAgentListProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const queryClient = useQueryClient();
  const [selectedPlayer, setSelectedPlayer] = useState<PlayerSeasonStats | null>(null);
  const [addingPlayerId, setAddingPlayerId] = useState<string | null>(null);

  const { data: scoringWeights } = useLeagueScoring(leagueId);

  // Check if there's an active (non-completed) draft — block adds until draft is over
  const { data: hasActiveDraft } = useQuery({
    queryKey: ['hasActiveDraft', leagueId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('drafts')
        .select('id')
        .eq('league_id', leagueId)
        .neq('status', 'completed')
        .limit(1);

      if (error) throw error;
      return (data?.length ?? 0) > 0;
    },
    enabled: !!leagueId,
  });

  const draftInProgress = hasActiveDraft ?? true; // default to locked until we know

  const { data: freeAgents, isLoading } = useQuery<PlayerSeasonStats[]>({

    queryKey: ['freeAgents', leagueId],
    queryFn: async () => {
      // Get all rostered player IDs in this league
      const { data: rosteredPlayers, error: rpError } = await supabase
        .from('league_players')
        .select('player_id')
        .eq('league_id', leagueId);

      if (rpError) throw rpError;
      const rosteredIds = rosteredPlayers?.map(p => String(p.player_id)) || [];

      let query = supabase
        .from('player_season_stats')
        .select('*')
        .gt('games_played', 0)
        .order('avg_pts', { ascending: false });

      if (rosteredIds.length > 0) {
        query = query.filter('player_id', 'not.in', `(${rosteredIds.join(',')})`);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as PlayerSeasonStats[];
    },
    enabled: !!leagueId,
  });

  const { filteredPlayers, filterBarProps } = usePlayerFilter(freeAgents, scoringWeights);

  const handleAddPlayer = async (player: PlayerSeasonStats) => {
    setAddingPlayerId(player.player_id);
    try {
      // Add to league_players
      const { error: lpError } = await supabase.from('league_players').insert({
        league_id: leagueId,
        player_id: player.player_id,
        team_id: teamId,
        acquired_via: 'free_agent',
        acquired_at: new Date().toISOString(),
        position: player.position,
      });

      if (lpError) throw lpError;

      // Record the transaction
      const { data: txn, error: txnError } = await supabase
        .from('league_transactions')
        .insert({
          league_id: leagueId,
          type: 'waiver',
          notes: `Added ${player.name} from free agency`,
        })
        .select('id')
        .single();

      if (txnError) throw txnError;

      await supabase.from('league_transaction_items').insert({
        transaction_id: txn.id,
        player_id: player.player_id,
        team_to_id: teamId,
      });

      // Refresh lists
      queryClient.invalidateQueries({ queryKey: ['freeAgents', leagueId] });
      queryClient.invalidateQueries({ queryKey: ['teamRoster', teamId] });
    } catch (err: any) {
      Alert.alert('Error', err.message ?? 'Failed to add player');
    } finally {
      setAddingPlayerId(null);
    }
  };

  const renderPlayer = ({ item }: { item: PlayerSeasonStats }) => {
    const fpts = scoringWeights
      ? calculateAvgFantasyPoints(item, scoringWeights)
      : undefined;
    const isAdding = addingPlayerId === item.player_id;

    return (
      <PlayerCard
        player={item}
        fantasyPoints={fpts}
        onPress={() => setSelectedPlayer(item)}
        rightElement={
          <TouchableOpacity
            style={[styles.addButton, (isAdding || draftInProgress) && styles.addButtonDisabled]}
            onPress={() => handleAddPlayer(item)}
            disabled={isAdding || draftInProgress}
          >
            <ThemedText style={styles.addButtonText}>
              {isAdding ? '...' : 'Add'}
            </ThemedText>
          </TouchableOpacity>
        }
      />
    );
  };

  if (isLoading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <PlayerFilterBar {...filterBarProps} />
      <FlatList<PlayerSeasonStats>
        data={filteredPlayers}
        renderItem={renderPlayer}
        keyExtractor={(item) => item.player_id}
        contentContainerStyle={styles.listContent}
      />
      <PlayerDetailModal
        player={selectedPlayer}
        leagueId={leagueId}
        teamId={teamId}
        onClose={() => setSelectedPlayer(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  listContent: {
    padding: 8,
  },
  loading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  addButton: {
    backgroundColor: '#28a745',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 4,
    marginLeft: 8,
  },
  addButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  addButtonDisabled: {
    backgroundColor: '#ccc',
  },
});
