import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';

import { colStyles } from '@/components/matchup/matchupStyles';
import { pStyles } from '@/components/matchup/PlayerCell';
import { SectionEyebrow } from '@/components/roster/SectionEyebrow';
import { useColors } from '@/hooks/useColors';
import { ms, s } from '@/utils/scale';

// ─── Skeleton primitives ─────────────────────────────────────────────────────

export function SkeletonBlock({ width, height, color, style }: { width: number | string; height: number; color: string; style?: any }) {
  const opacity = useRef(new Animated.Value(0.4)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.4, duration: 700, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);
  return <Animated.View style={[{ width: width as any, height, borderRadius: 4, backgroundColor: color, opacity }, style]} />;
}

// ─── Body skeleton ───────────────────────────────────────────────────────────
// Roster-shaped placeholder rendered while the matchup data is loading.
// Reserves the same vertical space as the live MatchupBoard so the screen
// holds its layout instead of jumping when the data resolves. Counts default
// to a sane fantasy lineup (10 starters + 4 bench) when rosterConfig hasn't
// loaded yet — the precise count doesn't matter as long as the body is the
// right rough size.

interface MatchupBoardSkeletonProps {
  starterCount?: number;
  benchCount?: number;
}

export function MatchupBoardSkeleton({
  starterCount = 10,
  benchCount = 4,
}: MatchupBoardSkeletonProps) {
  const c = useColors();

  const renderRow = (key: string, idx: number, isLast: boolean) => (
    <View
      key={key}
      style={[
        pStyles.slotRow,
        { borderBottomColor: c.border },
        idx % 2 === 1 && { backgroundColor: c.cardAlt },
        isLast && { borderBottomWidth: 0 },
      ]}
    >
      <SkeletonCell c={c} side="left" />
      <View
        style={[
          colStyles.slotPill,
          {
            backgroundColor: c.cardAlt,
            borderColor: c.border,
            opacity: 0.4,
          },
        ]}
      />
      <SkeletonCell c={c} side="right" />
    </View>
  );

  return (
    <View>
      <View style={colStyles.sectionWrap}>
        <SectionEyebrow label="STARTERS" />
        <View
          style={[
            colStyles.card,
            { backgroundColor: c.card, borderColor: c.border },
          ]}
        >
          {Array.from({ length: starterCount }).map((_, i) =>
            renderRow(`s-${i}`, i, i === starterCount - 1),
          )}
        </View>
      </View>
      {benchCount > 0 && (
        <View style={colStyles.sectionWrap}>
          <SectionEyebrow label="BENCH" />
          <View
            style={[
              colStyles.card,
              { backgroundColor: c.card, borderColor: c.border },
            ]}
          >
            {Array.from({ length: benchCount }).map((_, i) =>
              renderRow(`b-${i}`, i, i === benchCount - 1),
            )}
          </View>
        </View>
      )}
    </View>
  );
}

// One side of a slot row: headshot circle + three stacked bars matching the
// three text lines of a PlayerCell (name, meta/matchup, stats+fpts). Heights
// and gaps mirror pStyles in PlayerCell.tsx so each row settles at the same
// height as the live row when data resolves — no layout shift.
function SkeletonCell({ c, side }: { c: ReturnType<typeof useColors>; side: 'left' | 'right' }) {
  const align = side === 'left' ? 'flex-end' : 'flex-start';
  return (
    <View style={[skelStyles.cell, { flexDirection: side === 'left' ? 'row' : 'row-reverse' }]}>
      <View style={[skelStyles.headshot, { backgroundColor: c.cardAlt }]} />
      <View style={[skelStyles.textCol, { alignItems: align }]}>
        <View style={[skelStyles.bar, skelStyles.line1, { width: s(76), backgroundColor: c.cardAlt }]} />
        <View style={[skelStyles.bar, skelStyles.line2, { width: s(52), backgroundColor: c.cardAlt }]} />
        <View style={[skelStyles.bar, skelStyles.line3, { width: s(64), backgroundColor: c.cardAlt }]} />
      </View>
    </View>
  );
}

const skelStyles = StyleSheet.create({
  cell: {
    flex: 1,
    alignItems: 'center',
    gap: s(6),
  },
  // Same diameter and circular shape as pStyles.headshotCircle so the
  // skeleton row matches the live row's footprint.
  headshot: {
    width: s(38),
    height: s(38),
    borderRadius: s(19),
    opacity: 0.5,
  },
  textCol: {
    flex: 1,
    paddingHorizontal: s(4),
    justifyContent: 'center',
  },
  bar: {
    borderRadius: 3,
    opacity: 0.5,
  },
  // Heights mirror pStyles line-heights from PlayerCell so the three
  // stacked bars sum to the same vertical space as the live cell.
  line1: { height: ms(12) },           // name (lineHeight ms(14))
  line2: { height: ms(11), marginTop: s(3) },  // meta/chip (lineHeight ms(13))
  line3: { height: ms(14), marginTop: s(3) },  // stats + fpts (lineHeight ms(16))
});
