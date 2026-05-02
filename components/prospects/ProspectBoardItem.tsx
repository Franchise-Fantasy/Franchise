import { Ionicons } from '@expo/vector-icons';
import { memo, useCallback } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { ThemedText } from '@/components/ui/ThemedText';
import { Colors, Fonts, cardShadow } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { ms, s } from '@/utils/scale';

import { DynastyScoreBadge } from './DynastyScoreBadge';

interface ProspectBoardItemProps {
  /** User-rank position; rendered inside the row with the brand chrome. */
  rank: number;
  playerId: string;
  name: string;
  position: string;
  school: string;
  dynastyScore: number;
  /** Staff rank for comparison badge */
  staffRank?: number;
  /** User's current rank for this prospect (used for staff comparison) */
  userRank?: number;
  drag: () => void;
  isActive: boolean;
  /** Stable callback — receives playerId so the parent can use a single memoized handler. */
  onPressItem?: (playerId: string) => void;
}

function ProspectBoardItemBase({
  rank,
  playerId,
  name,
  position,
  school,
  dynastyScore,
  staffRank,
  userRank,
  drag,
  isActive,
  onPressItem,
}: ProspectBoardItemProps) {
  const onPress = useCallback(() => {
    onPressItem?.(playerId);
  }, [onPressItem, playerId]);
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  // Comparison badge vs staff ranking
  let comparisonIcon: string | null = null;
  let comparisonColor = c.secondaryText;
  if (staffRank !== undefined && userRank !== undefined) {
    if (userRank < staffRank) {
      comparisonIcon = 'arrow-up';
      comparisonColor = c.success;
    } else if (userRank > staffRank) {
      comparisonIcon = 'arrow-down';
      comparisonColor = c.danger;
    } else {
      comparisonIcon = 'remove-outline';
    }
  }

  return (
    <View
      style={[
        styles.row,
        { backgroundColor: isActive ? c.cardAlt : c.card, borderColor: c.border },
      ]}
      accessibilityLabel={`Rank ${rank}, ${name}, ${position}`}
    >
      {/* Drag handle */}
      <View style={styles.dragHandle} onTouchStart={drag}>
        <Ionicons name="reorder-three" size={20} color={c.secondaryText} />
      </View>

      {/* Rank — Alfa Slab + thin gold side-rule (matches ProspectCard / pick rows) */}
      <View style={styles.rankCol}>
        <View style={[styles.rankRule, { backgroundColor: c.gold }]} />
        <Text style={[styles.rank, { color: c.text }]}>{rank}</Text>
      </View>

      {/* Tappable area — opens prospect detail */}
      <TouchableOpacity
        style={styles.tappable}
        onPress={onPress}
        disabled={!onPress}
        accessibilityRole="button"
        accessibilityLabel={`View ${name} profile`}
      >
        {/* Name & meta */}
        <View style={styles.info}>
          <Text style={[styles.name, { color: c.text }]} numberOfLines={1}>
            {name}
          </Text>
          <View style={styles.metaRow}>
            <ThemedText
              type="varsitySmall"
              style={[styles.position, { color: c.gold }]}
            >
              {position}
            </ThemedText>
            <Text style={[styles.metaDot, { color: c.secondaryText }]}>·</Text>
            <Text
              style={[styles.metaTail, { color: c.secondaryText }]}
              numberOfLines={1}
            >
              {school}
            </Text>
          </View>
        </View>

        {/* Dynasty score */}
        {dynastyScore > 0 && <DynastyScoreBadge score={dynastyScore} />}

        {/* Staff comparison badge — mono numeric for tabular feel */}
        {comparisonIcon && staffRank !== undefined && (
          <View style={styles.comparison} accessibilityLabel={`Staff rank ${staffRank}`}>
            <Ionicons name={comparisonIcon as any} size={12} color={comparisonColor} />
            <Text style={[styles.compText, { color: comparisonColor }]}>#{staffRank}</Text>
          </View>
        )}
      </TouchableOpacity>
    </View>
  );
}

export const ProspectBoardItem = memo(ProspectBoardItemBase);

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: s(10),
    paddingHorizontal: s(8),
    marginHorizontal: s(12),
    marginBottom: s(6),
    borderRadius: 12,
    borderWidth: 1,
    gap: s(8),
    ...cardShadow,
  },
  dragHandle: {
    padding: s(4),
  },
  rankCol: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(8),
  },
  rankRule: {
    width: 3,
    height: s(20),
  },
  rank: {
    fontFamily: Fonts.display,
    fontSize: ms(18),
    lineHeight: ms(22),
    letterSpacing: -0.3,
    minWidth: s(20),
    textAlign: 'left',
  },
  tappable: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(8),
  },
  info: {
    flex: 1,
    minWidth: 0,
  },
  name: {
    fontSize: ms(14),
    fontWeight: '700',
    letterSpacing: -0.1,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(5),
    marginTop: s(2),
  },
  position: {
    fontSize: ms(10),
    letterSpacing: 1.4,
  },
  metaDot: { fontSize: ms(10) },
  metaTail: {
    fontSize: ms(11),
    flexShrink: 1,
  },
  comparison: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(2),
  },
  compText: {
    fontFamily: Fonts.mono,
    fontSize: ms(10),
    letterSpacing: 0.3,
  },
});
