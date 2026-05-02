import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { TeamLogo } from '@/components/team/TeamLogo';
import { Badge } from '@/components/ui/Badge';
import { ThemedText } from '@/components/ui/ThemedText';
import { Brand, Fonts } from '@/constants/Colors';
import { useColors } from '@/hooks/useColors';
import { ms, s } from '@/utils/scale';

export interface ReelTeam {
  team_id: string;
  team_name: string;
  tricode: string | null;
  logo_key: string | null;
}

export interface PickCardEntry {
  team_id: string;
  team_name: string;
  original_standing: number;
  lottery_position: number;
  was_drawn: boolean;
  tricode: string | null;
  logo_key: string | null;
  /** Most-recent archived season wins. null when no archived data is available. */
  wins: number | null;
  /** Most-recent archived season losses. null when no archived data is available. */
  losses: number | null;
  /** Pre-lottery odds string for this team (e.g. "14%"). */
  odds_pct: string | null;
}

interface PickCardProps {
  pickNumber: number;
  entry: PickCardEntry;
  /** Teams to flash through during spin. Same team set the lottery drew from. */
  reelTeams: ReelTeam[];
  isRevealed: boolean;
  isSpinning: boolean;
  /** Currently-active card (next to reveal or mid-spin). Gets a subtle scale-up. */
  isHero: boolean;
  /** Pick #1 — extra haptic; parent fires confetti separately. */
  isFinalPick: boolean;
  onSpinComplete: () => void;
}

// Spin schedule: 12 fast frames at 50ms, then ramp to a 550ms final hold.
// Total ≈ 2.4s. Last frame snaps to the actual answer.
const SPIN_DELAYS = [
  50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50,
  70, 90, 120, 160, 220, 300, 400, 550,
];

export function PickCard({
  pickNumber,
  entry,
  reelTeams,
  isRevealed,
  isSpinning,
  isHero,
  isFinalPick,
  onSpinComplete,
}: PickCardProps) {
  const c = useColors();
  const [reelIndex, setReelIndex] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heroScale = useSharedValue(1);

  useEffect(() => {
    heroScale.value = withSpring(isHero ? 1.04 : 1, {
      damping: 14,
      mass: 0.5,
      stiffness: 200,
    });
  }, [isHero, heroScale]);

  useEffect(() => {
    if (!isSpinning || reelTeams.length === 0) return;

    let stepIdx = 0;
    let cancelled = false;

    setReelIndex(Math.floor(Math.random() * reelTeams.length));

    const tick = () => {
      if (cancelled) return;

      if (stepIdx >= SPIN_DELAYS.length - 1) {
        const finalIdx = reelTeams.findIndex((t) => t.team_id === entry.team_id);
        setReelIndex(finalIdx >= 0 ? finalIdx : 0);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        if (isFinalPick) {
          setTimeout(
            () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy),
            90,
          );
        }
        onSpinComplete();
        return;
      }

      setReelIndex((prev) => (prev + 1) % reelTeams.length);
      const delay = SPIN_DELAYS[stepIdx];
      stepIdx += 1;
      timerRef.current = setTimeout(tick, delay);
    };

    timerRef.current = setTimeout(tick, SPIN_DELAYS[0]);

    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [isSpinning, reelTeams, entry.team_id, isFinalPick, onSpinComplete]);

  const heroStyle = useAnimatedStyle(() => ({
    transform: [{ scale: heroScale.value }],
  }));

  const isTopPick = pickNumber === 1 && isRevealed;

  // No. 1 pick gets the on-the-clock treatment from DraftOrder — turfGreen
  // surface, ecru type, gold side-rule. Everyone else lives on the standard
  // card surface.
  const slotBg = isTopPick ? Brand.turfGreen : c.card;
  const ruleColor = isTopPick ? Brand.vintageGold : c.gold;
  const numberColor = isTopPick ? Brand.ecru : c.text;
  const teamColor = isTopPick ? Brand.ecru : c.text;
  const subColor = isTopPick ? 'rgba(233, 226, 203, 0.72)' : c.secondaryText;

  // What to show in the team slot:
  // - sealed → nothing (just the empty dot, like before)
  // - spinning → currently-cycled team
  // - revealed → the locked answer
  const reelTeam = isSpinning ? reelTeams[reelIndex] : null;
  const displayTeam = isRevealed
    ? entry
    : reelTeam ?? null;

  const accessibilityLabel = isRevealed
    ? `Pick ${pickNumber}: ${entry.team_name}${entry.was_drawn ? ', lottery winner' : ''}`
    : isSpinning
      ? `Pick ${pickNumber}, drawing`
      : `Pick ${pickNumber}, sealed`;

  return (
    <Animated.View
      style={[
        styles.slot,
        { backgroundColor: slotBg, borderColor: c.border },
        heroStyle,
      ]}
      accessibilityLabel={accessibilityLabel}
      accessibilityLiveRegion={isRevealed || isSpinning ? 'polite' : 'none'}
    >
      <View style={[styles.sideRule, { backgroundColor: ruleColor }]} />
      <ThemedText
        type="display"
        style={[styles.pickNumber, { color: numberColor }]}
      >
        {pickNumber}
      </ThemedText>

      {displayTeam ? (
        <View style={styles.teamRow}>
          <TeamLogo
            logoKey={displayTeam.logo_key}
            teamName={displayTeam.team_name}
            tricode={displayTeam.tricode ?? undefined}
            size="small"
          />
          <View style={styles.teamWrap}>
            <ThemedText
              type="defaultSemiBold"
              style={[styles.teamName, { color: teamColor }]}
              numberOfLines={1}
            >
              {displayTeam.team_name}
            </ThemedText>
            {isRevealed && (
              <ThemedText
                type="varsitySmall"
                style={[styles.standing, { color: subColor }]}
                numberOfLines={1}
              >
                Expected{' '}
                <ThemedText
                  type="varsitySmall"
                  style={[styles.standingNum, { color: teamColor }]}
                >
                  #{entry.original_standing}
                </ThemedText>
                {entry.wins != null && entry.losses != null
                  ? ` · ${entry.wins}-${entry.losses}`
                  : ''}
                {entry.odds_pct ? ' · ' : ''}
                {entry.odds_pct ? (
                  <ThemedText
                    type="varsitySmall"
                    style={[
                      styles.standingNum,
                      { color: isTopPick ? Brand.vintageGold : c.gold },
                    ]}
                  >
                    {entry.odds_pct}
                  </ThemedText>
                ) : null}
              </ThemedText>
            )}
          </View>
          {isRevealed && entry.was_drawn ? (
            <Badge label="Drawn" variant="gold" size="small" />
          ) : null}
        </View>
      ) : (
        <View style={styles.hiddenContent}>
          <View
            style={[
              styles.hiddenDot,
              { borderColor: c.border, backgroundColor: c.cardAlt },
            ]}
          />
        </View>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  slot: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: s(10),
    paddingHorizontal: s(12),
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: s(60),
    overflow: 'hidden',
  },
  sideRule: {
    width: 3,
    height: s(36),
    marginRight: s(12),
  },
  pickNumber: {
    fontFamily: Fonts.display,
    fontSize: ms(28),
    lineHeight: ms(32),
    letterSpacing: -0.4,
    minWidth: s(40),
  },
  teamRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(10),
    marginLeft: s(10),
  },
  teamWrap: {
    flex: 1,
    minWidth: 0,
  },
  teamName: {
    fontSize: ms(15),
  },
  standing: {
    fontSize: ms(10),
    letterSpacing: 1.0,
    marginTop: s(2),
  },
  standingNum: {
    fontSize: ms(10),
    letterSpacing: 1.0,
  },
  hiddenContent: {
    flex: 1,
    alignItems: 'flex-start',
    justifyContent: 'center',
    marginLeft: s(10),
  },
  hiddenDot: {
    width: s(14),
    height: s(14),
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
