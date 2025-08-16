import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

interface Player {
  id: string;
  name: string;
  position: string;
  team: string;
  stats: string;
}

const STARTERS: Player[] = [
  { id: '1', name: 'Stephen Curry', position: 'PG', team: 'GSW', stats: '28.5 PPG, 6.2 AST' },
  { id: '2', name: 'Devin Booker', position: 'SG', team: 'PHX', stats: '26.8 PPG, 5.4 AST' },
  { id: '3', name: 'Jayson Tatum', position: 'SF', team: 'BOS', stats: '27.2 PPG, 8.1 REB' },
  { id: '4', name: 'Giannis Antetokounmpo', position: 'PF', team: 'MIL', stats: '29.3 PPG, 11.2 REB' },
  { id: '5', name: 'Joel Embiid', position: 'C', team: 'PHI', stats: '30.1 PPG, 10.4 REB' },
];

const BENCH: Player[] = [
  { id: '6', name: 'James Harden', position: 'PG', team: 'LAC', stats: '21.2 PPG, 9.8 AST' },
  { id: '7', name: 'Mikal Bridges', position: 'SF', team: 'BKN', stats: '20.4 PPG, 4.6 REB' },
  { id: '8', name: 'Evan Mobley', position: 'PF', team: 'CLE', stats: '15.8 PPG, 8.9 REB' },
  { id: '9', name: 'Brook Lopez', position: 'C', team: 'MIL', stats: '12.5 PPG, 2.4 BLK' },
];

function PlayerRow({ player }: { player: Player }) {
  return (
    <View style={styles.playerRow}>
      <View style={styles.playerInfo}>
        <ThemedText type="defaultSemiBold">{player.name}</ThemedText>
        <ThemedText style={styles.teamText}>{player.team} • {player.position}</ThemedText>
      </View>
      <ThemedText style={styles.statsText}>{player.stats}</ThemedText>
    </View>
  );
}

export default function RosterScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scrollView}>
        <View style={styles.section}>
          <ThemedText type="subtitle" style={styles.sectionTitle}>Starters</ThemedText>
          <ThemedView style={styles.sectionContent}>
            {STARTERS.map(player => (
              <PlayerRow key={player.id} player={player} />
            ))}
          </ThemedView>
        </View>

        <View style={styles.section}>
          <ThemedText type="subtitle" style={styles.sectionTitle}>Bench</ThemedText>
          <ThemedView style={styles.sectionContent}>
            {BENCH.map(player => (
              <PlayerRow key={player.id} player={player} />
            ))}
          </ThemedView>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  scrollView: {
    flex: 1,
  },
  section: {
    padding: 16,
  },
  sectionTitle: {
    marginBottom: 8,
  },
  sectionContent: {
    backgroundColor: 'white',
    borderRadius: 8,
    padding: 12,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  playerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#eee',
  },
  playerInfo: {
    flex: 1,
  },
  teamText: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },
  statsText: {
    color: '#666',
    fontSize: 13,
  },
});