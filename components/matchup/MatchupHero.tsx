import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { ReactNode, useEffect, useRef } from "react";
import {
  Animated,
  Dimensions,
  Easing,
  PanResponder,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { ThemedText } from "@/components/ui/ThemedText";
import { Brand, Fonts } from "@/constants/Colors";
import { useColors } from "@/hooks/useColors";
import { ms, s } from "@/utils/scale";

const PATCH_SOURCE = require("../../assets/images/patch_logo.png");

const TAP_SLOP = { top: 8, bottom: 8, left: 8, right: 8 };

// Horizontal swipe distance that commits a matchup change. Tuned to feel
// intentional — too small and a stray sideways drift jumps the user
// off the matchup they're reading. A high-velocity flick also commits
// regardless of distance.
const SWIPE_COMMIT_PX = 60;
const SWIPE_COMMIT_VX = 0.5;
const SCREEN_WIDTH = Dimensions.get("window").width;
// How far off-screen the card travels during the slide-out leg. A bit
// past the screen edge so the card fully clears even on devices where
// the safe-area math nudges the visible width inward.
const SLIDE_DISTANCE = SCREEN_WIDTH + s(40);
const SLIDE_OUT_MS = 180;
const SLIDE_IN_MS = 200;

export interface HeroTeam {
  teamId: string;
  teamName: string;
  tricode: string | null;
  logoKey: string | null;
  wins: number;
  losses: number;
  ties: number;
  weekScore: number;
  dayScore: number;
}

export interface MatchupHeroProps {
  selectedDate: string;
  today: string;
  isPastDate: boolean;
  isToday: boolean;
  dayLabel: string;

  currentWeek:
    | {
        week_number: number;
        start_date: string;
        end_date: string;
        is_playoff: boolean;
      }
    | null;
  /** Short opening-night label (e.g. "Jun 6"), set ONLY when the schedule
   *  exists but the selected day is before the first week starts. Swaps the
   *  eyebrow's "OFFSEASON" for "UPCOMING" and the empty body for a tip-off
   *  prompt so the pre-season gap reads as "season's set" rather than dead. */
  seasonOpensLabel?: string;
  weekIsLive: boolean;

  leftTeam: HeroTeam | null;
  rightTeam: HeroTeam | null;
  leftSeed?: number;
  rightSeed?: number;

  isCategories: boolean;
  /** Live H2H category tally for the displayed matchup. Drives the hero's
   *  focal number in category leagues (where there's no fpts score). Null
   *  on bye weeks or before data resolves. */
  categoryRecord?: { leftWins: number; rightWins: number; ties: number } | null;

  weeklyLimit?: number | null;
  leftAdds?: number;
  rightAdds?: number;

  /** When true, render the score block as a skeleton placeholder instead of
   *  the "No matchup for this date" empty copy. Lets the screen reserve hero
   *  height during the cold-load window so nothing flashes/shifts. */
  isLoading?: boolean;

  liveActivitySupported?: boolean;
  liveActivityActive?: boolean;
  liveActivityHighlighted?: boolean;
  onGoLive?: () => void;

  onPrevDay: () => void;
  onNextDay: () => void;
  /** Switch to the previous matchup in the league carousel. Undefined when
   *  there's no other matchup to swipe to (single-matchup week). */
  onPrevMatchup?: () => void;
  /** Switch to the next matchup in the league carousel. */
  onNextMatchup?: () => void;
  onGoToToday: () => void;
  onSchedulePress?: () => void;
  onSummaryPress?: () => void;
  onTeamPress?: (teamId: string) => void;
  onAcqInfoPress?: () => void;

  /** Ticker rendered between the score block and the action chips.
   *  Owned by the screen so it can wire its own data dependency. */
  tickerSlot?: ReactNode;

  canGoBack: boolean;
}

function formatRecord(t: HeroTeam | null): string {
  if (!t) return "";
  return t.ties > 0
    ? `${t.wins}-${t.losses}-${t.ties}`
    : `${t.wins}-${t.losses}`;
}

function formatScore(n: number): string {
  return n.toFixed(2);
}

/**
 * Brand hero for the matchup tab. Three bands stack inside the
 * heroSurface card:
 *   1. Eyebrow — `● WK 1 ▸` (taps to open the weekly summary; live red
 *                dot replaces the word LIVE) / date dropdown / TODAY +
 *                GO LIVE + ACQ chips
 *   2. Body    — two-column stacked scoreboard flanked by ‹ › day arrows
 *   3. Ticker  — recap tape (rendered via tickerSlot, bleeds into the
 *                card's rounded bottom edge)
 *
 * Day-by-day navigation is the side chevrons in the body (or the date
 * dropdown opening the WeekScheduleModal). The horizontal swipe gesture
 * cycles between OTHER matchups in the league — current card slides
 * off-screen with a subtle scale/opacity dip, the next matchup snaps
 * in from the opposite edge. Wraps at the ends so the carousel feels
 * continuous.
 */
export function MatchupHero({
  selectedDate,
  today,
  isPastDate,
  isToday,
  dayLabel,
  currentWeek,
  seasonOpensLabel,
  weekIsLive,
  leftTeam,
  rightTeam,
  leftSeed,
  rightSeed,
  isCategories,
  categoryRecord,
  weeklyLimit,
  leftAdds,
  rightAdds,
  liveActivitySupported,
  liveActivityActive,
  liveActivityHighlighted,
  onGoLive,
  onPrevDay,
  onNextDay,
  onPrevMatchup,
  onNextMatchup,
  onGoToToday,
  onSchedulePress,
  onSummaryPress,
  onTeamPress,
  onAcqInfoPress,
  tickerSlot,
  canGoBack,
  isLoading,
}: MatchupHeroProps) {
  const c = useColors();
  const isFutureDate = selectedDate > today;

  // Status word dropped — the live red dot covers LIVE, and the date
  // itself gives enough context for upcoming / final / tonight states.
  const playoffPrefix = currentWeek?.is_playoff ? "PLAYOFFS · " : "";
  const weekChip = currentWeek
    ? `${playoffPrefix}WK ${currentWeek.week_number}`
    : seasonOpensLabel
      ? "UPCOMING"
      : "OFFSEASON";

  // Always render the day-total sub-line for points leagues. Each column
  // handles a null team itself (renders a spacer to preserve height) so
  // we don't need to gate the whole thing on both teams existing — that
  // gated it off on bye weeks and during placeholder transitions into
  // past weeks where one side hadn't resolved yet.
  const showDayTotals = !isCategories;

  // Label under each score is always "TODAY" — the eyebrow above already
  // shows the selected date, so repeating the weekday here is redundant.
  const dayBadge = "TODAY";

  // "Leading" drives the gold focal-score highlight. Categories compare the
  // win tally; points compare the week score.
  const myLeading = isCategories
    ? !!categoryRecord && categoryRecord.leftWins > categoryRecord.rightWins
    : !!leftTeam && !!rightTeam && leftTeam.weekScore > rightTeam.weekScore;
  const oppLeading = isCategories
    ? !!categoryRecord && categoryRecord.rightWins > categoryRecord.leftWins
    : !!leftTeam && !!rightTeam && rightTeam.weekScore > leftTeam.weekScore;

  // ── Swipe-to-navigate-matchups ──────────────────────────────────────
  // Animates the hero card off-screen, swaps to the next/prev matchup,
  // then snaps in from the opposite edge. PanResponder reads the latest
  // callbacks via refs so it doesn't need to be reconstructed on every
  // render (constructing a fresh PanResponder mid-gesture would drop
  // the in-flight gesture).
  const onPrevMatchupRef = useRef(onPrevMatchup);
  const onNextMatchupRef = useRef(onNextMatchup);
  useEffect(() => { onPrevMatchupRef.current = onPrevMatchup; }, [onPrevMatchup]);
  useEffect(() => { onNextMatchupRef.current = onNextMatchup; }, [onNextMatchup]);

  const translateX = useRef(new Animated.Value(0)).current;
  const isAnimating = useRef(false);

  // Slight scale + opacity dip as the card moves away from center makes
  // it read as receding into depth, like a card being pulled off a deck
  // rather than slid flat across the screen.
  const cardScale = translateX.interpolate({
    inputRange: [-SCREEN_WIDTH, 0, SCREEN_WIDTH],
    outputRange: [0.92, 1, 0.92],
    extrapolate: "clamp",
  });
  const cardOpacity = translateX.interpolate({
    inputRange: [-SCREEN_WIDTH, 0, SCREEN_WIDTH],
    outputRange: [0.35, 1, 0.35],
    extrapolate: "clamp",
  });

  const commitSwipe = (direction: "next" | "prev") => {
    const cb =
      direction === "next" ? onNextMatchupRef.current : onPrevMatchupRef.current;
    if (!cb) {
      Animated.spring(translateX, {
        toValue: 0,
        useNativeDriver: true,
        bounciness: 4,
      }).start();
      return;
    }
    isAnimating.current = true;
    const exitTo = direction === "next" ? -SLIDE_DISTANCE : SLIDE_DISTANCE;
    const enterFrom = -exitTo;
    Animated.timing(translateX, {
      toValue: exitTo,
      duration: SLIDE_OUT_MS,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      // Swap matchup data, then animate the new content in from the
      // opposite side. The data update flushes synchronously before
      // the next animation frame, so the slide-in carries the new
      // matchup's content (assuming it's prefetched — see matchup.tsx).
      cb();
      translateX.setValue(enterFrom);
      Animated.timing(translateX, {
        toValue: 0,
        duration: SLIDE_IN_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start(() => {
        isAnimating.current = false;
      });
    });
  };

  const panResponder = useRef(
    PanResponder.create({
      // Use the capture phase so we can steal from child TouchableOpacities
      // (date dropdown, action chips, team links) once the finger commits
      // to a clear horizontal motion. Below the 14px threshold taps still
      // hit their intended target.
      onMoveShouldSetPanResponderCapture: (_, gs) => {
        if (isAnimating.current) return false;
        return Math.abs(gs.dx) > 14 && Math.abs(gs.dy) < 18;
      },
      onPanResponderTerminationRequest: () => false,
      onPanResponderMove: (_, gs) => {
        if (isAnimating.current) return;
        // Light edge-resistance when there's no matchup to swipe to in
        // that direction (single-matchup weeks, or eventually a non-
        // wrapping mode). With wrapping enabled at the parent both
        // callbacks are always defined, so this is mostly a safety net.
        const canPrev = !!onPrevMatchupRef.current;
        const canNext = !!onNextMatchupRef.current;
        let dx = gs.dx;
        if ((dx > 0 && !canPrev) || (dx < 0 && !canNext)) dx = dx * 0.3;
        translateX.setValue(dx);
      },
      onPanResponderRelease: (_, gs) => {
        if (isAnimating.current) return;
        const flick = Math.abs(gs.vx) >= SWIPE_COMMIT_VX;
        if ((gs.dx <= -SWIPE_COMMIT_PX || (flick && gs.vx < 0)) && onNextMatchupRef.current) {
          commitSwipe("next");
        } else if (
          (gs.dx >= SWIPE_COMMIT_PX || (flick && gs.vx > 0)) &&
          onPrevMatchupRef.current
        ) {
          commitSwipe("prev");
        } else {
          Animated.spring(translateX, {
            toValue: 0,
            useNativeDriver: true,
            bounciness: 4,
          }).start();
        }
      },
      onPanResponderTerminate: () => {
        if (isAnimating.current) return;
        Animated.spring(translateX, {
          toValue: 0,
          useNativeDriver: true,
          bounciness: 4,
        }).start();
      },
    }),
  ).current;

  return (
    <Animated.View
      style={[
        styles.card,
        { backgroundColor: c.heroSurface },
        c.heroShadow,
        {
          transform: [{ translateX }, { scale: cardScale }],
          opacity: cardOpacity,
        },
      ]}
      {...panResponder.panHandlers}
      accessibilityHint={
        onNextMatchup || onPrevMatchup
          ? "Swipe left or right to view other matchups in your league"
          : undefined
      }
    >
      <Image
        source={PATCH_SOURCE}
        style={styles.patch}
        contentFit="contain"
        cachePolicy="memory-disk"
        transition={0}
        accessible={false}
      />
      <View style={styles.topRule} />

      {/* ── Eyebrow ─ summary chip / date / chips ──────────────────────── */}
      <View style={styles.eyebrowRow}>
        <View style={styles.eyebrowLeft}>
          <TouchableOpacity
            style={[styles.summaryChip, !onSummaryPress && styles.chipDisabled]}
            onPress={onSummaryPress}
            disabled={!onSummaryPress}
            activeOpacity={0.7}
            hitSlop={TAP_SLOP}
            accessibilityRole={onSummaryPress ? "button" : undefined}
            accessibilityLabel={
              onSummaryPress
                ? `Open week ${currentWeek?.week_number ?? ""} summary`
                : undefined
            }
          >
            {weekIsLive && <View style={styles.liveDot} />}
            <Text style={styles.summaryChipText} numberOfLines={1}>
              {weekChip}
            </Text>
            {onSummaryPress && (
              <Ionicons
                name="stats-chart"
                size={ms(11)}
                color={Brand.vintageGold}
                style={styles.summaryChipIcon}
              />
            )}
          </TouchableOpacity>
          {/* Return-to-today chip on the LEFT when on a future date —
              icon-only return arrow keeps the eyebrow tight. The chip's
              position (left of the centered date) already communicates
              direction. The flex spacer pushes the chip to the inner edge
              so it hugs the centered date rather than the card edge. */}
          {!isToday && isFutureDate && (
            <>
              <View style={styles.eyebrowSpacer} />
              <TouchableOpacity
                onPress={onGoToToday}
                style={styles.todayIconChip}
                hitSlop={TAP_SLOP}
                accessibilityRole="button"
                accessibilityLabel="Jump to today"
              >
                <Ionicons
                  name="arrow-undo-outline"
                  size={ms(14)}
                  color={Brand.vintageGold}
                />
              </TouchableOpacity>
            </>
          )}
        </View>

        <TouchableOpacity
          style={styles.eyebrowCenter}
          onPress={onSchedulePress}
          disabled={!onSchedulePress}
          activeOpacity={0.7}
          hitSlop={TAP_SLOP}
          accessibilityRole="button"
          accessibilityLabel={`${dayLabel}${
            currentWeek
              ? `, Week ${currentWeek.week_number}`
              : seasonOpensLabel
                ? `, season opens ${seasonOpensLabel}`
                : ", outside season"
          }`}
          accessibilityHint={
            onSchedulePress ? "Opens week schedule picker" : undefined
          }
        >
          <ThemedText
            type="varsity"
            style={styles.eyebrowDate}
            numberOfLines={1}
          >
            {dayLabel.toUpperCase()}
          </ThemedText>
          {onSchedulePress && (
            <Ionicons
              name="chevron-down"
              size={ms(12)}
              color={Brand.ecruMuted}
              style={styles.dateCaret}
            />
          )}
        </TouchableOpacity>

        <View style={styles.eyebrowRight}>
          {/* Return-to-today chip on the RIGHT when on a past date —
              chip is rendered at the inner edge (close to the centered
              date) and the spacer pushes the action chips to the far
              edge. */}
          {!isToday && !isFutureDate && (
            <>
              <TouchableOpacity
                onPress={onGoToToday}
                style={styles.todayIconChip}
                hitSlop={TAP_SLOP}
                accessibilityRole="button"
                accessibilityLabel="Jump to today"
              >
                <Ionicons
                  name="arrow-redo-outline"
                  size={ms(14)}
                  color={Brand.vintageGold}
                />
              </TouchableOpacity>
              <View style={styles.eyebrowSpacer} />
            </>
          )}
          {liveActivitySupported && onGoLive && (
            <TouchableOpacity
              onPress={onGoLive}
              style={[
                styles.acqChip,
                liveActivityActive && styles.goLiveActive,
                liveActivityHighlighted && styles.goLiveHighlighted,
              ]}
              hitSlop={TAP_SLOP}
              accessibilityRole="button"
              accessibilityLabel={
                liveActivityActive
                  ? "Stop Live Activity"
                  : "Start Live Activity on Dynamic Island"
              }
            >
              <View
                style={[
                  styles.goLiveDot,
                  liveActivityActive && styles.goLiveDotActive,
                ]}
              />
              <Text style={styles.acqChipText}>
                {liveActivityActive ? "LIVE" : "GO LIVE"}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* ── Body ─ score block flanked by day-nav arrows ───────────────── */}
      <View style={styles.bodyRow}>
        <TouchableOpacity
          onPress={onPrevDay}
          disabled={!canGoBack}
          style={[styles.bodyArrow, !canGoBack && styles.bodyArrowDisabled]}
          hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
          accessibilityRole="button"
          accessibilityLabel="Previous day"
          accessibilityState={{ disabled: !canGoBack }}
        >
          <Text style={styles.bodyArrowText}>‹</Text>
        </TouchableOpacity>
        <View style={styles.bodyBlock}>
          {leftTeam ? (
            <ScoreBlock
              leftTeam={leftTeam}
              rightTeam={rightTeam}
              leftSeed={leftSeed}
              rightSeed={rightSeed}
              myLeading={myLeading}
              oppLeading={oppLeading}
              weekIsLive={weekIsLive}
              isCategories={isCategories}
              categoryRecord={categoryRecord}
              showDayTotals={showDayTotals}
              dayBadge={dayBadge}
              onTeamPress={onTeamPress}
            />
          ) : isLoading ? (
            <ScoreBlockSkeleton />
          ) : (
            <View style={styles.emptyBody}>
              <ThemedText
                style={[styles.emptyBodyText, { color: Brand.ecruMuted }]}
              >
                {seasonOpensLabel
                  ? `Season opens ${seasonOpensLabel}. Tap › to view Week 1.`
                  : "No matchup for this date."}
              </ThemedText>
            </View>
          )}
        </View>
        <TouchableOpacity
          onPress={onNextDay}
          style={styles.bodyArrow}
          hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
          accessibilityRole="button"
          accessibilityLabel="Next day"
        >
          <Text style={styles.bodyArrowText}>›</Text>
        </TouchableOpacity>
      </View>

      {/* ── ACQ band ─ usage chips for both teams above the ticker.
          Reserved as soon as the league has a weekly limit, even before
          team data resolves, so the hero height doesn't shift on load. */}
      {weeklyLimit != null && (
        <View style={styles.acqBand}>
          <TouchableOpacity
            style={styles.acqBandSlot}
            onPress={onAcqInfoPress}
            disabled={!onAcqInfoPress || !leftTeam}
            hitSlop={TAP_SLOP}
            accessibilityRole={onAcqInfoPress && leftTeam ? "button" : undefined}
            accessibilityLabel={
              leftTeam
                ? `${leftAdds ?? 0} of ${weeklyLimit} weekly acquisitions used`
                : undefined
            }
          >
            {leftTeam && (
              <Text style={styles.acqChipText}>
                ACQ {leftAdds ?? 0}/{weeklyLimit}
              </Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.acqBandSlot, styles.acqBandSlotRight]}
            onPress={onAcqInfoPress}
            disabled={!onAcqInfoPress || !rightTeam}
            hitSlop={TAP_SLOP}
            accessibilityRole={onAcqInfoPress && rightTeam ? "button" : undefined}
            accessibilityLabel={
              rightTeam
                ? `${rightAdds ?? 0} of ${weeklyLimit} weekly acquisitions used`
                : undefined
            }
          >
            {rightTeam && (
              <Text style={styles.acqChipText}>
                ACQ {rightAdds ?? 0}/{weeklyLimit}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      )}

      {/* ── Ticker ─ recap tape (last band of the hero) ────────────────────
          `marginTop: auto` pins the tape to the card's bottom edge even when
          the content above is shorter than the card's minHeight (e.g. when
          the league has no weekly acquisition limit, so the ACQ band above
          is hidden). Without this the card's minHeight leaves a gap below
          the ticker that the ticker's negative bottom margin can't consume. */}
      {tickerSlot && <View style={styles.tickerSlot}>{tickerSlot}</View>}
    </Animated.View>
  );
}

// Skeleton scoreboard — same dimensions as the live ScoreBlock so the
// hero card holds its height during the cold-load window. No shimmer,
// just dim ecru placeholder bars that read as "still loading" without
// distracting from the eyebrow chips above.
function ScoreBlockSkeleton() {
  return (
    <View style={styles.scoreRow}>
      <View style={[styles.scoreColumn, styles.colAlignLeft]}>
        <View style={[styles.metaTopRow, styles.alignSelfRight]}>
          <View style={[skeletonStyles.bar, { width: s(36), height: ms(13) }]} />
          <View style={[skeletonStyles.bar, { width: s(22), height: ms(11) }]} />
        </View>
        <View
          style={[
            skeletonStyles.bar,
            styles.alignSelfRight,
            { width: s(70), height: ms(40), marginTop: s(3) },
          ]}
        />
        <View
          style={[
            skeletonStyles.bar,
            styles.alignSelfRight,
            { width: s(46), height: ms(9), marginTop: s(3) },
          ]}
        />
      </View>
      <View style={styles.colDivider} />
      <View style={[styles.scoreColumn, styles.colAlignRight]}>
        <View style={[styles.metaTopRow, styles.alignSelfLeft]}>
          <View style={[skeletonStyles.bar, { width: s(22), height: ms(11) }]} />
          <View style={[skeletonStyles.bar, { width: s(36), height: ms(13) }]} />
        </View>
        <View
          style={[
            skeletonStyles.bar,
            styles.alignSelfLeft,
            { width: s(70), height: ms(40), marginTop: s(3) },
          ]}
        />
        <View
          style={[
            skeletonStyles.bar,
            styles.alignSelfLeft,
            { width: s(46), height: ms(9), marginTop: s(3) },
          ]}
        />
      </View>
    </View>
  );
}

const skeletonStyles = StyleSheet.create({
  bar: {
    backgroundColor: "rgba(233, 226, 203, 0.12)",
    borderRadius: 3,
  },
});

interface ScoreBlockProps {
  leftTeam: HeroTeam;
  rightTeam: HeroTeam | null;
  leftSeed?: number;
  rightSeed?: number;
  myLeading: boolean;
  oppLeading: boolean;
  weekIsLive: boolean;
  isCategories: boolean;
  categoryRecord?: { leftWins: number; rightWins: number; ties: number } | null;
  showDayTotals: boolean;
  dayBadge: string;
  onTeamPress?: (teamId: string) => void;
}

/**
 * Two-column stacked scoreboard. Each side reads as a single block:
 *
 *   CUN 0-0          0-0 SPO
 *      47.8         39.2
 *   12.4 TODAY      8.1 TODAY
 *
 * Tricode + record sit on a small meta line above the focal score, with
 * the day total tucked underneath as the sub-line. A thin centered rule
 * separates the two columns instead of a "·" between scores.
 */
function ScoreBlock({
  leftTeam,
  rightTeam,
  leftSeed,
  rightSeed,
  myLeading,
  oppLeading,
  weekIsLive,
  isCategories,
  categoryRecord,
  showDayTotals,
  dayBadge,
  onTeamPress,
}: ScoreBlockProps) {
  const colorFor = (leading: boolean) =>
    leading ? Brand.vintageGold : weekIsLive ? Brand.ecruMuted : Brand.ecru;

  const leftDisplay =
    leftTeam.tricode ?? leftTeam.teamName?.slice(0, 4)?.toUpperCase() ?? "ME";
  const rightDisplay = rightTeam
    ? (rightTeam.tricode ?? rightTeam.teamName?.slice(0, 4)?.toUpperCase() ?? "OPP")
    : "BYE";

  // The focal number + sub-line differ by scoring type. Categories show the
  // team's category-win tally with the full W–L–T record beneath; points show
  // the week score with the day total beneath.
  const tieSuffix =
    categoryRecord && categoryRecord.ties > 0 ? `-${categoryRecord.ties}` : "";
  const leftFocal = isCategories
    ? categoryRecord
      ? String(categoryRecord.leftWins)
      : null
    : formatScore(leftTeam.weekScore);
  const rightFocal = isCategories
    ? categoryRecord
      ? String(categoryRecord.rightWins)
      : null
    : rightTeam
      ? formatScore(rightTeam.weekScore)
      : null;
  const leftSub = isCategories
    ? categoryRecord
      ? `${categoryRecord.leftWins}-${categoryRecord.rightWins}${tieSuffix} CATS`
      : null
    : showDayTotals
      ? `${formatScore(leftTeam.dayScore)} ${dayBadge}`
      : null;
  const rightSub = isCategories
    ? categoryRecord
      ? `${categoryRecord.rightWins}-${categoryRecord.leftWins}${tieSuffix} CATS`
      : null
    : showDayTotals && rightTeam
      ? `${formatScore(rightTeam.dayScore)} ${dayBadge}`
      : null;

  return (
    <View style={styles.scoreRow}>
      <ScoreColumn
        side="left"
        team={leftTeam}
        display={leftDisplay}
        seed={leftSeed}
        leading={myLeading}
        colorFor={colorFor}
        focal={leftFocal}
        sub={leftSub}
        onTeamPress={onTeamPress}
      />
      <View style={styles.colDivider} />
      <ScoreColumn
        side="right"
        team={rightTeam}
        display={rightDisplay}
        seed={rightSeed}
        leading={oppLeading}
        colorFor={colorFor}
        focal={rightFocal}
        sub={rightSub}
        onTeamPress={onTeamPress}
      />
    </View>
  );
}

interface ScoreColumnProps {
  side: "left" | "right";
  team: HeroTeam | null;
  display: string;
  seed?: number;
  leading: boolean;
  colorFor: (leading: boolean) => string;
  /** Big focal number (week score or category-win tally). Null renders the
   *  "—" placeholder (BYE / cold load). */
  focal: string | null;
  /** Small sub-line under the focal number (day total or category record).
   *  Null reserves the line's height with a spacer. */
  sub: string | null;
  onTeamPress?: (teamId: string) => void;
}

function ScoreColumn({
  side,
  team,
  display,
  seed,
  leading,
  colorFor,
  focal,
  sub,
  onTeamPress,
}: ScoreColumnProps) {
  // Column anchors the meta row (tri + record) to the OUTER edge so the
  // tricode hugs the card edge — but the score and today sub-line break
  // alignment and pull toward the INNER edge (the divider) so the two
  // scores sit close together in the visual middle of the card.
  const colAlign = side === "left" ? styles.colAlignLeft : styles.colAlignRight;
  const innerAlign =
    side === "left" ? styles.alignSelfRight : styles.alignSelfLeft;

  const metaOrder = side === "left"
    ? [
        seed != null ? <ThemedText key="seed" style={styles.seedText}>#{seed}</ThemedText> : null,
        <ThemedText key="tri" type="varsity" style={styles.tri} numberOfLines={1}>{display}</ThemedText>,
        team ? <ThemedText key="rec" style={styles.recordInline} numberOfLines={1}>{formatRecord(team)}</ThemedText> : null,
      ]
    : [
        team ? <ThemedText key="rec" style={styles.recordInline} numberOfLines={1}>{formatRecord(team)}</ThemedText> : null,
        <ThemedText key="tri" type="varsity" style={styles.tri} numberOfLines={1}>{display}</ThemedText>,
        seed != null ? <ThemedText key="seed" style={styles.seedText}>#{seed}</ThemedText> : null,
      ];

  return (
    <TouchableOpacity
      style={[styles.scoreColumn, colAlign]}
      onPress={() => team && onTeamPress?.(team.teamId)}
      activeOpacity={0.6}
      disabled={!onTeamPress || !team}
      accessibilityRole={onTeamPress && team ? "link" : undefined}
      accessibilityLabel={team ? `View ${team.teamName} roster` : "BYE"}
    >
      <View style={[styles.metaTopRow, innerAlign]}>{metaOrder}</View>
      {focal != null && team ? (
        <ThemedText
          style={[styles.bigScore, innerAlign, { color: colorFor(leading) }]}
        >
          {focal}
        </ThemedText>
      ) : (
        <ThemedText style={[styles.bigScorePlaceholder, innerAlign]}>—</ThemedText>
      )}
      {sub != null && team ? (
        <ThemedText
          type="varsitySmall"
          style={[styles.todayLine, innerAlign]}
          numberOfLines={1}
        >
          {sub}
        </ThemedText>
      ) : (
        <View style={styles.todayLineSpacer} />
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    position: "relative",
    marginHorizontal: s(12),
    marginTop: s(8),
    marginBottom: s(8),
    borderRadius: 16,
    // Matches the roster hero's card inset so the eyebrow's gold bar + WK
    // chip + date dropdown line up across the two pages.
    paddingHorizontal: s(14),
    paddingTop: s(10),
    paddingBottom: s(8),
    overflow: "hidden",
    // Reserve total hero height so the card doesn't shrink during the
    // cold-load window (no score block, ACQ band, or team meta yet) and
    // then jump taller when data resolves. Sized for the loaded state:
    // eyebrow + score block + ACQ band + ticker.
    minHeight: s(180),
  },
  topRule: {
    position: "absolute",
    top: 0,
    left: s(14),
    height: 3,
    width: s(36),
    backgroundColor: Brand.vintageGold,
  },
  patch: {
    position: "absolute",
    right: s(-22),
    bottom: s(-28),
    width: s(130),
    height: s(130),
    opacity: 0.14,
  },

  // ── Eyebrow row ──────────────────────────────────────────────────────
  eyebrowRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: s(6),
    minHeight: ms(22),
  },
  eyebrowLeft: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: s(5),
  },
  eyebrowCenter: {
    flexShrink: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: s(4),
    paddingHorizontal: s(6),
  },
  eyebrowRight: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: s(5),
  },
  // Flex spacer used inside the eyebrow zones to push the TODAY chip
  // toward the inner edge (next to the centered date) instead of the
  // outer edge of the card.
  eyebrowSpacer: {
    flex: 1,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#E55353",
  },
  eyebrowDate: {
    color: Brand.ecru,
    fontSize: ms(11),
    letterSpacing: 1.1,
  },
  dateCaret: {
    marginTop: ms(1),
  },

  // Summary chip — shares the bordered ACQ chip chrome but adds the
  // optional live dot prefix and a stats-chart icon as the affordance.
  summaryChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: s(5),
    paddingHorizontal: s(7),
    paddingVertical: s(3),
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "rgba(181, 123, 48, 0.55)",
    backgroundColor: "rgba(181, 123, 48, 0.14)",
  },
  summaryChipText: {
    fontFamily: Fonts.varsityBold,
    color: Brand.vintageGold,
    fontSize: ms(9),
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  summaryChipIcon: {
    marginLeft: s(1),
  },
  chipDisabled: {
    opacity: 0.55,
  },


  // Return-to-today chip — icon-only square. Renders in eyebrowLeft on
  // future dates and eyebrowRight on past dates; the chip's position
  // relative to the centered date communicates direction without copy.
  todayIconChip: {
    width: ms(22),
    height: ms(22),
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 6,
    borderWidth: 1,
    borderColor: Brand.vintageGold,
    backgroundColor: "rgba(181, 123, 48, 0.18)",
  },
  acqChip: {
    paddingHorizontal: s(7),
    paddingVertical: s(2),
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "rgba(181, 123, 48, 0.55)",
    backgroundColor: "rgba(181, 123, 48, 0.14)",
  },
  acqChipText: {
    fontFamily: Fonts.varsityBold,
    color: Brand.vintageGold,
    fontSize: ms(9),
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },

  // ── ACQ band ─ thin row above the ticker carrying both teams' usage.
  // Each side is a flexed slot that pins its chip toward the OUTER edge
  // (matching the corresponding score column) so the two ACQ chips line
  // up under their team's score.
  acqBand: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: s(6),
    marginBottom: s(2),
    paddingHorizontal: s(2),
  },
  acqBandSlot: {
    flex: 1,
    alignItems: "flex-start",
    // Floor so empty slots (cold load, BYE opponent) reserve the same
    // vertical space as a populated chip — keeps the band height stable.
    minHeight: ms(14),
  },
  acqBandSlotRight: {
    alignItems: "flex-end",
  },

  // ── Ticker slot ──────────────────────────────────────────────────────
  // `marginTop: auto` pushes the ticker to the card's bottom edge when the
  // content above is shorter than the card's minHeight.
  tickerSlot: {
    marginTop: "auto",
  },

  // ── Body ─────────────────────────────────────────────────────────────
  bodyRow: {
    flexDirection: "row",
    alignItems: "stretch",
  },
  bodyBlock: {
    flex: 1,
    minHeight: ms(86),
    justifyContent: "center",
    paddingVertical: s(2),
  },
  bodyArrow: {
    paddingHorizontal: s(8),
    justifyContent: "center",
  },
  bodyArrowDisabled: {
    opacity: 0.3,
  },
  bodyArrowText: {
    color: Brand.ecru,
    fontSize: ms(28),
    lineHeight: ms(32),
    fontWeight: "300",
  },
  emptyBody: {
    paddingVertical: s(12),
    alignItems: "center",
  },
  emptyBodyText: {
    fontSize: ms(12),
    letterSpacing: 0.4,
  },

  // Two-column stacked scoreboard
  scoreRow: {
    flexDirection: "row",
    alignItems: "stretch",
  },
  scoreColumn: {
    flex: 1,
    paddingVertical: s(2),
  },
  colAlignLeft: {
    alignItems: "flex-start",
  },
  colAlignRight: {
    alignItems: "flex-end",
  },
  alignSelfLeft: {
    alignSelf: "flex-start",
  },
  alignSelfRight: {
    alignSelf: "flex-end",
  },
  colDivider: {
    width: StyleSheet.hairlineWidth,
    backgroundColor: "rgba(233, 226, 203, 0.18)",
    marginHorizontal: s(8),
  },
  metaTopRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: s(6),
  },
  seedText: {
    color: Brand.vintageGold,
    fontFamily: Fonts.mono,
    fontSize: ms(10),
    letterSpacing: 0.4,
  },
  tri: {
    color: Brand.ecru,
    fontSize: ms(13),
    letterSpacing: 1.0,
  },
  recordInline: {
    color: Brand.ecruMuted,
    fontFamily: Fonts.mono,
    fontSize: ms(11),
    letterSpacing: 0.5,
  },
  bigScore: {
    // Oswald 700 — true bold (no synthetic) but condensed and readable
    // as a scoreboard digit. AlfaSlabOne (display) was too slab-heavy;
    // SpaceMono at any weight reads as synthetic bold. `tabular-nums`
    // keeps digits at fixed widths so live score updates don't reflow.
    fontFamily: Fonts.varsityBold,
    fontSize: ms(40),
    lineHeight: ms(44),
    letterSpacing: -0.4,
    marginTop: s(3),
    fontVariant: ["tabular-nums"],
  },
  bigScorePlaceholder: {
    color: Brand.ecruMuted,
    fontFamily: Fonts.varsityBold,
    fontSize: ms(40),
    lineHeight: ms(44),
    marginTop: s(3),
  },
  todayLine: {
    color: Brand.ecruMuted,
    fontSize: ms(9),
    letterSpacing: 0.8,
    marginTop: s(1),
  },
  todayLineSpacer: {
    height: ms(11),
    marginTop: s(1),
  },

  // GO LIVE shares the acqChip chrome but adds a colored dot prefix and
  // swaps to a red border/bg when the activity is live.
  goLiveActive: {
    backgroundColor: "rgba(220, 53, 69, 0.20)",
    borderColor: "#E55353",
  },
  goLiveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#E55353",
  },
  goLiveDotActive: {
    backgroundColor: "#fff",
  },
  // Notification-driven highlight: amber ring + glow when a Sunday close-matchup
  // alert lands and the user taps through. Auto-clears after ~6s.
  goLiveHighlighted: {
    borderColor: "#F59E0B",
    borderWidth: 2,
    shadowColor: "#F59E0B",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.7,
    shadowRadius: 8,
    elevation: 6,
  },
});
