import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useRouter } from 'expo-router';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { ThemedText } from '../ThemedText';
import { IconSymbol } from '../ui/IconSymbol';

const NAV_ITEMS = [
  { icon: 'chart.bar', label: 'Scoreboard', route: '/scoreboard' },
  { icon: 'arrow.triangle.2.circlepath', label: 'Trade Room', route: '/trades' },
  { icon: 'clock', label: 'Transactions', route: '/activity' },
  { icon: 'info.circle', label: 'League Info', route: '/league-info' },
] as const;

export function QuickNav() {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const router = useRouter();

  return (
    <View style={[styles.section, { backgroundColor: c.card, borderColor: c.border }]}>
      <ThemedText type="defaultSemiBold" style={styles.sectionTitle}>Quick Navigation</ThemedText>
      <View style={styles.grid}>
        {NAV_ITEMS.map(item => (
          <TouchableOpacity key={item.route} style={[styles.navItem, { backgroundColor: c.cardAlt }]} onPress={() => router.push(item.route as any)}>
            <IconSymbol name={item.icon} size={24} color={c.icon} />
            <ThemedText style={styles.label}>{item.label}</ThemedText>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 16,
    marginBottom: 16,
  },
  sectionTitle: {
    marginBottom: 12,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  navItem: {
    alignItems: 'center',
    width: '47%',
    padding: 16,
    borderRadius: 10,
  },
  label: { marginTop: 8, fontSize: 12 },
});