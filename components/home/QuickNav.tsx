import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useRouter } from 'expo-router';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { ThemedText } from '../ThemedText';
import { IconSymbol } from '../ui/IconSymbol';

const NAV_ITEMS = [
  { icon: 'chart.bar', label: 'Scoreboard', route: '/scoreboard' },
  { icon: 'arrow.triangle.2.circlepath', label: 'Trade Room', route: '/trades' },
  { icon: 'trophy.fill', label: 'Playoffs', route: '/playoff-bracket' },
  { icon: 'clock', label: 'Transactions', route: '/activity' },
  { icon: 'info.circle', label: 'League Info', route: '/league-info' },
] as const;

export function QuickNav() {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const router = useRouter();

  const gridItems = NAV_ITEMS.slice(0, -1);
  const lastItem = NAV_ITEMS[NAV_ITEMS.length - 1];

  return (
    <View style={[styles.section, { backgroundColor: c.card, borderColor: c.border }]}>
      <ThemedText type="defaultSemiBold" style={styles.sectionTitle}>Quick Navigation</ThemedText>
      <View style={styles.grid}>
        {gridItems.map(item => (
          <TouchableOpacity key={item.route} style={[styles.navItem, { backgroundColor: c.cardAlt }]} onPress={() => router.push(item.route as any)}>
            <IconSymbol name={item.icon} size={24} color={c.icon} />
            <ThemedText style={styles.label}>{item.label}</ThemedText>
          </TouchableOpacity>
        ))}
        <TouchableOpacity style={[styles.navItemWide, { backgroundColor: c.cardAlt }]} onPress={() => router.push(lastItem.route as any)}>
          <IconSymbol name={lastItem.icon} size={20} color={c.icon} />
          <ThemedText style={styles.labelWide}>{lastItem.label}</ThemedText>
        </TouchableOpacity>
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
    flexBasis: '45%',
    flexGrow: 1,
    padding: 16,
    borderRadius: 10,
  },
  navItemWide: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    padding: 12,
    borderRadius: 10,
  },
  label: { marginTop: 8, fontSize: 12 },
  labelWide: { marginLeft: 10, fontSize: 12 },
});