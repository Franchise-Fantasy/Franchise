import { Colors } from '@/constants/Colors';
import { useAppState } from '@/context/AppStateProvider';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useMyPendingTrades } from '@/hooks/useTrades';
import { useRouter } from 'expo-router';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
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
  const { teamId, leagueId } = useAppState();
  const { data: pendingTradeCount = 0 } = useMyPendingTrades(teamId, leagueId);

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
            <TouchableOpacity
              key={item.route}
              style={[styles.navItem, isLeagueInfo && styles.navItemCompact, { backgroundColor: c.cardAlt }]}
              onPress={() => router.push(item.route as any)}
              accessibilityRole="button"
              accessibilityLabel={item.route === '/trades' && pendingTradeCount > 0
                ? `${item.label}, ${pendingTradeCount} pending`
                : item.label}
            >
              <IconSymbol name={item.icon} size={isLeagueInfo ? 20 : 24} color={c.icon} />
              <ThemedText style={[styles.label, isLeagueInfo && { marginTop: 0 }]}>{item.label}</ThemedText>
              {item.route === '/trades' && pendingTradeCount > 0 && (
                <View style={styles.badge} accessibilityElementsHidden>
                  <Text style={styles.badgeText}>{pendingTradeCount}</Text>
                </View>
              )}
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
  badge: {
    position: 'absolute',
    top: -8,
    right: -8,
    backgroundColor: '#e53935',
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
    zIndex: 1,
  },
  badgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'center',
    includeFontPadding: false,
  },
});