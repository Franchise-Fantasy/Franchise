import { ReactNode, useEffect, useMemo, useState } from 'react';
import { LayoutChangeEvent, StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { ThemedText } from '@/components/ui/ThemedText';
import { Brand, Fonts } from '@/constants/Colors';
import { TickerEvent, TickerEventKind } from '@/hooks/useMatchupTickerEvents';
import { ScoringWeight } from '@/types/player';
import { ms, s } from '@/utils/scale';

interface MatchupTickerProps {
  events: TickerEvent[];
  scoring: ScoringWeight[];
  /** Copy shown when there are no events. Caller decides — depends on
   *  whether the selected day is today, future, or out-of-TTL past. */
  emptyText?: string;
  /** Category leagues have no per-stat point values, so the fpts pill
   *  resolves to +0.0 on every chip — meaningless noise. Hide it. */
  hideFpts?: boolean;
}

// Marquee speed. Tuned to feel "live ticker" rather than "stock crawl" —
// fast enough to read but not so fast you can't catch a name as it passes.
const SCROLL_SPEED_PX_PER_SEC = 38;

/**
 * Approximates the fantasy-points contribution of a single ticker event by
 * multiplying the implied stat changes through the league's scoring
 * weights. We don't track misses (FGA / FTA on a miss), so the value is a
 * lower bound — that matches user intuition that a make should always
 * register positively.
 */
function fptsForEvent(
  kind: TickerEventKind,
  value: number,
  scoring: ScoringWeight[],
): number {
  const w = (name: string) =>
    scoring.find((s) => s.stat_name === name)?.point_value ?? 0;
  switch (kind) {
    case 'MADE_3PT':
      // 3pt make moves PTS+3, 3PM+1, 3PA+1, FGM+1, FGA+1
      return value * (w('PTS') * 3 + w('3PM') + w('3PA') + w('FGM') + w('FGA'));
    case 'MADE_2PT':
      return value * (w('PTS') * 2 + w('FGM') + w('FGA'));
    case 'MADE_FT':
      return value * (w('PTS') + w('FTM') + w('FTA'));
    case 'MISSED_3PT':
      // Miss only increments the attempt counters
      return value * (w('FGA') + w('3PA'));
    case 'MISSED_2PT':
      return value * w('FGA');
    case 'MISSED_FT':
      return value * w('FTA');
    case 'REB':
      return value * w('REB');
    case 'AST':
      return value * w('AST');
    case 'STL':
      return value * w('STL');
    case 'BLK':
      return value * w('BLK');
    case 'TOV':
      return value * w('TO');
    case 'PF':
      return value * w('PF');
    case 'DD':
      return w('DD');
    case 'TD':
      // A TD always implies a DD, so the bonus stack mirrors how
      // calculateGameFantasyPoints treats double_double + triple_double.
      return w('DD') + w('TD');
    default:
      return 0;
  }
}

function actionLabel(kind: TickerEventKind, value: number): string {
  switch (kind) {
    case 'MADE_3PT':   return value > 1 ? `MADE ${value} 3-PT`    : 'MADE 3-PT';
    case 'MADE_2PT':   return value > 1 ? `MADE ${value} 2-PT`    : 'MADE 2-PT';
    case 'MADE_FT':    return value > 1 ? `MADE ${value} FT`      : 'MADE FT';
    case 'MISSED_3PT': return value > 1 ? `MISSED ${value} 3-PT`  : 'MISSED 3-PT';
    case 'MISSED_2PT': return value > 1 ? `MISSED ${value} 2-PT`  : 'MISSED 2-PT';
    case 'MISSED_FT':  return value > 1 ? `MISSED ${value} FT`    : 'MISSED FT';
    case 'REB':        return value > 1 ? `${value} REB`          : 'REBOUND';
    case 'AST':        return value > 1 ? `${value} AST`          : 'ASSIST';
    case 'STL':        return value > 1 ? `${value} STL`          : 'STEAL';
    case 'BLK':        return value > 1 ? `${value} BLK`          : 'BLOCK';
    case 'TOV':        return value > 1 ? `${value} TO`           : 'TURNOVER';
    case 'PF':         return value > 1 ? `${value} FOULS`        : 'FOUL';
    case 'DD':         return 'DOUBLE-DOUBLE';
    case 'TD':         return 'TRIPLE-DOUBLE';
    default:           return kind;
  }
}

function relativeTime(iso: string, now: number): string {
  const diffSec = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  const min = Math.floor(diffSec / 60);
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  return `${h}h ago`;
}

/**
 * Auto-scrolling recap band for the matchup hero. Renders the events twice
 * back-to-back inside an animated row that translates left at a constant
 * speed — when the first copy slides off, the second copy is already in
 * position so the loop is seamless. Falls back to a static row when the
 * content fits the visible track.
 */
export function MatchupTicker({
  events,
  scoring,
  emptyText = 'NO GAMES STARTED YET',
  hideFpts = false,
}: MatchupTickerProps) {
  const [now, setNow] = useState(() => Date.now());
  const [singleCopyWidth, setSingleCopyWidth] = useState(0);
  const [trackWidth, setTrackWidth] = useState(0);
  const translateX = useSharedValue(0);

  // Refresh relative time labels every 10s so "Xs ago" actually counts
  // for fresh events. The whole component re-renders, but it's a tight
  // marquee — cheap enough to keep the labels honest. Without this the
  // first 30s of a new event's life all read as "0s ago".
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(t);
  }, []);

  // Marquee math. We need enough copies of `rendered` end-to-end that
  // "one cycle" (the distance we translate before looping) covers the
  // full track width — otherwise the duplicate copy ends up visible
  // alongside the original, which reads as the same stat appearing
  // twice on screen. With short content (1–2 events), padFactor grows
  // so each visible window only ever sees the marquee's "first half".
  const padFactor = useMemo(() => {
    if (singleCopyWidth <= 0 || trackWidth <= 0) return 1;
    return Math.max(1, Math.ceil(trackWidth / singleCopyWidth));
  }, [singleCopyWidth, trackWidth]);
  const copies = padFactor * 2;
  const cycleWidth = singleCopyWidth * padFactor;

  useEffect(() => {
    cancelAnimation(translateX);
    if (cycleWidth <= 0) {
      translateX.value = 0;
      return;
    }
    const duration = (cycleWidth / SCROLL_SPEED_PX_PER_SEC) * 1000;
    translateX.value = 0;
    translateX.value = withRepeat(
      withTiming(-cycleWidth, { duration, easing: Easing.linear }),
      -1,
      false,
    );
    return () => cancelAnimation(translateX);
  }, [cycleWidth, translateX]);

  // Points-league filter: drop events whose computed fpts is 0 — e.g. a
  // foul in a league that doesn't score PF, or a missed FT in a league
  // that doesn't count attempts. Those are visual noise on the recap
  // tape. Category leagues skip the filter (no point values exist) and
  // show every play.
  const rendered = useMemo(() => {
    const out: {
      id: string;
      name: string;
      fptsStr: string;
      fptsNeg: boolean;
      action: string;
      ago: string;
    }[] = [];
    for (const e of events) {
      const fpts = hideFpts
        ? 0
        : Math.round(fptsForEvent(e.kind, e.value, scoring) * 10) / 10;
      if (!hideFpts && fpts === 0) continue;
      const fptsStr = fpts > 0 ? `+${fpts.toFixed(1)}` : fpts.toFixed(1);
      out.push({
        id: e.id,
        name: e.player_name.toUpperCase(),
        fptsStr,
        fptsNeg: fpts < 0,
        action: actionLabel(e.kind, e.value),
        ago: relativeTime(e.occurred_at, now),
      });
    }
    return out;
  }, [events, scoring, now, hideFpts]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  const a11yLabel = rendered.length > 0
    ? `Recap: ${rendered
        .map((r) =>
          hideFpts
            ? `${r.name} ${r.action} ${r.ago}`
            : `${r.name} ${r.fptsStr} ${r.action} ${r.ago}`,
        )
        .join(', ')}`
    : `Recap: ${emptyText.toLowerCase()}`;

  const renderEventChip = (
    r: typeof rendered[number],
    key: string,
  ): ReactNode => (
    <View key={key} style={styles.eventChip}>
      <ThemedText type="varsity" style={styles.name} numberOfLines={1}>
        {r.name}
      </ThemedText>
      {!hideFpts && (
        <ThemedText style={[styles.fpts, r.fptsNeg && styles.fptsNeg]}>
          {r.fptsStr}
        </ThemedText>
      )}
      <ThemedText style={styles.action} numberOfLines={1}>
        {r.action}
      </ThemedText>
      <ThemedText style={styles.ago} numberOfLines={1}>
        {r.ago}
      </ThemedText>
      <View style={styles.dot} />
    </View>
  );

  return (
    <View
      style={styles.bar}
      accessibilityRole="text"
      accessibilityLabel={a11yLabel}
    >
      <View style={styles.recapChip}>
        <ThemedText type="varsity" style={styles.recapText}>
          RECAP
        </ThemedText>
      </View>
      <View
        style={styles.track}
        pointerEvents="none"
        onLayout={(e: LayoutChangeEvent) => setTrackWidth(e.nativeEvent.layout.width)}
      >
        {rendered.length === 0 ? (
          <ThemedText
            type="varsitySmall"
            style={styles.emptyText}
            numberOfLines={1}
          >
            {emptyText}
          </ThemedText>
        ) : (
          <>
            {/* Hidden measurer — renders one copy of the events to
                determine singleCopyWidth, used by padFactor to size the
                visible ribbon. Absolutely positioned + opacity 0 so it
                doesn't affect layout or draw. */}
            <View
              style={[styles.row, styles.measurer]}
              pointerEvents="none"
              onLayout={(e: LayoutChangeEvent) =>
                setSingleCopyWidth(e.nativeEvent.layout.width)
              }
            >
              {rendered.map((r, idx) => renderEventChip(r, `m-${r.id}-${idx}`))}
            </View>
            <Animated.View style={[styles.row, animatedStyle]}>
              {Array.from({ length: copies })
                .flatMap((_, copyIdx) =>
                  rendered.map((r, idx) => ({ r, key: `${copyIdx}-${r.id}-${idx}` })),
                )
                .map(({ r, key }) => renderEventChip(r, key))}
            </Animated.View>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'stretch',
    height: ms(28),
    // Pull the band edge-to-edge across the hero card AND consume the
    // card's paddingBottom so the bar bleeds into the rounded bottom edge.
    // The hero's `overflow: hidden` + `borderRadius: 16` clip the bottom
    // corners cleanly to the card's curve. Horizontal margin must match
    // the hero card's paddingHorizontal (currently s(10)).
    marginHorizontal: s(-10),
    marginTop: s(10),
    marginBottom: s(-8),
    backgroundColor: 'rgba(20, 16, 16, 0.55)',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(181, 123, 48, 0.45)',
    overflow: 'hidden',
  },
  recapChip: {
    paddingHorizontal: s(10),
    justifyContent: 'center',
    backgroundColor: Brand.vintageGold,
  },
  recapText: {
    color: Brand.ink,
    fontSize: ms(10),
    letterSpacing: 1.0,
  },
  track: {
    flex: 1,
    overflow: 'hidden',
    justifyContent: 'center',
    paddingLeft: s(10),
  },
  emptyText: {
    color: Brand.ecruMuted,
    fontSize: ms(9),
    letterSpacing: 1.0,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  measurer: {
    position: 'absolute',
    top: 0,
    left: 0,
    opacity: 0,
  },
  eventChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(6),
    paddingRight: s(10),
  },
  name: {
    color: Brand.ecru,
    fontSize: ms(10),
    letterSpacing: 0.6,
  },
  fpts: {
    color: '#7CD083',
    fontFamily: Fonts.mono,
    fontSize: ms(10),
    fontWeight: '700',
  },
  fptsNeg: {
    color: '#E55353',
  },
  action: {
    color: Brand.ecru,
    fontFamily: Fonts.mono,
    fontSize: ms(9),
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  ago: {
    color: Brand.ecruMuted,
    fontFamily: Fonts.mono,
    fontSize: ms(9),
    letterSpacing: 0.3,
  },
  dot: {
    width: 3,
    height: 3,
    borderRadius: 2,
    backgroundColor: 'rgba(181, 123, 48, 0.55)',
    marginLeft: s(8),
  },
});
