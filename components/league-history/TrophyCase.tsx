import { ThemedText } from '@/components/ui/ThemedText';
import { Colors, cardShadow } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useChampions } from '@/hooks/useLeagueHistory';
import { ms, s } from '@/utils/scale';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';
import { LogoSpinner } from '@/components/ui/LogoSpinner';

interface TrophyCaseProps {
  leagueId: string;
}

export function TrophyCase({ leagueId }: TrophyCaseProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const { data: champions, isLoading } = useChampions(leagueId);

  if (isLoading) return <View style={{ marginVertical: 16 }}><LogoSpinner /></View>;

  return (
    <View style={[styles.container, { backgroundColor: c.card, borderColor: c.border }]}>
      <View style={styles.headerRow}>
        <Ionicons name="trophy" size={18} color={c.gold} />
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
              <View style={[styles.champBadge, { backgroundColor: c.goldMuted }]}>
                <Ionicons name="trophy" size={12} color={c.gold} />
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
    padding: s(16),
    marginBottom: s(16),
    ...cardShadow,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(8),
    marginBottom: s(4),
  },
  title: { fontSize: ms(16) },
  emptyText: { fontSize: ms(13), marginTop: s(8) },
  seasonRow: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: s(10),
    marginTop: s(10),
  },
  season: { fontSize: ms(13), marginBottom: s(6) },
  resultRow: { gap: s(4) },
  champBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(6),
    paddingHorizontal: s(8),
    paddingVertical: s(4),
    borderRadius: 6,
    alignSelf: 'flex-start',
  },
  champName: { fontSize: ms(14), fontWeight: '600' },
  runnerUp: { fontSize: ms(12), marginTop: s(2) },
});
