import { ThemedText } from '@/components/ThemedText';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useAllTimeRecords } from '@/hooks/useLeagueHistory';
import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, TouchableOpacity, View } from 'react-native';

interface AllTimeRecordsProps {
  leagueId: string;
}

export function AllTimeRecords({ leagueId }: AllTimeRecordsProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const { data: records, isLoading } = useAllTimeRecords(leagueId);
  const [expanded, setExpanded] = useState(false);

  if (isLoading) return <ActivityIndicator style={{ marginVertical: 16 }} />;
  if (!records || records.length === 0) return null;

  return (
    <View style={[styles.container, { backgroundColor: c.card, borderColor: c.border }]}>
      <TouchableOpacity
        style={styles.header}
        onPress={() => setExpanded((prev) => !prev)}
        accessibilityRole="button"
        accessibilityLabel="Record Book"
        accessibilityState={{ expanded }}
      >
        <Ionicons name="trophy-outline" size={20} color={c.icon} accessible={false} />
        <ThemedText type="defaultSemiBold" style={styles.title}>Record Book</ThemedText>
        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={c.secondaryText}
          accessible={false}
        />
      </TouchableOpacity>

      {expanded && (
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  title: { flex: 1, fontSize: 14 },
  grid: {
    marginTop: 12,
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
