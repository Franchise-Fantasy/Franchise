import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { ms, s } from '@/utils/scale';
import { ScoringWeight } from '@/types/player';
import { getFantasyPointsBreakdown, formatScore } from '@/utils/fantasyPoints';
import {
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

interface FptsBreakdownModalProps {
  visible: boolean;
  onClose: () => void;
  playerName: string;
  gameLabel: string;
  gameStats: Record<string, number | boolean>;
  scoringWeights: ScoringWeight[];
}

export function FptsBreakdownModal({
  visible,
  onClose,
  playerName,
  gameLabel,
  gameStats,
  scoringWeights,
}: FptsBreakdownModalProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const isDark = scheme === 'dark';

  const { rows, total } = getFantasyPointsBreakdown(gameStats, scoringWeights);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity
        style={styles.modalOverlay}
        activeOpacity={1}
        onPress={onClose}
      >
        <View
          style={[
            styles.modalCard,
            {
              backgroundColor: isDark ? '#1C1C1E' : '#FFFFFF',
              borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)',
            },
          ]}
          onStartShouldSetResponder={() => true}
        >
          {/* Header */}
          <View style={styles.modalHeader}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.modalTitle, { color: c.text }]} numberOfLines={1}>
                {playerName}
              </Text>
              <Text style={[styles.gameLabel, { color: c.secondaryText }]}>{gameLabel}</Text>
            </View>
            <TouchableOpacity
              onPress={onClose}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <Text style={{ color: c.secondaryText, fontSize: ms(16) }}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView bounces={false} style={styles.scrollArea} nestedScrollEnabled>
            {/* Column headers */}
            <View style={[styles.row, styles.headerRow, { borderBottomColor: c.border }]}>
              <Text style={[styles.colStat, styles.colHeaderText, { color: c.secondaryText }]}>Stat</Text>
              <Text style={[styles.colValue, styles.colHeaderText, { color: c.secondaryText }]}>Value</Text>
              <Text style={[styles.colWeight, styles.colHeaderText, { color: c.secondaryText }]}>Weight</Text>
              <Text style={[styles.colPoints, styles.colHeaderText, { color: c.secondaryText }]}>Points</Text>
            </View>

            {/* Stat rows */}
            {rows.map((r) => (
              <View
                key={r.stat_name}
                style={[styles.row, { borderBottomColor: c.border }]}
                accessibilityLabel={`${r.stat_name}: ${r.stat_value} times ${r.point_value} equals ${r.points}`}
              >
                <Text style={[styles.colStat, { color: c.text }]}>{r.stat_name}</Text>
                <Text style={[styles.colValue, { color: c.text }]}>{r.stat_value}</Text>
                <Text style={[styles.colWeight, { color: c.secondaryText }]}>×{r.point_value}</Text>
                <Text style={[styles.colPoints, { color: r.points >= 0 ? c.accent : c.danger, fontWeight: '600' }]}>
                  {r.points > 0 ? '+' : ''}{formatScore(r.points)}
                </Text>
              </View>
            ))}

            {/* Total row */}
            <View style={[styles.row, styles.totalRow]} accessibilityLabel={`Total: ${formatScore(total)} fantasy points`}>
              <Text style={[styles.colStat, styles.totalText, { color: c.text }]}>Total</Text>
              <Text style={styles.colValue} />
              <Text style={styles.colWeight} />
              <Text style={[styles.colPoints, styles.totalText, { color: c.accent }]}>{formatScore(total)}</Text>
            </View>
          </ScrollView>
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: s(20),
  },
  modalCard: {
    borderWidth: 1,
    borderRadius: 16,
    width: '100%',
    maxWidth: s(360),
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: s(16),
    paddingBottom: s(12),
  },
  modalTitle: {
    fontSize: ms(16),
    fontWeight: '700',
  },
  gameLabel: {
    fontSize: ms(13),
    marginTop: s(2),
  },
  scrollArea: {},
  row: {
    flexDirection: 'row',
    paddingHorizontal: s(16),
    paddingVertical: s(10),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerRow: {
    paddingVertical: s(6),
  },
  colHeaderText: {
    fontSize: ms(11),
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  totalRow: {
    borderBottomWidth: 0,
    paddingTop: s(14),
    paddingBottom: s(16),
  },
  totalText: {
    fontSize: ms(15),
    fontWeight: '700',
  },
  colStat: {
    flex: 2,
    fontSize: ms(14),
  },
  colValue: {
    flex: 1.5,
    fontSize: ms(14),
    textAlign: 'center',
  },
  colWeight: {
    flex: 1.5,
    fontSize: ms(14),
    textAlign: 'center',
  },
  colPoints: {
    flex: 1.5,
    fontSize: ms(14),
    textAlign: 'right',
  },
});
