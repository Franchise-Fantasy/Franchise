import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, TouchableOpacity, View } from 'react-native';

import { FieldGroup } from '@/components/ui/FieldGroup';
import { FormSection } from '@/components/ui/FormSection';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { ThemedText } from '@/components/ui/ThemedText';
import { Colors, Fonts } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { ms, s } from '@/utils/scale';

import {
  DRAFT_PHASE_OPTIONS,
  draftPhaseHelp,
  type DraftPhase,
  type ImportTeamRef,
} from './draftPhase';

interface Props {
  /** Hidden entirely for non-dynasty leagues (no rookie draft / future picks). */
  isDynasty: boolean;
  /** Whether the league's rookie draft order is a lottery (vs reverse record). */
  usesLottery: boolean;
  phase: DraftPhase;
  onPhaseChange: (phase: DraftPhase) => void;
  teams: ImportTeamRef[];
  /** Ordered team keys for the phase-(b) "Order Set" draft order. */
  lotteryOrder: string[];
  onLotteryOrderChange: (order: string[]) => void;
}

/**
 * Lets a dynasty importer declare where the league sits in its offseason:
 * pre-draft (run the lottery/draft in-app), order-already-set (enter the
 * known order, draft in-app), or already-drafted (default — rookies are on
 * rosters). For the order-set case, an inline reorderable team list captures
 * the known draft order without a nested modal.
 */
export function DraftPhaseSelector({
  isDynasty,
  usesLottery,
  phase,
  onPhaseChange,
  teams,
  lotteryOrder,
  onLotteryOrderChange,
}: Props) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  if (!isDynasty) return null;

  const selectedIndex = DRAFT_PHASE_OPTIONS.findIndex(o => o.value === phase);

  // Display order: the captured order if it still covers every team, else the
  // teams' natural order (a sensible starting point the user then reorders).
  const orderValid =
    lotteryOrder.length === teams.length &&
    new Set(lotteryOrder).size === teams.length &&
    lotteryOrder.every(k => teams.some(t => t.key === k));
  const orderedKeys = orderValid ? lotteryOrder : teams.map(t => t.key);
  const nameByKey = new Map(teams.map(t => [t.key, t.name]));

  const move = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= orderedKeys.length) return;
    const next = [...orderedKeys];
    [next[index], next[target]] = [next[target], next[index]];
    onLotteryOrderChange(next);
  };

  return (
    <FormSection title="Draft Status">
      <FieldGroup label="Where is your league?" helperText={draftPhaseHelp(phase, usesLottery)}>
        <SegmentedControl
          options={DRAFT_PHASE_OPTIONS.map(o => o.label)}
          selectedIndex={selectedIndex < 0 ? 0 : selectedIndex}
          onSelect={i => onPhaseChange(DRAFT_PHASE_OPTIONS[i].value)}
          accessibilityLabel="League draft status"
        />
      </FieldGroup>

      {phase === 'lottery_done' && (
        <FieldGroup label="Rookie Draft Order" helperText="Pick 1 drafts first. Reorder to match your league's set order.">
          <View style={[styles.orderList, { borderColor: c.border }]}>
            {orderedKeys.map((key, index) => (
              <View
                key={key}
                style={[
                  styles.orderRow,
                  index < orderedKeys.length - 1 && { borderBottomColor: c.border, borderBottomWidth: StyleSheet.hairlineWidth },
                ]}
              >
                <ThemedText style={[styles.pickNum, { color: c.secondaryText }]}>{index + 1}</ThemedText>
                <ThemedText style={[styles.teamName, { color: c.text }]} numberOfLines={1}>
                  {nameByKey.get(key) ?? key}
                </ThemedText>
                <View style={styles.moveBtns}>
                  <TouchableOpacity
                    onPress={() => move(index, -1)}
                    disabled={index === 0}
                    hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                    accessibilityRole="button"
                    accessibilityLabel={`Move ${nameByKey.get(key) ?? key} up`}
                    style={[styles.moveBtn, index === 0 && styles.moveBtnDisabled]}
                  >
                    <Ionicons name="chevron-up" size={ms(18)} color={c.text} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => move(index, 1)}
                    disabled={index === orderedKeys.length - 1}
                    hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                    accessibilityRole="button"
                    accessibilityLabel={`Move ${nameByKey.get(key) ?? key} down`}
                    style={[styles.moveBtn, index === orderedKeys.length - 1 && styles.moveBtnDisabled]}
                  >
                    <Ionicons name="chevron-down" size={ms(18)} color={c.text} />
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </View>
        </FieldGroup>
      )}
    </FormSection>
  );
}

const styles = StyleSheet.create({
  orderList: {
    borderWidth: 1,
    borderRadius: 8,
    overflow: 'hidden',
  },
  orderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: s(8),
    paddingHorizontal: s(12),
    gap: s(10),
  },
  pickNum: {
    fontFamily: Fonts.mono,
    fontSize: ms(13),
    fontWeight: '700',
    width: s(22),
  },
  teamName: {
    flex: 1,
    fontSize: ms(14),
    fontWeight: '500',
  },
  moveBtns: {
    flexDirection: 'row',
    gap: s(4),
  },
  moveBtn: {
    padding: s(4),
  },
  moveBtnDisabled: {
    opacity: 0.25,
  },
});
