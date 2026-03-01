import { ThemedText } from '@/components/ThemedText';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useAllTimeRecords } from '@/hooks/useLeagueHistory';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

interface AllTimeRecordsProps {
  leagueId: string;
}

export function AllTimeRecords({ leagueId }: AllTimeRecordsProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const { data: records, isLoading } = useAllTimeRecords(leagueId);

  if (isLoading) return <ActivityIndicator style={{ marginVertical: 16 }} />;
  if (!records || records.length === 0) return null;

  return (
    <View style={[styles.container, { backgroundColor: c.card, borderColor: c.border }]}>
      <ThemedText accessibilityRole="header" type="defaultSemiBold" style={styles.title}>Record Book</ThemedText>
      <View style={styles.grid}>
        {records.map((rec, i) => (
          <View key={i} style={[styles.statCard, { backgroundColor: c.cardAlt }]}>
            <ThemedText style={[styles.statLabel, { color: c.secondaryText }]}>
              {rec.label}
            </ThemedText>
            <ThemedText type="defaultSemiBold" style={styles.statValue}>
              {rec.value}
            </ThemedText>
            <ThemedText style={[styles.statTeam, { color: c.text }]} numberOfLines={1}>
              {rec.teamName}
            </ThemedText>
            <ThemedText style={[styles.statDetail, { color: c.secondaryText }]}>
              {rec.detail}
            </ThemedText>
          </View>
        ))}
      </View>
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
  title: { fontSize: 16, marginBottom: 12 },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  statCard: {
    flexBasis: '47%',
    flexGrow: 1,
    padding: 12,
    borderRadius: 10,
  },
  statLabel: { fontSize: 11, fontWeight: '600', marginBottom: 4 },
  statValue: { fontSize: 20, marginBottom: 2 },
  statTeam: { fontSize: 12, marginBottom: 1 },
  statDetail: { fontSize: 11 },
});
