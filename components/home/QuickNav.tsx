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
  { icon: 'list.bullet.clipboard', label: 'Draft Hub', route: '/draft-hub' },
  { icon: 'clock', label: 'Transactions', route: '/activity' },
  { icon: 'book.fill', label: 'History', route: '/league-history' },
  { icon: 'info.circle', label: 'League Info', route: '/league-info' },
] as const;

export function QuickNav({ leagueType = 'dynasty' }: { leagueType?: string }) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const router = useRouter();
  const isDynasty = leagueType === 'dynasty';

  const visibleItems = NAV_ITEMS.filter(item => {
    if (!isDynasty && item.route === '/draft-hub') return false;
    return true;
  });

  return (
    <View style={[styles.section, { backgroundColor: c.card, borderColor: c.border }]}>
      <ThemedText type="defaultSemiBold" style={styles.sectionTitle} accessibilityRole="header">Quick Navigation</ThemedText>
      <View style={styles.grid}>
        {visibleItems.map(item => {
          const isLeagueInfo = item.route === '/league-info';
          return (
            <TouchableOpacity key={item.route} style={[styles.navItem, isLeagueInfo && styles.navItemCompact, { backgroundColor: c.cardAlt }]} onPress={() => router.push(item.route as any)} accessibilityRole="button" accessibilityLabel={item.label}>
              <IconSymbol name={item.icon} size={isLeagueInfo ? 20 : 24} color={c.icon} />
              <ThemedText style={[styles.label, isLeagueInfo && { marginTop: 0 }]}>{item.label}</ThemedText>
            </TouchableOpacity>
          );
        })}
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
  navItemCompact: {
    flexDirection: 'row',
    justifyContent: 'center',
    paddingVertical: 10,
    gap: 8,
  },
  label: { marginTop: 8, fontSize: 12 },
});