import { supabase } from '@/lib/supabase';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, TouchableOpacity } from 'react-native';
import { ThemedText } from '../ThemedText';
import { ThemedView } from '../ThemedView';

interface Player {
  id: string;
  api_id: number;
  name: string;
  position: string;
  nba_team: string;
}

interface AvailablePlayersProps {
  draftId: string;
  leagueId: string; // Add leagueId prop
  currentPick: { id: string; current_team_id: string } | null;
  teamId: string;
}

const formatPosition = (position: string): string => {
  switch (position.toLowerCase()) {
    case 'guard':
      return 'G';
    case 'forward':
      return 'F';
    case 'center':
      return 'C';
    case 'guard-forward':
    case 'forward-guard':
      return 'G/F';
    case 'forward-center':
    case 'center-forward':
      return 'F/C';
    default:
      return position;
  }
};

export function AvailablePlayers({ draftId, leagueId, currentPick, teamId }: AvailablePlayersProps) {
  const queryClient = useQueryClient();
  const isMyTurn = currentPick?.current_team_id === teamId;

  const lastPlayersRef = useRef<Player[] | undefined>(undefined);

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

  // Use useEffect to update lastPlayersRef on data change
  useEffect(() => {
    if (players && players.length > 0) {
      lastPlayersRef.current = players;
    }
  }, [players]);
  

  const handleDraft = async (player: Player) => {
    if (!currentPick) return;

    // Optimistically remove the player from the list
    queryClient.setQueryData(['availablePlayers', leagueId], (old: Player[] | undefined) =>
      old ? old.filter(p => p.id !== player.id) : []
    );

    try {
      // Run both mutations in parallel
      const [draftPickResult, leaguePlayerResult] = await Promise.all([
        supabase
          .from('draft_picks')
          .update({ 
            player_id: player.id,
            selected_at: new Date().toISOString()
          })
          .eq('id', currentPick.id),
        supabase
          .from('league_players')
          .insert({
            league_id: leagueId,
            player_id: player.id,
            team_id: currentPick.current_team_id,
            acquired_via: 'draft',
            acquired_at: new Date().toISOString(),
            position: player.position
          })
      ]);

      if (draftPickResult.error) throw draftPickResult.error;
      if (leaguePlayerResult.error) throw leaguePlayerResult.error;

      // Optionally, refetch in the background for sync
      // Slightly delayed invalidate to let Supabase process insert

  queryClient.invalidateQueries({ queryKey: ['availablePlayers', leagueId] });


    } catch (error) {
      // Rollback: refetch the list if something failed
      queryClient.invalidateQueries({ queryKey: ['availablePlayers', leagueId] });
      console.error('Error drafting player:', error);
    }
  };

  const renderPlayer = ({ item }: { item: Player }) => (
    <TouchableOpacity style={styles.playerRow}>
      <ThemedText style={styles.playerPosition}>
        {formatPosition(item.position)}
      </ThemedText>
      <ThemedText style={styles.playerName}>{item.name}</ThemedText>
      <TouchableOpacity 
        style={[
          styles.draftButton,
          !isMyTurn && styles.draftButtonDisabled
        ]}
        onPress={() => handleDraft(item)}
        disabled={!isMyTurn}
      >
        <ThemedText style={[
          styles.draftButtonText,
          !isMyTurn && styles.draftButtonTextDisabled
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