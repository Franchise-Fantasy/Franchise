import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { ms, s } from '@/utils/scale';
import { DynastyScoreBadge } from './DynastyScoreBadge';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

interface ProspectBoardItemProps {
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
}

export function ProspectBoardItem({
  name,
  position,
  school,
  dynastyScore,
  staffRank,
  userRank,
  drag,
  isActive,
}: ProspectBoardItemProps) {
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
      accessibilityLabel={`${name}, ${position}`}
    >
      {/* Drag handle */}
      <View style={styles.dragHandle} onTouchStart={drag}>
        <Ionicons name="reorder-three" size={20} color={c.secondaryText} />
      </View>

      {/* Name & meta */}
      <View style={styles.info}>
        <Text style={[styles.name, { color: c.text }]} numberOfLines={1}>
          {name}
        </Text>
        <Text style={[styles.meta, { color: c.secondaryText }]}>
          {position} · {school}
        </Text>
      </View>

      {/* Dynasty score */}
      {dynastyScore > 0 && <DynastyScoreBadge score={dynastyScore} />}

      {/* Staff comparison badge */}
      {comparisonIcon && staffRank !== undefined && (
        <View style={styles.comparison} accessibilityLabel={`Staff rank ${staffRank}`}>
          <Ionicons name={comparisonIcon as any} size={12} color={comparisonColor} />
          <Text style={[styles.compText, { color: comparisonColor }]}>#{staffRank}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: s(10),
    paddingHorizontal: s(8),
    marginLeft: s(4),
    marginRight: s(12),
    marginBottom: s(4),
    borderRadius: 12,
    borderWidth: 1,
    gap: s(6),
  },
  dragHandle: {
    padding: s(4),
  },
  info: {
    flex: 1,
  },
  name: {
    fontSize: ms(13),
    fontWeight: '700',
  },
  meta: {
    fontSize: ms(10),
    marginTop: 1,
  },
  comparison: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(2),
  },
  compText: {
    fontSize: ms(10),
    fontWeight: '600',
  },
});
