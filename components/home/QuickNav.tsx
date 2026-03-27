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
  { icon: 'clock', label: 'Transactions', route: '/activity' },
  { icon: 'calendar', label: 'Schedule', route: '/schedule' },
  { icon: 'trophy.fill', label: 'Playoffs', route: '/playoff-bracket' },
  { icon: 'list.bullet.clipboard', label: 'Draft Hub', route: '/draft-hub' },
  { icon: 'newspaper', label: 'News', route: '/news' },
  { icon: 'book.fill', label: 'History', route: '/league-history' },
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
      {/* Header row: title + League Info pill */}
      <View style={styles.headerRow}>
        <ThemedText type="defaultSemiBold" style={styles.sectionTitle} accessibilityRole="header">
          Quick Navigation
        </ThemedText>
        <TouchableOpacity
          style={[styles.leagueInfoPill, { backgroundColor: c.cardAlt, borderColor: c.border }]}
          onPress={() => router.push('/league-info' as any)}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="League Info"
        >
          <IconSymbol name="info.circle" size={14} color={c.icon} />
          <Text style={[styles.leagueInfoLabel, { color: c.text }]}>League Info</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.grid}>
        {visibleItems.map(item => (
          <TouchableOpacity
            key={item.route}
            style={[styles.navItem, { backgroundColor: c.cardAlt }]}
            onPress={() => router.push(item.route as any)}
            accessibilityRole="button"
            accessibilityLabel={item.route === '/trades' && pendingTradeCount > 0
              ? `${item.label}, ${pendingTradeCount} pending`
              : item.label}
          >
            <IconSymbol name={item.icon} size={24} color={c.icon} />
            <ThemedText style={styles.label}>{item.label}</ThemedText>
            {item.route === '/trades' && pendingTradeCount > 0 && (
              <View style={[styles.badge, { backgroundColor: c.danger }]} accessibilityElementsHidden>
                <Text style={[styles.badgeText, { color: c.statusText }]}>{pendingTradeCount}</Text>
              </View>
            )}
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
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  sectionTitle: {
    // no extra margin needed — headerRow handles spacing
  },
  leagueInfoPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
  },
  leagueInfoLabel: {
    fontSize: 12,
    fontWeight: '600',
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
  label: { marginTop: 8, fontSize: 12 },
  badge: {
    position: 'absolute',
    top: -8,
    right: -8,
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
    zIndex: 1,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'center',
    includeFontPadding: false,
  },
});
