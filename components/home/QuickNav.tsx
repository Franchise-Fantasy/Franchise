import { Colors, cardShadow } from '@/constants/Colors';
import { useAppState } from '@/context/AppStateProvider';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useMyPendingTrades } from '@/hooks/useTrades';
import { ms, s } from '@/utils/scale';
import { useRouter } from 'expo-router';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { ThemedText } from '../ui/ThemedText';
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
    <View style={[styles.section, { backgroundColor: c.card, borderColor: c.border, ...cardShadow }]}>
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
            style={[styles.navItem, { backgroundColor: c.cardAlt, borderWidth: 1, borderColor: c.border + '60' }]}
            onPress={() => router.push(item.route as any)}
            activeOpacity={0.65}
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
    paddingHorizontal: s(16),
    paddingTop: s(14),
    paddingBottom: s(16),
    marginBottom: s(16),
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: s(12),
  },
  sectionTitle: {
    // no extra margin needed — headerRow handles spacing
  },
  leagueInfoPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(5),
    paddingHorizontal: s(12),
    paddingVertical: s(6),
    borderRadius: 10,
    borderWidth: 1,
  },
  leagueInfoLabel: {
    fontSize: ms(12),
    fontWeight: '600',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: s(12),
  },
  navItem: {
    alignItems: 'center',
    flexBasis: '45%',
    flexGrow: 1,
    padding: s(16),
    borderRadius: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  label: { marginTop: s(8), fontSize: ms(12) },
  badge: {
    position: 'absolute',
    top: s(-8),
    right: s(-8),
    borderRadius: 10,
    minWidth: s(20),
    height: s(20),
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: s(5),
    zIndex: 1,
  },
  badgeText: {
    fontSize: ms(11),
    fontWeight: '700',
    textAlign: 'center',
    includeFontPadding: false,
  },
});
