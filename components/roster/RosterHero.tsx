import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { Fragment, type ReactNode, useEffect, useRef } from "react";
import {
  Animated,
  Easing,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { ThemedText } from "@/components/ui/ThemedText";
import { Brand, Fonts } from "@/constants/Colors";
import { useColors } from "@/hooks/useColors";
import { eliminatedRoundNumber, isEliminatedResult, PLAYOFF_RESULT } from "@/types/playoff";
import { ms, s } from "@/utils/scale";

const PATCH_SOURCE = require("../../assets/images/patch_logo.png");
const TAP_SLOP = { top: 8, bottom: 8, left: 8, right: 8 };
const ARROW_SLOP = { top: 8, bottom: 8, left: 4, right: 4 };
// Brighter than INJURY_COLORS.out (#dc3545) so it reads on the dark turf
// hero surface — matches the live-dot red already used in the eyebrow.
const OUT_RED = "#E55353";
const IDLE_FILL = "rgba(233, 226, 203, 0.42)";

interface HeroTeam {
  tricode: string | null;
  name: string | null;
  wins?: number | null;
  losses?: number | null;
  ties?: number | null;
}

/** Per-starter availability for the selected day. */
interface LineupDay {
  playing: number;
  out: number;
  idle: number;
  empty: number;
  starterCount: number;
}

interface RosterHeroProps {
  selectedDate: string;
  today: string;
  canGoBack: boolean;
  isPastDate: boolean;
  isToday: boolean;
  currentWeek:
    | { week_number: number; is_playoff?: boolean }
    | null
    | undefined;
  /** Short opening-night label (e.g. "Jun 6"), set ONLY when the schedule
   *  exists but the selected day is before the first week starts. Drives the
   *  "upcoming" state — the season's set, it just hasn't tipped off — which
   *  keeps day-nav live (so you can step forward to opening night) instead of
   *  collapsing to the dead-offseason layout. */
  seasonOpensLabel?: string;
  dayLabel: string;
  myTeam?: HeroTeam | null;
  opponent?: HeroTeam | null;
  isBye?: boolean;
  myScore?: number | null;
  oppScore?: number | null;
  /** Category leagues are decided by category wins, not the fpts in
   *  `myScore`/`oppScore`. When set, the scoreline shows the win tally
   *  (from the user's perspective) instead. */
  isCategories?: boolean;
  categoryRecord?: { myWins: number; oppWins: number; ties: number } | null;
  weekIsLive?: boolean;
  /** Drives the lineup-health bar. Omitted (or starterCount 0) hides it. */
  lineupDay?: LineupDay;
  /** Roster-management stats. Drives the offseason context strip and
   *  contributes a ROSTER fill chip during in-season too. */
  rosterStats?: {
    /** Active-pool count only (excludes IR + taxi), matched against rosterSize. */
    rosterCount: number;
    rosterSize: number;
    irCount: number;
    /** IR slot capacity — denominator for the IR fill chip. */
    irSlotCount: number;
    taxiCount: number;
    /** Taxi slot capacity — denominator for the taxi fill chip. */
    taxiSlotCount: number;
    onBlockCount: number;
  };
  /** Last completed season's result — replaces the meaningless live 0-0
   *  record in the offseason with the real record, finish, and playoff
   *  result. Null for a franchise with no archived season yet. */
  lastSeason?: {
    wins: number;
    losses: number;
    ties: number;
    finalStanding: number | null;
    leagueSize: number | null;
    playoffResult: string | null;
    season: string;
  } | null;
  onPrevDay: () => void;
  onNextDay: () => void;
  onGoToToday: () => void;
  /** When set, the eyebrow date becomes a tappable dropdown. */
  onDatePress?: () => void;
  /** When set, the week chip opens the weekly summary. */
  onWeekPress?: () => void;
  /** Optional outer-right slot in the eyebrow — pinned to the far edge,
   *  mirror of the week chip on the far left. Used by the page to host the
   *  share action so the section-level eyebrows stay clean. */
  headerRight?: ReactNode;
}

function formatWLT(wins: number, losses: number, ties: number): string {
  return ties > 0 ? `${wins}-${losses}-${ties}` : `${wins}-${losses}`;
}

function formatRecord(t: HeroTeam | null | undefined): string {
  if (!t) return "";
  return formatWLT(t.wins ?? 0, t.losses ?? 0, t.ties ?? 0);
}

/** 1 → "1st", 2 → "2nd", 11 → "11th". */
function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

interface OffseasonSeal {
  label: string;
  tone: "champ" | "gold" | "muted";
}

/** The offseason "finish seal" — how last season ended. Champion fills gold;
 *  a missed-playoffs finish reads muted; every other placement is a gold
 *  outline. Returns null for an absent/unrecognized result (no seal shown). */
function buildOffseasonSeal(
  playoffResult: string | null | undefined,
): OffseasonSeal | null {
  if (!playoffResult) return null;
  switch (playoffResult) {
    case PLAYOFF_RESULT.CHAMPION:
      return { label: "Champions", tone: "champ" };
    case PLAYOFF_RESULT.RUNNER_UP:
      return { label: "Runner-up", tone: "gold" };
    case PLAYOFF_RESULT.THIRD_PLACE:
      return { label: "Third place", tone: "gold" };
    case PLAYOFF_RESULT.FOURTH_PLACE:
      return { label: "Fourth place", tone: "gold" };
    case PLAYOFF_RESULT.MISSED_PLAYOFFS:
      return { label: "Missed playoffs", tone: "muted" };
    case "playoff_participant":
      return { label: "Made playoffs", tone: "gold" };
  }
  if (isEliminatedResult(playoffResult)) {
    return {
      label: `Out in Round ${eliminatedRoundNumber(playoffResult)}`,
      tone: "gold",
    };
  }
  return null;
}

interface StatusLine {
  text: string;
  color: string;
}

/**
 * The single most useful thing to say about the lineup for this day,
 * in priority order: read-only past → owed fills → dead-weight OUT →
 * off day → playing count.
 */
function buildLineupStatus(day: LineupDay, isPastDate: boolean): StatusLine {
  if (isPastDate) return { text: "FINAL", color: Brand.ecruMuted };
  if (day.empty > 0) {
    return {
      text: day.empty === 1 ? "1 OPEN SLOT" : `${day.empty} OPEN SLOTS`,
      color: Brand.vintageGold,
    };
  }
  if (day.out > 0) {
    return {
      text:
        day.out === 1 ? "1 OUT IN LINEUP" : `${day.out} OUT IN LINEUP`,
      color: OUT_RED,
    };
  }
  if (day.playing === 0) {
    return { text: "OFF DAY · NO GAMES", color: Brand.ecruMuted };
  }
  return {
    text:
      day.idle > 0
        ? `${day.playing} PLAYING · ${day.idle} IDLE`
        : `${day.playing} PLAYING`,
    color: Brand.ecru,
  };
}

interface ContextItem {
  label: string;
  urgent?: boolean;
}

/** In-season context strip — roster-management meta only; daily game
 *  status now lives in the lineup bar. */
function buildInSeasonContext(
  rs: RosterHeroProps["rosterStats"],
): ContextItem[] {
  const items: ContextItem[] = [];
  if (rs && rs.rosterSize > 0) {
    const rosterFull = rs.rosterCount >= rs.rosterSize;
    items.push({
      label: `${rs.rosterCount}/${rs.rosterSize} ROSTER`,
      urgent: !rosterFull,
    });
  }
  if (rs?.irSlotCount)
    items.push({ label: `${rs.irCount}/${rs.irSlotCount} IR` });
  if (rs?.taxiSlotCount)
    items.push({ label: `${rs.taxiCount}/${rs.taxiSlotCount} TAXI` });
  return items;
}

/** Pre-tip-off strip — leads with opening night so the user knows why the
 *  matchup + lineup bar are collapsed, then the usual roster-fill meta. */
function buildUpcomingContext(
  rs: RosterHeroProps["rosterStats"],
  opensLabel: string,
): ContextItem[] {
  const items: ContextItem[] = [{ label: `OPENS ${opensLabel.toUpperCase()}`, urgent: true }];
  if (rs && rs.rosterSize > 0) {
    items.push({
      label: `${rs.rosterCount}/${rs.rosterSize} ROSTER`,
      urgent: rs.rosterCount < rs.rosterSize,
    });
  }
  return items;
}

function buildOffseasonContext(
  rs: NonNullable<RosterHeroProps["rosterStats"]>,
): ContextItem[] {
  const items: ContextItem[] = [];
  const rosterFull = rs.rosterCount >= rs.rosterSize;
  items.push({
    label: rs.rosterSize
      ? `${rs.rosterCount}/${rs.rosterSize} ROSTER`
      : `${rs.rosterCount} ROSTER`,
    urgent: !rosterFull && rs.rosterSize > 0,
  });
  if (rs.irSlotCount > 0)
    items.push({ label: `${rs.irCount}/${rs.irSlotCount} IR` });
  if (rs.taxiSlotCount > 0)
    items.push({ label: `${rs.taxiCount}/${rs.taxiSlotCount} TAXI` });
  if (rs.onBlockCount > 0) items.push({ label: `${rs.onBlockCount} ON BLOCK` });
  if (items.length === 1) items.push({ label: "OFFSEASON" });
  return items;
}

function scoreColor(
  my: number | null | undefined,
  opp: number | null | undefined,
  live?: boolean,
): string {
  if (my == null || opp == null) return Brand.ecru;
  if (my > opp) return Brand.vintageGold;
  return live ? Brand.ecruMuted : Brand.ecru;
}

function formatScoreLine(
  my: number | null | undefined,
  opp: number | null | undefined,
  /** Category leagues count whole category wins; points show one decimal. */
  asInteger = false,
): string {
  const fmt = (v: number | null | undefined) =>
    v != null ? (asInteger ? String(v) : v.toFixed(1)) : "—";
  return `${fmt(my)} — ${fmt(opp)}`;
}

/**
 * Roster hero — refined-editorial identity × lineup command center.
 *
 * Distinct from the Home and Matchup heroes: a calm, left-aligned team
 * identity sits beside a demoted matchup scoreline (the Matchup page
 * owns the big scoreboard), and a lineup-health bar — its signature —
 * answers "is my lineup actually going to score today, and is anyone
 * dead weight?" at a glance.
 *
 * Layout:
 *   1. Eyebrow — `[● WK 1]` chip · tappable date dropdown · today return
 *   2. Main row — BIG tricode + record (left) │ vs OPP + score (right)
 *   3. Lineup bar — segmented per-starter availability + smart status
 *   4. Bottom — ‹ › day-nav chips flanking the roster-meta strip
 *
 * Offseason / bye / no-matchup gracefully collapse the matchup + bar.
 */
export function RosterHero({
  selectedDate,
  today,
  canGoBack,
  isPastDate,
  isToday,
  currentWeek,
  seasonOpensLabel,
  dayLabel,
  myTeam,
  opponent,
  isBye,
  myScore,
  oppScore,
  isCategories,
  categoryRecord,
  weekIsLive,
  lineupDay,
  rosterStats,
  lastSeason,
  onPrevDay,
  onNextDay,
  onGoToToday,
  onDatePress,
  onWeekPress,
  headerRight,
}: RosterHeroProps) {
  const c = useColors();
  const hasWeek = !!currentWeek;
  // Schedule exists but the selected day is before tip-off. Distinct from the
  // dead off-season: nav stays live so the user can reach opening night.
  const isUpcoming = !hasWeek && !!seasonOpensLabel;
  const isOffseason = !hasWeek && !isUpcoming;
  const isFutureDate = selectedDate > today;
  const hasMatchup = !!opponent && opponent.tricode != null;

  // Category leagues are decided by category wins, not the fpts week total.
  // These drive both the scoreline value and the gold "leading" highlight.
  const myFocal = isCategories ? categoryRecord?.myWins ?? null : myScore;
  const oppFocal = isCategories ? categoryRecord?.oppWins ?? null : oppScore;

  const playoffPrefix = currentWeek?.is_playoff ? "PLAYOFFS · " : "";
  const weekChipText = currentWeek
    ? `${playoffPrefix}WK ${currentWeek.week_number}`
    : isUpcoming
      ? "UPCOMING"
      : "OFFSEASON";

  const contextItems = isUpcoming
    ? buildUpcomingContext(rosterStats, seasonOpensLabel!)
    : isOffseason
      ? rosterStats
        ? buildOffseasonContext(rosterStats)
        : [{ label: "OFFSEASON" }]
      : buildInSeasonContext(rosterStats);

  const tricode = myTeam?.tricode ?? "—";
  const record = formatRecord(myTeam);
  const teamName = myTeam?.name ?? "";
  const showLineupBar =
    hasWeek && !!lineupDay && lineupDay.starterCount > 0;

  // Offseason retrospective — the just-closed season's real record + finish
  // stand in for the live 0-0, which advance-season zeroes and is meaningless.
  const offseasonSeal =
    isOffseason && lastSeason ? buildOffseasonSeal(lastSeason.playoffResult) : null;
  const lastSeasonRecord = lastSeason
    ? formatWLT(lastSeason.wins, lastSeason.losses, lastSeason.ties)
    : "";
  const identityLabel = isOffseason
    ? teamName
      ? `${teamName}${
          lastSeason
            ? `, last season ${lastSeasonRecord}${
                lastSeason.finalStanding
                  ? `, finished ${ordinal(lastSeason.finalStanding)}`
                  : ""
              }`
            : ""
        }`
      : tricode
    : myTeam?.name
      ? `${myTeam.name}${record ? `, ${record}` : ""}`
      : tricode;

  // The week chip opens the weekly summary when in-season; off-season and
  // pre-tip-off it's a static label. Mirrors HomeHero's conditional-wrapper.
  const weekChipTappable = !!onWeekPress && hasWeek;
  const WeekWrapper = weekChipTappable ? TouchableOpacity : View;
  const weekWrapperProps = weekChipTappable
    ? {
        onPress: onWeekPress,
        hitSlop: TAP_SLOP,
        accessibilityRole: "button" as const,
        accessibilityLabel: `${weekChipText}. View weekly summary`,
        accessibilityHint: "Opens this week's performance breakdown",
      }
    : {};

  return (
    <View
      style={[styles.card, { backgroundColor: c.heroSurface }, c.heroShadow]}
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

      {/* ── Eyebrow ─ week chip / date dropdown + today return ──────── */}
      <View style={styles.eyebrowRow}>
        <View style={styles.eyebrowLeft}>
          <WeekWrapper style={styles.weekChip} {...weekWrapperProps}>
            {weekIsLive && <View style={styles.liveDot} />}
            <Text style={styles.weekChipText} numberOfLines={1}>
              {weekChipText}
            </Text>
            {weekChipTappable && (
              <Ionicons
                name="stats-chart"
                size={ms(11)}
                color={Brand.vintageGold}
                style={styles.weekChipCaret}
              />
            )}
          </WeekWrapper>
        </View>

        {/* Date sits dead-centre and never moves. The jump-to-today chip
            lives in the flex-1 right column (inner edge, just beside the
            date) so showing/hiding it can't shift the date — mirrors the
            Matchup hero. */}
        <View style={styles.eyebrowCenter}>
          {!isOffseason &&
            (onDatePress ? (
              <TouchableOpacity
                onPress={onDatePress}
                style={styles.dateButton}
                hitSlop={TAP_SLOP}
                accessibilityRole="button"
                accessibilityLabel={`${dayLabel}. Change day`}
                accessibilityHint="Opens the day picker"
              >
                <ThemedText
                  type="varsity"
                  style={styles.eyebrowDate}
                  numberOfLines={1}
                >
                  {dayLabel.toUpperCase()}
                </ThemedText>
                <Ionicons
                  name="chevron-down"
                  size={ms(12)}
                  color={Brand.ecruMuted}
                  style={styles.dateCaret}
                />
              </TouchableOpacity>
            ) : (
              <ThemedText
                type="varsity"
                style={styles.eyebrowDate}
                numberOfLines={1}
              >
                {dayLabel.toUpperCase()}
              </ThemedText>
            ))}
        </View>

        <View style={styles.eyebrowRight}>
          {/* Inner edge — jump-to-today chip sits flush against the date so
              it reads as a date-nav utility. */}
          <View style={styles.eyebrowRightInner}>
            {!isToday && !isOffseason && (
              <TouchableOpacity
                onPress={onGoToToday}
                style={styles.todayIconChip}
                hitSlop={TAP_SLOP}
                accessibilityRole="button"
                accessibilityLabel="Jump to today"
              >
                <Ionicons
                  name={isFutureDate ? "arrow-undo-outline" : "arrow-redo-outline"}
                  size={ms(14)}
                  color={Brand.vintageGold}
                />
              </TouchableOpacity>
            )}
          </View>
          {/* Outer edge — page-level action mirror of the week chip on the
              far left. Currently hosts the share button. */}
          <View style={styles.eyebrowRightOuter}>{headerRight}</View>
        </View>
      </View>

      {/* ── Main row ─ identity (left) + matchup scoreline (right) ───── */}
      <View style={styles.mainRow}>
        <View style={styles.identityBlock}>
          <View style={styles.tricodeRow}>
            <ThemedText
              type="display"
              style={styles.tricode}
              numberOfLines={1}
              accessibilityLabel={identityLabel}
            >
              {tricode}
            </ThemedText>
            {record && !isOffseason ? (
              <ThemedText
                type="mono"
                style={styles.identityRecord}
                numberOfLines={1}
              >
                {record}
              </ThemedText>
            ) : null}
          </View>
          {teamName ? (
            <ThemedText style={styles.teamName} numberOfLines={1}>
              {teamName}
            </ThemedText>
          ) : null}
          {offseasonSeal && (
            <View
              style={[
                styles.seal,
                styles.sealInline,
                offseasonSeal.tone === "champ" && styles.sealChamp,
                offseasonSeal.tone === "muted" && styles.sealMuted,
              ]}
            >
              {offseasonSeal.tone === "champ" && (
                <Ionicons
                  name="trophy"
                  size={ms(11)}
                  color={Brand.ink}
                  style={styles.sealIcon}
                />
              )}
              <Text
                style={[
                  styles.sealText,
                  offseasonSeal.tone === "champ" && styles.sealTextChamp,
                  offseasonSeal.tone === "muted" && styles.sealTextMuted,
                ]}
                numberOfLines={1}
              >
                {offseasonSeal.label}
              </Text>
            </View>
          )}
        </View>

        {isOffseason && lastSeason && (
          <View style={styles.lastSeasonBlock}>
            <ThemedText
              type="varsitySmall"
              style={styles.lastSeasonCap}
              numberOfLines={1}
            >
              {lastSeason.season} FINAL
            </ThemedText>
            <ThemedText
              type="mono"
              style={styles.lastSeasonRecord}
              numberOfLines={1}
            >
              {lastSeasonRecord}
            </ThemedText>
            {lastSeason.finalStanding ? (
              <ThemedText
                type="mono"
                style={styles.lastSeasonRank}
                numberOfLines={1}
              >
                {ordinal(lastSeason.finalStanding)}
                {lastSeason.leagueSize ? ` of ${lastSeason.leagueSize}` : ""}
              </ThemedText>
            ) : null}
          </View>
        )}

        {hasWeek && (
          <View style={styles.matchupBlock}>
            {hasMatchup ? (
              <>
                <ThemedText
                  type="varsitySmall"
                  style={styles.matchupVs}
                  numberOfLines={1}
                >
                  VS {opponent?.tricode}
                </ThemedText>
                <ThemedText
                  type="mono"
                  style={[
                    styles.matchupScore,
                    { color: scoreColor(myFocal, oppFocal, weekIsLive) },
                  ]}
                  numberOfLines={1}
                  accessibilityLabel={
                    isCategories
                      ? `Categories ${myFocal ?? 0} to ${oppFocal ?? 0}${
                          categoryRecord?.ties ? `, ${categoryRecord.ties} tied` : ""
                        }`
                      : `Score ${myScore?.toFixed(1) ?? "—"} to ${
                          oppScore?.toFixed(1) ?? "—"
                        }`
                  }
                >
                  {formatScoreLine(myFocal, oppFocal, isCategories)}
                </ThemedText>
              </>
            ) : (
              <ThemedText
                type="varsitySmall"
                style={[
                  styles.matchupFallback,
                  { color: isBye ? Brand.ecruMuted : Brand.ecru },
                ]}
                numberOfLines={1}
              >
                {isBye
                  ? "BYE WEEK"
                  : currentWeek?.is_playoff
                    ? "ELIMINATED"
                    : "NO MATCHUP"}
              </ThemedText>
            )}
          </View>
        )}
      </View>

      {/* ── Lineup health bar ─ per-starter availability + status ────── */}
      {showLineupBar && (
        <LineupBar day={lineupDay} isPastDate={isPastDate} />
      )}

      {/* ── Bottom ─ day-nav chips flanking the roster-meta strip ────── */}
      <View style={styles.bottomRow}>
        {!isOffseason && (
          <ArrowChip
            direction="prev"
            disabled={!canGoBack}
            onPress={onPrevDay}
          />
        )}
        <View style={styles.contextStripWrap}>
          <ContextStrip items={contextItems} />
        </View>
        {!isOffseason && <ArrowChip direction="next" onPress={onNextDay} />}
      </View>
    </View>
  );
}

/**
 * Segmented lineup-health bar. One segment per starter slot, colored by
 * the player's status for the selected day: playing (gold) → idle, no
 * game (dim) → OUT/injured (red) → empty slot (faint track). The filled
 * segments fade in on mount and whenever the composition changes.
 */
function LineupBar({
  day,
  isPastDate,
}: {
  day: LineupDay;
  isPastDate: boolean;
}) {
  const fill = useRef(new Animated.Value(0)).current;
  const { playing, out, idle, empty, starterCount } = day;

  useEffect(() => {
    fill.setValue(0);
    Animated.timing(fill, {
      toValue: 1,
      duration: 450,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [fill, playing, out, idle, empty]);

  // Visual order groups contributing slots first, problems last.
  const segments: ("playing" | "idle" | "out" | "empty")[] = [
    ...Array(playing).fill("playing"),
    ...Array(idle).fill("idle"),
    ...Array(out).fill("out"),
    ...Array(empty).fill("empty"),
  ];

  const status = buildLineupStatus(day, isPastDate);

  return (
    <View
      style={styles.lineupSection}
      accessibilityRole="progressbar"
      accessibilityLabel={`Lineup for this day: ${playing} of ${starterCount} playing${
        out > 0 ? `, ${out} out` : ""
      }${idle > 0 ? `, ${idle} idle` : ""}${empty > 0 ? `, ${empty} open` : ""}`}
    >
      <View style={styles.lineupBarRow}>
        <ThemedText type="varsitySmall" style={styles.lineupLabel}>
          LINEUP
        </ThemedText>
        <View style={styles.lineupTrack}>
          {segments.map((kind, i) => (
            <View key={i} style={styles.lineupSegment}>
              {kind !== "empty" && (
                <Animated.View
                  style={[
                    StyleSheet.absoluteFill,
                    {
                      borderRadius: 2,
                      opacity: fill,
                      backgroundColor:
                        kind === "playing"
                          ? Brand.vintageGold
                          : kind === "out"
                            ? OUT_RED
                            : IDLE_FILL,
                    },
                  ]}
                />
              )}
            </View>
          ))}
        </View>
        <ThemedText type="mono" style={styles.lineupCount}>
          {playing}/{starterCount}
        </ThemedText>
      </View>
      <ThemedText
        type="varsitySmall"
        style={[styles.lineupStatus, { color: status.color }]}
        numberOfLines={1}
      >
        {status.text}
      </ThemedText>
    </View>
  );
}

function ArrowChip({
  direction,
  disabled,
  onPress,
}: {
  direction: "prev" | "next";
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      style={[styles.arrowChip, disabled && styles.arrowChipDisabled]}
      hitSlop={ARROW_SLOP}
      accessibilityRole="button"
      accessibilityLabel={direction === "prev" ? "Previous day" : "Next day"}
      accessibilityState={{ disabled: !!disabled }}
    >
      <Ionicons
        name={direction === "prev" ? "chevron-back" : "chevron-forward"}
        size={ms(15)}
        color={Brand.ecru}
      />
    </TouchableOpacity>
  );
}

function ContextStrip({ items }: { items: ContextItem[] }) {
  return (
    <View style={styles.contextStrip}>
      {items.map((item, i) => (
        <Fragment key={i}>
          {i > 0 && <Text style={styles.contextSep}>·</Text>}
          <ThemedText
            type="varsitySmall"
            style={[
              styles.contextItem,
              { color: item.urgent ? Brand.vintageGold : Brand.ecruMuted },
            ]}
          >
            {item.label}
          </ThemedText>
        </Fragment>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    position: "relative",
    marginHorizontal: s(12),
    marginTop: s(8),
    marginBottom: s(8),
    borderRadius: 16,
    paddingHorizontal: s(14),
    paddingTop: s(10),
    paddingBottom: s(10),
    overflow: "hidden",
    // Floor only — the card sizes to content; this keeps the offseason
    // (collapsed matchup + bar) variant from looking stubby.
    minHeight: s(150),
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
    width: s(124),
    height: s(124),
    opacity: 0.12,
  },

  // ── Eyebrow ─────────────────────────────────────────────────────────
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
    paddingHorizontal: s(6),
  },
  eyebrowRight: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    // Two anchored slots: inner-edge (today-chip, hugging the date) and
    // outer-edge (headerRight slot — mirror of the week chip far left).
    justifyContent: "space-between",
  },
  eyebrowRightInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: s(6),
  },
  eyebrowRightOuter: {
    flexDirection: "row",
    alignItems: "center",
    gap: s(6),
  },
  dateButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: s(4),
  },
  eyebrowDate: {
    color: Brand.ecru,
    fontSize: ms(11),
    letterSpacing: 1.1,
  },
  dateCaret: {
    marginTop: ms(1),
  },
  weekChip: {
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
  weekChipText: {
    fontFamily: Fonts.varsityBold,
    color: Brand.vintageGold,
    fontSize: ms(9),
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  weekChipCaret: {
    marginLeft: s(1),
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: OUT_RED,
  },
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

  // ── Main row (identity + matchup) ───────────────────────────────────
  mainRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: s(12),
    marginBottom: s(10),
  },
  identityBlock: {
    flexShrink: 1,
    alignItems: "flex-start",
  },
  tricodeRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: s(10),
  },
  tricode: {
    color: Brand.ecru,
    fontSize: ms(40),
    // Generous line height + top pad so the slab-serif caps aren't
    // clipped at the top of their line box.
    lineHeight: ms(48),
    paddingTop: ms(2),
    letterSpacing: -0.5,
  },
  identityRecord: {
    color: Brand.ecruMuted,
    fontSize: ms(15),
    letterSpacing: 0.4,
  },
  teamName: {
    color: Brand.ecruMuted,
    fontSize: ms(12),
    letterSpacing: 0.3,
    marginTop: s(1),
  },
  matchupBlock: {
    alignItems: "flex-end",
    flexShrink: 0,
  },
  matchupVs: {
    color: Brand.ecruMuted,
    fontSize: ms(11),
    letterSpacing: 0.8,
  },
  matchupScore: {
    fontSize: ms(16),
    lineHeight: ms(20),
    letterSpacing: -0.1,
    fontVariant: ["tabular-nums"],
    marginTop: s(2),
  },
  matchupFallback: {
    fontSize: ms(13),
    letterSpacing: 0.8,
  },

  // ── Offseason retrospective (last-season stat + finish seal) ─────────
  lastSeasonBlock: {
    alignItems: "flex-end",
    flexShrink: 0,
    // Top-align the stat block with the tricode's cap line (matching its
    // paddingTop) so it reads as a header annotation, not a centered float.
    alignSelf: "flex-start",
    marginTop: s(3),
  },
  lastSeasonCap: {
    color: Brand.vintageGold,
    fontSize: ms(8.5),
    letterSpacing: 1.2,
  },
  lastSeasonRecord: {
    color: Brand.ecru,
    fontSize: ms(20),
    letterSpacing: 0.2,
    fontVariant: ["tabular-nums"],
    marginTop: s(1),
  },
  lastSeasonRank: {
    color: Brand.ecruMuted,
    fontSize: ms(10),
    letterSpacing: 0.4,
    marginTop: s(1),
  },
  sealInline: {
    marginTop: s(9),
  },
  seal: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: s(6),
    paddingHorizontal: s(10),
    paddingVertical: s(4),
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(181, 123, 48, 0.55)",
    backgroundColor: "rgba(181, 123, 48, 0.14)",
  },
  sealChamp: {
    backgroundColor: Brand.vintageGold,
    borderColor: Brand.vintageGold,
  },
  sealMuted: {
    borderColor: "rgba(233, 226, 203, 0.28)",
    backgroundColor: "rgba(233, 226, 203, 0.06)",
  },
  sealIcon: {
    marginTop: -1,
  },
  sealText: {
    fontFamily: Fonts.varsityBold,
    color: Brand.vintageGold,
    fontSize: ms(10),
    letterSpacing: 1.0,
    textTransform: "uppercase",
  },
  sealTextChamp: {
    color: Brand.ink,
  },
  sealTextMuted: {
    color: Brand.ecruMuted,
  },

  // ── Lineup health bar (signature) ───────────────────────────────────
  lineupSection: {
    marginBottom: s(10),
    gap: s(4),
  },
  lineupBarRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: s(8),
  },
  lineupLabel: {
    color: Brand.ecruMuted,
    fontSize: ms(10),
    letterSpacing: 1.4,
  },
  lineupTrack: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: s(3),
    height: ms(8),
  },
  lineupSegment: {
    flex: 1,
    height: "100%",
    borderRadius: 2,
    overflow: "hidden",
    backgroundColor: "rgba(233, 226, 203, 0.16)",
  },
  lineupCount: {
    color: Brand.ecru,
    fontSize: ms(13),
    letterSpacing: 0.2,
    fontVariant: ["tabular-nums"],
  },
  lineupStatus: {
    fontSize: ms(10),
    letterSpacing: 1.1,
  },

  // ── Bottom row (day nav + context strip) ────────────────────────────
  bottomRow: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: ms(26),
  },
  contextStripWrap: {
    flex: 1,
  },
  arrowChip: {
    width: ms(26),
    height: ms(26),
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 7,
    borderWidth: 1,
    borderColor: "rgba(233, 226, 203, 0.22)",
    backgroundColor: "rgba(233, 226, 203, 0.06)",
  },
  arrowChipDisabled: {
    opacity: 0.3,
  },

  // ── Context strip ───────────────────────────────────────────────────
  contextStrip: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    flexWrap: "wrap",
    gap: s(6),
  },
  contextItem: {
    fontSize: ms(10),
    letterSpacing: 1.1,
  },
  contextSep: {
    color: Brand.ecruMuted,
    fontFamily: Fonts.mono,
    fontSize: ms(11),
  },
});
