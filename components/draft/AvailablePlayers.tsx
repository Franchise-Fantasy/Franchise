import { useDraftPlayer } from '@/hooks/useDraftPlayer';
import { supabase } from '@/lib/supabase';
import { Player } from '@/types/draft';
import { formatPosition } from '@/utils/formatting';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, TouchableOpacity } from 'react-native';
import { ThemedText } from '../ThemedText';
import { ThemedView } from '../ThemedView';

interface AvailablePlayersProps {
  draftId: string;
  leagueId: string;
  currentPick: { id: string; current_team_id: string } | null;
  teamId: string;
}



export function AvailablePlayers({ draftId, leagueId, currentPick, teamId }: AvailablePlayersProps) {
  const queryClient = useQueryClient();
  const isMyTurn = currentPick?.current_team_id === teamId;

  const lastPlayersRef = useRef<Player[] | undefined>(undefined);

  const { mutate: draftPlayer, isPending: isDrafting } = useDraftPlayer(leagueId, draftId);

  //  Create a simple handler function that calls `draftPlayer`.
  const handleDraft = (player: Player) => {
    if (!isMyTurn || !currentPick) return;
    draftPlayer(player); // This calls the mutation with the specific player
  };


  //  Fetch Data
  const { data: players, isLoading } = useQuery<Player[], Error>({
    queryKey: ['availablePlayers', leagueId],
    queryFn: async () => {
      const { data: draftedPlayers, error: draftedError } = await supabase
        .from('league_players')
        .select('player_id')
        .eq('league_id', leagueId);

      if (draftedError) throw draftedError;

      const draftedPlayerIds = draftedPlayers?.map(p => String(p.player_id)) || [];

      const { data, error } = await supabase
        .from('players')
        .select('*')
        .filter('id', 'not.in', `(${draftedPlayerIds.join(',')})`)
        .order('name');

      if (error) throw error;
      return data as Player[];
    },
    initialData: () => lastPlayersRef.current ?? [],
  });

    // Add this effect for real-time updates
  useEffect(() => {
    const channel = supabase
      .channel(`league_players_${leagueId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'league_players',
        },
        (payload) => {
          // Only refetch if the change is for this league
          if ((payload.new as { league_id?: string })?.league_id === leagueId) {
            queryClient.invalidateQueries({ queryKey: ['availablePlayers', leagueId] });
          }
        }
      )
      .subscribe();

    return () => {
      channel.unsubscribe();
    };
  }, [leagueId, queryClient]);

  // Use useEffect to update lastPlayersRef on data change
  useEffect(() => {
    if (players && players.length > 0) {
      lastPlayersRef.current = players;
    }
  }, [players]);
  


  const renderPlayer = ({ item }: { item: Player }) => (
    <TouchableOpacity style={styles.playerRow}>
      <ThemedText style={styles.playerPosition}>
        {formatPosition(item.position)}
      </ThemedText>
      <ThemedText style={styles.playerName}>{item.name}</ThemedText>
      <TouchableOpacity 
        style={[
          styles.draftButton,
          (!isMyTurn || isDrafting) && styles.draftButtonDisabled
        ]}
        onPress={() => handleDraft(item)}
        disabled={!isMyTurn || isDrafting}
      >
        <ThemedText style={[
          styles.draftButtonText,
          (!isMyTurn || isDrafting) && styles.draftButtonTextDisabled
        ]}>
          Draft
        </ThemedText>
      </TouchableOpacity>
    </TouchableOpacity>
  );

  if (isLoading) {
    return (
      <ThemedView style={styles.container}>
        <ActivityIndicator style={styles.loading} />
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <FlatList<Player>
        data={players}
        renderItem={renderPlayer}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    padding: 16,
    borderBottomWidth: 1,
    borderColor: '#eee',
  },
  listContent: {
    padding: 8,
  },
  playerRow: {
    flexDirection: 'row',
    padding: 12,
    borderBottomWidth: 1,
    borderColor: '#eee',
    alignItems: 'center',
  },
  playerPosition: {
    width: 40,
    color: '#666',
  },
  playerName: {
    flex: 1,
  },
  loading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  teamName: {
    width: 80,
    textAlign: 'right',
    color: '#666',
    fontSize: 12,
  },
  draftButton: {
    backgroundColor: '#0066cc',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 4,
    marginLeft: 8,
  },
  draftButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  draftButtonDisabled: {
    backgroundColor: '#ccc',
  },
  draftButtonTextDisabled: {
    color: '#666',
  }
});