import { ThemedText } from '@/components/ThemedText';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useChampions } from '@/hooks/useLeagueHistory';
import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

interface TrophyCaseProps {
  leagueId: string;
}

export function TrophyCase({ leagueId }: TrophyCaseProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const { data: champions, isLoading } = useChampions(leagueId);

  if (isLoading) return <ActivityIndicator style={{ marginVertical: 16 }} />;

  return (
    <View style={[styles.container, { backgroundColor: c.card, borderColor: c.border }]}>
      <View style={styles.headerRow}>
        <Ionicons name="trophy" size={18} color="#FFD700" />
        <ThemedText accessibilityRole="header" type="defaultSemiBold" style={styles.title}>Trophy Case</ThemedText>
      </View>

      {!champions || champions.length === 0 ? (
        <ThemedText style={[styles.emptyText, { color: c.secondaryText }]}>
          No champions crowned yet
        </ThemedText>
      ) : (
        champions.map((entry) => (
          <View key={entry.season} style={[styles.seasonRow, { borderTopColor: c.border }]}>
            <ThemedText type="defaultSemiBold" style={styles.season}>{entry.season}</ThemedText>
            <View style={styles.resultRow}>
              <View style={[styles.champBadge, { backgroundColor: '#FFD700' + '22' }]}>
                <Ionicons name="trophy" size={12} color="#FFD700" />
                <ThemedText style={styles.champName}>{entry.champion?.name ?? '—'}</ThemedText>
              </View>
              {entry.runnerUp && (
                <ThemedText style={[styles.runnerUp, { color: c.secondaryText }]}>
                  Runner-Up: {entry.runnerUp.name}
                </ThemedText>
              )}
            </View>
          </View>
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 16,
    marginBottom: 16,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  title: { fontSize: 16 },
  emptyText: { fontSize: 13, marginTop: 8 },
  seasonRow: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 10,
    marginTop: 10,
  },
  season: { fontSize: 13, marginBottom: 6 },
  resultRow: { gap: 4 },
  champBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    alignSelf: 'flex-start',
  },
  champName: { fontSize: 14, fontWeight: '600' },
  runnerUp: { fontSize: 12, marginTop: 2 },
});
