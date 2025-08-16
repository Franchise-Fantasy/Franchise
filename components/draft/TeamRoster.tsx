import { supabase } from '@/lib/supabase';
import { useQuery } from '@tanstack/react-query';
import { ActivityIndicator, FlatList, StyleSheet } from 'react-native';
import { ThemedText } from '../ThemedText';
import { ThemedView } from '../ThemedView';

interface Player {
  id: string;
  name: string;
  position: string;
  nba_team: string;
}

interface TeamRosterProps {
  draftId: string;
  teamId: string;
}

type PositionSection = {
  title: string;
  data: Player[];
};

type RosterSpot = {
  position: string;
  player: Player | null;
  acceptablePositions: string[];
};

export function TeamRoster({ draftId, teamId }: TeamRosterProps) {
  const { data: players, isLoading } = useQuery<Player[] | undefined>({
    queryKey: ['teamRoster', teamId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('league_players')
        .select(`
          player_id,
          position,
          player:players (
            id,
            name,
            position,
            nba_team
          )
        `)
        .eq('team_id', teamId);

      if (error) throw error;
      return (data ?? []).map((item: any) => ({
        id: item.player.id,
        name: item.player.name,
        position: item.position,
        nba_team: item.player.nba_team
      })) as Player[];
    }
  });
console.log(players)
  // Define roster structure
  const rosterStructure: RosterSpot[] = [
    { position: 'G', player: null, acceptablePositions: ['Guard', 'Guard-Forward'] },
    { position: 'G', player: null, acceptablePositions: ['Guard', 'Guard-Forward'] },
    { position: 'F', player: null, acceptablePositions: ['Forward', 'Guard-Forward', 'Forward-Center'] },
    { position: 'F', player: null, acceptablePositions: ['Forward', 'Guard-Forward', 'Forward-Center'] },
    { position: 'C', player: null, acceptablePositions: ['Center', 'Forward-Center'] },
    { position: 'G', player: null, acceptablePositions: ['Guard', 'Guard-Forward'] },
    { position: 'F', player: null, acceptablePositions: ['Forward', 'Guard-Forward', 'Forward-Center'] },
    { position: 'UTIL', player: null, acceptablePositions: ['Guard', 'Forward', 'Center', 'Guard-Forward', 'Forward-Center'] },
    { position: 'UTIL', player: null, acceptablePositions: ['Guard', 'Forward', 'Center', 'Guard-Forward', 'Forward-Center'] },
    { position: 'UTIL', player: null, acceptablePositions: ['Guard', 'Forward', 'Center', 'Guard-Forward', 'Forward-Center'] },
  ];

  // Fill roster spots with players
  const filledRoster = rosterStructure.reduce((acc, spot) => {
    if (!players) return [...acc, spot];
    
    // Get list of already assigned players
    const assignedPlayerIds = acc
      .filter(s => s.player !== null)
      .map(s => s.player!.id);
    
    // Find first unassigned player that fits this position
    const player = players.find(p => 
      spot.acceptablePositions.includes(p.position) &&
      !assignedPlayerIds.includes(p.id)
    );

    return [...acc, {
      ...spot,
      player: player || null
    }];
  }, [] as RosterSpot[]);

  const renderRosterSpot = ({ item }: { item: RosterSpot }) => (
    <ThemedView style={styles.playerRow}>
      <ThemedText style={styles.positionLabel}>{item.position}</ThemedText>
      {item.player ? (
        <>
          <ThemedText style={styles.playerName}>{item.player.name}</ThemedText>
          <ThemedText style={styles.teamName}>{item.player.nba_team}</ThemedText>
        </>
      ) : (
        <ThemedText style={styles.emptySpot}>Empty</ThemedText>
      )}
    </ThemedView>
  );

  if (isLoading) {
    return (
      <ThemedView style={styles.container}>
        <ActivityIndicator />
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <FlatList
        data={filledRoster}
        renderItem={renderRosterSpot}
        keyExtractor={(item, index) => `${item.position}-${index}`}
        contentContainerStyle={styles.listContent}
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f8f8',
  },
  listContent: {
    padding: 8,
  },
  playerRow: {
    flexDirection: 'row',
    padding: 12,
    backgroundColor: '#fff',
    marginVertical: 2,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#eee',
    alignItems: 'center',
  },
  positionLabel: {
    width: 50,
    fontWeight: 'bold',
    color: '#666',
  },
  playerName: {
    flex: 1,
  },
  teamName: {
    width: 80,
    textAlign: 'right',
    color: '#666',
    fontSize: 12,
  },
  emptySpot: {
    flex: 1,
    color: '#999',
    fontStyle: 'italic',
  }
});