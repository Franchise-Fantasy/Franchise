import { StyleSheet } from 'react-native';

import { BrandButton } from '@/components/ui/BrandButton';
import { FieldGroup } from '@/components/ui/FieldGroup';
import { FormSection } from '@/components/ui/FormSection';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { SortableList } from '@/components/ui/SortableList';
import { ThemedText } from '@/components/ui/ThemedText';
import { Colors, Fonts } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { ms, s } from '@/utils/scale';

import {
  DRAFT_PHASE_OPTIONS,
  draftPhaseHelp,
  resolveDraftOrder,
  type DraftPhase,
  type ImportTeamRef,
} from './draftPhase';

// Uniform row height for the inline sortable draft-order editor.
const ROW_HEIGHT = s(46);

interface Props {
  /** Hidden entirely for non-dynasty leagues (no rookie draft / future picks). */
  isDynasty: boolean;
  /** Whether the league's rookie draft order is a lottery (vs reverse record). */
  usesLottery: boolean;
  phase: DraftPhase;
  onPhaseChange: (phase: DraftPhase) => void;
  teams: ImportTeamRef[];
  /** Number of rookie-draft rounds — a round-2 order picker shows when ≥ 2. */
  rounds: number;
  /** Ordered team keys for the phase-(b) "Order Set" round-1 draft order. */
  lotteryOrder: string[];
  onLotteryOrderChange: (order: string[]) => void;
  /** Explicit round-2 order (empty until the user diverges from the default). */
  round2Order: string[];
  onRound2OrderChange: (order: string[]) => void;
  /** Reverse-standings order from imported history — the round-2 default for
   *  lottery leagues (a lottery only sets round 1). Empty if no standings. */
  defaultRound2Order?: string[];
}

/**
 * Lets a dynasty importer declare where the league sits in its offseason:
 * pre-lottery (run the lottery/draft in-app), order-already-set (enter the
 * known order, draft in-app), or already-drafted (default — rookies are on
 * rosters). For the order-set case, an inline drag-to-reorder team list
 * captures the known draft order right in the wizard.
 */
export function DraftPhaseSelector({
  isDynasty,
  usesLottery,
  phase,
  onPhaseChange,
  teams,
  rounds,
  lotteryOrder,
  onLotteryOrderChange,
  round2Order,
  onRound2OrderChange,
  defaultRound2Order,
}: Props) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  if (!isDynasty) return null;

  const selectedIndex = DRAFT_PHASE_OPTIONS.findIndex(o => o.value === phase);
  const teamKeys = teams.map(t => t.key);
  const nameByKey = new Map(teams.map(t => [t.key, t.name]));

  // Round 1: the captured order if it still covers every team, else natural
  // team order. Round 2 falls back explicit → reverse-standings → round 1.
  const round1Keys = resolveDraftOrder([lotteryOrder], teamKeys);
  const round2Keys = resolveDraftOrder([round2Order, defaultRound2Order, round1Keys], teamKeys);
  const showRound2 = phase === 'lottery_done' && rounds >= 2;

  const renderRow = ({ item }: { item: string; index: number }) => (
    <ThemedText style={[styles.teamName, { color: c.text }]} numberOfLines={1}>
      {nameByKey.get(item) ?? item}
    </ThemedText>
  );

  // Fixed rank number — stays pinned to its slot while cards drag past it.
  const renderPickNum = (index: number) => (
    <ThemedText style={[styles.pickNum, { color: c.secondaryText }]}>{index + 1}</ThemedText>
  );

  const rowLabel = (item: string, index: number) =>
    `${nameByKey.get(item) ?? item}, pick ${index + 1}`;

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
        <FieldGroup
          label={showRound2 ? 'Round 1 Order' : 'Rookie Draft Order'}
          helperText="Pick 1 drafts first. Long-press a handle and drag to match your league's set order."
        >
          <SortableList
            data={round1Keys}
            keyExtractor={k => k}
            onReorder={onLotteryOrderChange}
            renderItem={renderRow}
            renderSlotLabel={renderPickNum}
            itemHeight={ROW_HEIGHT}
            accessibilityItemLabel={rowLabel}
          />
        </FieldGroup>
      )}

      {showRound2 && (
        <FieldGroup
          label="Round 2 Order"
          helperText={
            usesLottery
              ? 'A lottery only sets round 1 — round 2 defaults to reverse standings. Drag to adjust.'
              : 'Drag to set round 2, or copy round 1 for a straight repeating order.'
          }
        >
          <SortableList
            data={round2Keys}
            keyExtractor={k => k}
            onReorder={onRound2OrderChange}
            renderItem={renderRow}
            renderSlotLabel={renderPickNum}
            itemHeight={ROW_HEIGHT}
            accessibilityItemLabel={rowLabel}
          />
          <BrandButton
            label="Same as Round 1"
            onPress={() => onRound2OrderChange(round1Keys)}
            variant="ghost"
            size="default"
            accessibilityLabel="Set round 2 order the same as round 1"
            style={styles.sameAsBtn}
          />
        </FieldGroup>
      )}
    </FormSection>
  );
}

const styles = StyleSheet.create({
  pickNum: {
    fontFamily: Fonts.mono,
    fontSize: ms(14),
    fontWeight: '700',
    textAlign: 'center',
  },
  teamName: {
    flex: 1,
    fontSize: ms(15),
    fontWeight: '500',
  },
  sameAsBtn: {
    marginTop: s(10),
  },
});
