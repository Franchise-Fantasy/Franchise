import { forwardRef, useImperativeHandle, useMemo, useState } from 'react';
import { Dimensions, StyleSheet, View } from 'react-native';
import ConfettiCannon from 'react-native-confetti-cannon';

import { Brand } from '@/constants/Colors';
import { s } from '@/utils/scale';

import type { PickCardEntry, ReelTeam } from './PickCard';
import { PickCard } from './PickCard';

interface PickListProps {
  /** Lottery-eligible teams in lottery_position order (1 = first pick). */
  results: PickCardEntry[];
  /** How many picks have been revealed so far. */
  revealedCount: number;
  /**
   * lottery_position of the card currently mid-spin, or null if no spin is
   * active. Set by the parent when "Reveal Pick #N" is tapped (or echoed
   * from broadcast); cleared by the parent in `onSpinComplete`.
   */
  spinningPosition: number | null;
  onSpinComplete: () => void;
}

export interface PickListHandle {
  fireConfetti: () => void;
}

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export const PickList = forwardRef<PickListHandle, PickListProps>(
  function PickList(
    { results, revealedCount, spinningPosition, onSpinComplete },
    ref,
  ) {
    // ConfettiCannon pre-renders all `count` pieces at the origin — visible as
    // a small cluster of dots even before firing. Mount the component only on
    // demand (and let it autoStart on mount) to keep the screen clean
    // pre-confetti.
    const [confettiKey, setConfettiKey] = useState(0);

    useImperativeHandle(ref, () => ({
      fireConfetti: () => setConfettiKey((k) => k + 1),
    }));

    // Display order: pick #1 at the TOP, pick N just above the bottom bar.
    // Reveals still progress pick N → pick #1 (highest lottery_position
    // first), so as `revealedCount` grows the bottom of the list locks in
    // first and the hero card climbs upward, climaxing on pick #1 at the top.
    const displayOrder = useMemo(
      () => [...results].sort((a, b) => a.lottery_position - b.lottery_position),
      [results],
    );

    const totalSlots = displayOrder.length;
    const reelTeams: ReelTeam[] = useMemo(
      () =>
        results.map((r) => ({
          team_id: r.team_id,
          team_name: r.team_name,
          tricode: r.tricode,
          logo_key: r.logo_key,
        })),
      [results],
    );

    return (
      <View style={styles.list} accessibilityRole="list">
        {displayOrder.map((entry, idx) => {
          const pickNumber = entry.lottery_position;
          // Ascending sort + reveals from the highest pick downward: the LAST
          // `revealedCount` items in the array are the revealed ones.
          const isRevealed = idx >= totalSlots - revealedCount;
          const isSpinning = spinningPosition === entry.lottery_position;
          // Hero = next un-revealed card (sealed, just above the locked stack)
          // OR the one currently mid-spin. Once everything is revealed, no hero.
          const isHero =
            !isRevealed &&
            (isSpinning || idx === totalSlots - 1 - revealedCount);
          const isFinalPick = pickNumber === 1;

          return (
            <PickCard
              key={entry.team_id}
              pickNumber={pickNumber}
              entry={entry}
              reelTeams={reelTeams}
              isRevealed={isRevealed}
              isSpinning={isSpinning}
              isHero={isHero}
              isFinalPick={isFinalPick}
              onSpinComplete={onSpinComplete}
            />
          );
        })}

        {confettiKey > 0 && (
          <ConfettiCannon
            key={confettiKey}
            count={140}
            origin={{ x: SCREEN_WIDTH / 2, y: -10 }}
            fadeOut
            colors={[
              Brand.vintageGold,
              Brand.turfGreen,
              Brand.ecru,
              '#F5C76A',
              '#E8E4D0',
            ]}
          />
        )}
      </View>
    );
  },
);

const styles = StyleSheet.create({
  list: {
    flex: 1,
    paddingHorizontal: s(16),
    paddingBottom: s(12),
    gap: s(8),
  },
});
