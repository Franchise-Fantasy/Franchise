import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { Colors, Fonts } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { ms, s } from '@/utils/scale';

interface ProspectMovementBadgeProps {
  /** prospect_board.rank_change: >0 rose, <0 fell, 0 steady, null/undefined = new. */
  rankChange?: number | null;
  size?: 'small' | 'large';
}

/**
 * Week-over-week rank movement pill for the consensus board.
 * Green ▲ N (riser), red ▼ N (faller), steady dash, or a gold "NEW" badge for
 * a prospect appearing on the board for the first time.
 */
export function ProspectMovementBadge({ rankChange, size = 'small' }: ProspectMovementBadgeProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const isLarge = size === 'large';
  const iconSize = isLarge ? 14 : 11;

  // null/undefined → brand-new to the board.
  if (rankChange == null) {
    return (
      <View
        style={[styles.pill, isLarge && styles.pillLarge, { backgroundColor: c.gold }]}
        accessibilityLabel="New to the board"
      >
        <Text style={[styles.text, isLarge && styles.textLarge, { color: '#fff' }]}>NEW</Text>
      </View>
    );
  }

  if (rankChange === 0) {
    return (
      <View
        style={styles.steady}
        accessibilityLabel="Rank unchanged this week"
      >
        <Ionicons name="remove-outline" size={iconSize} color={c.secondaryText} />
      </View>
    );
  }

  const rose = rankChange > 0;
  const color = rose ? c.success : c.danger;
  const magnitude = Math.abs(rankChange);

  return (
    <View
      style={styles.movement}
      accessibilityLabel={`${rose ? 'Up' : 'Down'} ${magnitude} ${magnitude === 1 ? 'spot' : 'spots'} this week`}
    >
      <Ionicons name={rose ? 'caret-up' : 'caret-down'} size={iconSize} color={color} />
      <Text style={[styles.moveText, isLarge && styles.textLarge, { color }]}>{magnitude}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    paddingHorizontal: s(7),
    paddingVertical: s(2),
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillLarge: {
    paddingHorizontal: s(12),
    paddingVertical: s(5),
    borderRadius: 10,
  },
  text: {
    fontFamily: Fonts.mono,
    fontSize: ms(9),
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  textLarge: {
    fontSize: ms(14),
  },
  steady: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  movement: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(1),
  },
  moveText: {
    fontFamily: Fonts.mono,
    fontSize: ms(11),
    fontWeight: '700',
    letterSpacing: 0.2,
  },
});
