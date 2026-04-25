import { useRouter } from 'expo-router';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { Colors } from '@/constants/Colors';
import { useAppState } from '@/context/AppStateProvider';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useMyPendingTrades } from '@/hooks/useTrades';
import { ms, s } from '@/utils/scale';

import { IconSymbol } from '../ui/IconSymbol';
import { ThemedText } from '../ui/ThemedText';

type NavItem = {
  icon: Parameters<typeof IconSymbol>[0]['name'];
  label: string;
  route: string;
};

const NAV_ITEMS: readonly NavItem[] = [
  { icon: 'chart.bar', label: 'Scores', route: '/scoreboard' },
  { icon: 'arrow.triangle.2.circlepath', label: 'Trades', route: '/trades' },
  { icon: 'clock', label: 'Activity', route: '/activity' },
  { icon: 'calendar', label: 'Schedule', route: '/schedule' },
  { icon: 'trophy.fill', label: 'Playoffs', route: '/playoff-bracket' },
  { icon: 'list.bullet.clipboard', label: 'Draft', route: '/draft-hub' },
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

  // Non-dynasty leagues hide the draft-hub tile, leaving a gappy 7-tile
  // grid. Promote the League Info pill into the grid so the last row fills.
  const gridItems: readonly NavItem[] = isDynasty
    ? visibleItems
    : [...visibleItems, { icon: 'info.circle', label: 'League Info', route: '/league-info' }];

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <View style={styles.headerLeft}>
          <View style={[styles.rule, { backgroundColor: c.gold }]} />
          <ThemedText type="sectionLabel" style={{ color: c.text }}>
            Explore
          </ThemedText>
        </View>
        {isDynasty && (
          <TouchableOpacity
            style={[styles.leagueInfoPill, { backgroundColor: c.cardAlt, borderColor: c.border }]}
            onPress={() => router.push('/league-info' as never)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="League Info"
          >
            <IconSymbol name="info.circle" size={14} color={c.gold} />
            <ThemedText type="varsitySmall" style={[styles.pillLabel, { color: c.text }]}>
              League Info
            </ThemedText>
          </TouchableOpacity>
        )}
      </View>

      <View style={[styles.grid, { backgroundColor: c.card, borderColor: c.border }]}>
        {gridItems.map(item => {
          const showPip = item.route === '/trades' && pendingTradeCount > 0;
          return (
            <TouchableOpacity
              key={item.route}
              style={[styles.tile, { borderColor: c.border }]}
              onPress={() => router.push(item.route as never)}
              activeOpacity={0.6}
              accessibilityRole="button"
              accessibilityLabel={
                showPip
                  ? `${item.label}, ${pendingTradeCount} pending`
                  : item.label
              }
            >
              <View style={styles.iconWrap}>
                <IconSymbol name={item.icon} size={22} color={c.gold} />
                {showPip && (
                  <View style={[styles.pip, { backgroundColor: c.danger }]} accessibilityElementsHidden>
                    <Text style={[styles.pipText, { color: c.statusText }]}>
                      {pendingTradeCount}
                    </Text>
                  </View>
                )}
              </View>
              <ThemedText type="varsitySmall" style={[styles.tileLabel, { color: c.text }]}>
                {item.label}
              </ThemedText>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: s(6),
    marginBottom: s(18),
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: s(10),
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(10),
  },
  rule: {
    height: 2,
    width: s(18),
  },
  leagueInfoPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(5),
    paddingHorizontal: s(10),
    paddingVertical: s(5),
    borderRadius: 8,
    borderWidth: 1,
  },
  pillLabel: {
    fontSize: ms(9.5),
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    borderWidth: 1,
    borderRadius: 14,
    overflow: 'hidden',
  },
  tile: {
    width: '25%',
    paddingVertical: s(14),
    alignItems: 'center',
    justifyContent: 'center',
    borderRightWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: s(6),
  },
  iconWrap: {
    position: 'relative',
  },
  tileLabel: {
    fontSize: ms(10),
    textAlign: 'center',
  },
  pip: {
    position: 'absolute',
    top: -s(5),
    right: -s(9),
    minWidth: s(16),
    height: s(16),
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: s(3),
  },
  pipText: {
    fontSize: ms(10),
    fontWeight: '700',
    textAlign: 'center',
    includeFontPadding: false,
  },
});
