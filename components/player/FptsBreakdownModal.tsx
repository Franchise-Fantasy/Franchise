import { Ionicons } from '@expo/vector-icons';
import {
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { ThemedText } from '@/components/ui/ThemedText';
import { cardShadowMedium, Fonts } from '@/constants/Colors';
import { useColors } from '@/hooks/useColors';
import { ScoringWeight } from '@/types/player';
import { ms, s } from '@/utils/scale';
import { formatScore, getFantasyPointsBreakdown } from '@/utils/scoring/fantasyPoints';

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
  const c = useColors();

  const { rows, total } = getFantasyPointsBreakdown(gameStats, scoringWeights);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity
        style={styles.overlay}
        activeOpacity={1}
        onPress={onClose}
      >
        <View
          style={[
            styles.card,
            { backgroundColor: c.card, borderColor: c.border },
          ]}
          onStartShouldSetResponder={() => true}
          accessibilityViewIsModal
        >
          <View style={[styles.topRule, { backgroundColor: c.gold }]} />

          <View style={styles.header}>
            <View style={styles.headerText}>
              <ThemedText
                type="varsitySmall"
                style={[styles.eyebrow, { color: c.gold }]}
              >
                SCORING BREAKDOWN
              </ThemedText>
              <ThemedText
                type="display"
                style={[styles.title, { color: c.text }]}
                accessibilityRole="header"
                numberOfLines={1}
              >
                {playerName}
              </ThemedText>
              <ThemedText
                style={[styles.gameLabel, { color: c.secondaryText }]}
                numberOfLines={1}
              >
                {gameLabel}
              </ThemedText>
            </View>
            <TouchableOpacity
              onPress={onClose}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityRole="button"
              accessibilityLabel="Close"
              style={styles.closeBtn}
            >
              <Ionicons name="close" size={ms(20)} color={c.secondaryText} />
            </TouchableOpacity>
          </View>

          <ScrollView
            bounces={false}
            style={styles.scrollArea}
            contentContainerStyle={styles.scrollContent}
            nestedScrollEnabled
          >
            <View style={[styles.row, styles.headerRow, { borderBottomColor: c.border }]}>
              <Text style={[styles.colStat, styles.colHeaderText, { color: c.secondaryText }]}>STAT</Text>
              <Text style={[styles.colValue, styles.colHeaderText, { color: c.secondaryText }]}>VALUE</Text>
              <Text style={[styles.colWeight, styles.colHeaderText, { color: c.secondaryText }]}>WEIGHT</Text>
              <Text style={[styles.colPoints, styles.colHeaderText, { color: c.secondaryText }]}>POINTS</Text>
            </View>

            {rows.map((r, idx) => (
              <View
                key={r.stat_name}
                style={[
                  styles.row,
                  idx < rows.length - 1 && {
                    borderBottomColor: c.border,
                    borderBottomWidth: StyleSheet.hairlineWidth,
                  },
                ]}
                accessibilityLabel={`${r.stat_name}: ${r.stat_value} times ${r.point_value} equals ${r.points}`}
              >
                <Text style={[styles.colStat, { color: c.text }]}>{r.stat_name}</Text>
                <Text style={[styles.colValue, { color: c.text }]}>{r.stat_value}</Text>
                <Text style={[styles.colWeight, { color: c.secondaryText }]}>×{r.point_value}</Text>
                <Text
                  style={[
                    styles.colPoints,
                    styles.colPointsText,
                    { color: r.points >= 0 ? c.accent : c.danger },
                  ]}
                >
                  {r.points > 0 ? '+' : ''}{formatScore(r.points)}
                </Text>
              </View>
            ))}

            <View
              style={[styles.totalRow, { borderTopColor: c.gold }]}
              accessibilityLabel={`Total: ${formatScore(total)} fantasy points`}
            >
              <Text style={[styles.totalLabel, { color: c.text }]}>TOTAL</Text>
              <Text style={[styles.totalValue, { color: c.accent }]}>
                {formatScore(total)}
              </Text>
            </View>
          </ScrollView>
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(20, 16, 16, 0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: s(20),
  },
  card: {
    borderWidth: 1,
    borderRadius: 16,
    width: '100%',
    maxWidth: s(380),
    maxHeight: '80%',
    overflow: 'hidden',
    ...cardShadowMedium,
  },
  topRule: {
    height: 3,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: s(20),
    paddingTop: s(14),
    paddingBottom: s(12),
    gap: s(10),
  },
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  eyebrow: {
    fontSize: ms(10),
    letterSpacing: 1.3,
    marginBottom: s(2),
  },
  title: {
    fontFamily: Fonts.display,
    fontSize: ms(20),
    lineHeight: ms(24),
    letterSpacing: -0.2,
  },
  gameLabel: {
    fontSize: ms(11),
    marginTop: s(2),
  },
  closeBtn: {
    padding: s(2),
    marginTop: s(2),
  },
  scrollArea: {
    flexShrink: 1,
  },
  scrollContent: {
    paddingBottom: s(8),
  },
  row: {
    flexDirection: 'row',
    paddingHorizontal: s(20),
    paddingVertical: s(10),
    alignItems: 'center',
  },
  headerRow: {
    paddingVertical: s(8),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  colHeaderText: {
    fontFamily: Fonts.varsityBold,
    fontSize: ms(9.5),
    letterSpacing: 1.2,
  },
  colStat: {
    flex: 2,
    fontSize: ms(13),
  },
  colValue: {
    flex: 1.2,
    fontSize: ms(13),
    textAlign: 'center',
  },
  colWeight: {
    flex: 1.2,
    fontSize: ms(12),
    textAlign: 'center',
  },
  colPoints: {
    flex: 1.4,
    fontSize: ms(13),
    textAlign: 'right',
  },
  colPointsText: {
    fontWeight: '600',
  },
  totalRow: {
    flexDirection: 'row',
    paddingHorizontal: s(20),
    paddingVertical: s(14),
    borderTopWidth: 2,
    alignItems: 'center',
  },
  totalLabel: {
    flex: 1,
    fontFamily: Fonts.varsityBold,
    fontSize: ms(12),
    letterSpacing: 1.4,
  },
  totalValue: {
    fontFamily: Fonts.display,
    fontSize: ms(20),
    letterSpacing: -0.2,
  },
});
