import { supabase } from '@/lib/supabase';
import { Player } from '@/types/draft';
import { useQuery } from '@tanstack/react-query';
import { ActivityIndicator, FlatList, StyleSheet } from 'react-native';
import { ThemedText } from '../ThemedText';
import { ThemedView } from '../ThemedView';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { isEligibleForSlot, SLOT_LABELS } from '@/utils/rosterSlots';

interface TeamRosterProps {
  draftId: string;
  teamId: string;
}

type RosterSpot = {
  position: string;
  player: Player | null;
};

// Default draft roster structure — ideally this would come from league_roster_config
const DRAFT_SLOTS = [
  { position: 'G', count: 3 },
  { position: 'F', count: 3 },
  { position: 'C', count: 1 },
  { position: 'UTIL', count: 3 },
];

export function TeamRoster({ draftId, teamId }: TeamRosterProps) {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
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

  // Build roster structure from slot config
  const rosterStructure: RosterSpot[] = [];
  for (const slot of DRAFT_SLOTS) {
    for (let i = 0; i < slot.count; i++) {
      rosterStructure.push({ position: slot.position, player: null });
    }
  }

  // Fill roster spots with players using shared eligibility
  const filledRoster = rosterStructure.reduce((acc, spot) => {
    if (!players) return [...acc, spot];

    const assignedPlayerIds = acc
      .filter(s => s.player !== null)
      .map(s => s.player!.id);

    const player = players.find(p =>
      isEligibleForSlot(p.position, spot.position) &&
      !assignedPlayerIds.includes(p.id)
    );

    return [...acc, {
      ...spot,
      player: player || null
    }];
  }, [] as RosterSpot[]);

  const renderRosterSpot = ({ item }: { item: RosterSpot }) => (
    <ThemedView style={[styles.playerRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <ThemedText style={[styles.positionLabel, { color: colors.secondaryText }]}>
        {SLOT_LABELS[item.position] ?? item.position}
      </ThemedText>
      {item.player ? (
        <>
          <ThemedText style={styles.playerName}>{item.player.name}</ThemedText>
          <ThemedText style={[styles.teamName, { color: colors.secondaryText }]}>{item.player.nba_team}</ThemedText>
        </>
      ) : (
        <ThemedText style={[styles.emptySpot, { color: colors.buttonDisabled }]}>Empty</ThemedText>
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
    <ThemedView style={[styles.container, { backgroundColor: colors.background }]}>
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
  },
  listContent: {
    padding: 8,
  },
  playerRow: {
    flexDirection: 'row',
    padding: 12,
    marginVertical: 2,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
  },
  positionLabel: {
    width: 50,
    fontWeight: 'bold',
  },
  playerName: {
    flex: 1,
  },
  teamName: {
    width: 80,
    textAlign: 'right',
    fontSize: 12,
  },
  emptySpot: {
    flex: 1,
    fontStyle: 'italic',
  },
});
