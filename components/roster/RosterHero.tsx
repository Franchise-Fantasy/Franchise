import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { Fragment } from "react";
import {
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

interface HeroTeam {
  tricode: string | null;
  name: string | null;
  wins?: number | null;
  losses?: number | null;
  ties?: number | null;
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
  dayLabel: string;
  myTeam?: HeroTeam | null;
  opponent?: HeroTeam | null;
  isBye?: boolean;
  myScore?: number | null;
  oppScore?: number | null;
  weekIsLive?: boolean;
  playCount?: number;
  lockedCount?: number;
  emptyCount?: number;
  /** Roster-management stats. Drives the offseason context strip and
   *  contributes a ROSTER fill chip during in-season too. */
  rosterStats?: {
    rosterCount: number;
    rosterSize: number;
    irCount: number;
    taxiCount: number;
    onBlockCount: number;
  };
  onPrevDay: () => void;
  onNextDay: () => void;
  onGoToToday: () => void;
}

function formatRecord(t: HeroTeam | null | undefined): string {
  if (!t) return "";
  const w = t.wins ?? 0;
  const l = t.losses ?? 0;
  const ti = t.ties ?? 0;
  return ti > 0 ? `${w}-${l}-${ti}` : `${w}-${l}`;
}

function lineupSubline(isPastDate: boolean, isToday: boolean): string {
  if (isPastDate) return "Past lineup · read-only";
  if (isToday) return "Today's lineup";
  return "Upcoming lineup";
}

interface DecisionLine {
  text: string;
  /** Renders gold to flag an action the user owes. */
  urgent: boolean;
  /** Renders muted ecru — used for read-only/closed states. */
  muted?: boolean;
}

function buildDecision(args: {
  isPastDate: boolean;
  isToday: boolean;
  emptyCount: number;
  playCount: number;
  lockedCount: number;
}): DecisionLine {
  if (args.emptyCount > 0) {
    return {
      text:
        args.emptyCount === 1
          ? "1 OPEN SLOT"
          : `${args.emptyCount} OPEN SLOTS`,
      urgent: !args.isPastDate,
      muted: args.isPastDate,
    };
  }
  if (args.isPastDate) return { text: "FINAL", urgent: false, muted: true };
  if (args.isToday && args.playCount > 0) {
    return {
      text: `${args.lockedCount}/${args.playCount} PLAYED`,
      urgent: false,
    };
  }
  return { text: "LINEUP SET", urgent: false };
}

interface ContextItem {
  label: string;
  urgent?: boolean;
}

function buildInSeasonContext(args: {
  isToday: boolean;
  isPastDate: boolean;
  isBye: boolean;
  playCount: number;
  rosterStats: RosterHeroProps["rosterStats"];
}): ContextItem[] {
  const items: ContextItem[] = [];
  if (args.isBye) {
    items.push({ label: "REST WEEK" });
  } else if (args.playCount > 0) {
    items.push({
      label: args.isToday
        ? `${args.playCount} PLAYING`
        : `${args.playCount} GAMES`,
    });
  } else {
    items.push({ label: "OFF DAY" });
  }
  const rs = args.rosterStats;
  if (rs && rs.rosterSize > 0) {
    const rosterFull = rs.rosterCount >= rs.rosterSize;
    items.push({
      label: `${rs.rosterCount}/${rs.rosterSize} ROSTER`,
      urgent: !rosterFull,
    });
  }
  if (rs?.irCount && rs.irCount > 0) items.push({ label: `${rs.irCount} IR` });
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
  if (rs.irCount > 0) items.push({ label: `${rs.irCount} IR` });
  if (rs.taxiCount > 0) items.push({ label: `${rs.taxiCount} TAXI` });
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
): string {
  const fmt = (v: number | null | undefined) =>
    v != null ? v.toFixed(1) : "—";
  return `${fmt(my)} — ${fmt(opp)}`;
}

/**
 * Roster hero — blends the home-hero identity anchor (BIG display tricode
 * is the focal "this is YOUR team") with the matchup-hero chrome (3-zone
 * eyebrow chips, vintage gold accents, hairline-divided status row).
 *
 * Bands top-to-bottom:
 *   1. Eyebrow — `[● WK 1]` chip / centered date / icon-only return-to-today
 *   2. Identity — BIG tricode + gold mini-divider + record, team name below
 *   3. Status row — `vs LAS  148.6 — 152.5  │  3 OPEN SLOTS / Today's lineup`
 *                   flanked by ‹ › day-nav arrows. The matchup half is
 *                   context; the decision half goes gold when there's an
 *                   open slot the user owes.
 *   4. Chip strip — roster meta + day-game count
 *
 * Offseason / bye / no-matchup gracefully collapse the status row's
 * matchup half — the rest of the chrome stays put.
 */
export function RosterHero({
  selectedDate,
  today,
  canGoBack,
  isPastDate,
  isToday,
  currentWeek,
  dayLabel,
  myTeam,
  opponent,
  isBye,
  myScore,
  oppScore,
  weekIsLive,
  playCount = 0,
  lockedCount = 0,
  emptyCount = 0,
  rosterStats,
  onPrevDay,
  onNextDay,
  onGoToToday,
}: RosterHeroProps) {
  const c = useColors();
  const isOffseason = !currentWeek;
  const isFutureDate = selectedDate > today;
  const hasMatchup = !!opponent && opponent.tricode != null;

  const playoffPrefix = currentWeek?.is_playoff ? "PLAYOFFS · " : "";
  const weekChipText = currentWeek
    ? `${playoffPrefix}WK ${currentWeek.week_number}`
    : "OFFSEASON";

  const decision = isOffseason
    ? null
    : buildDecision({
        isPastDate,
        isToday,
        emptyCount,
        playCount,
        lockedCount,
      });
  const subline = isOffseason ? null : lineupSubline(isPastDate, isToday);

  const contextItems = isOffseason
    ? rosterStats
      ? buildOffseasonContext(rosterStats)
      : [{ label: "OFFSEASON" }]
    : buildInSeasonContext({
        isToday,
        isPastDate,
        isBye: !!isBye,
        playCount,
        rosterStats,
      });

  const tricode = myTeam?.tricode ?? "—";
  const record = formatRecord(myTeam);
  const teamName = myTeam?.name ?? "";

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: c.heroSurface },
        c.heroShadow,
      ]}
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

      {/* ── Eyebrow ─ week chip / centered date / today return ─────── */}
      <View style={styles.eyebrowRow}>
        <View style={styles.eyebrowLeft}>
          <View style={styles.weekChip}>
            {weekIsLive && <View style={styles.liveDot} />}
            <Text style={styles.weekChipText} numberOfLines={1}>
              {weekChipText}
            </Text>
          </View>
          {!isToday && isFutureDate && !isOffseason && (
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

        <View style={styles.eyebrowCenter}>
          {!isOffseason && (
            <ThemedText
              type="varsity"
              style={styles.eyebrowDate}
              numberOfLines={1}
            >
              {dayLabel.toUpperCase()}
            </ThemedText>
          )}
        </View>

        <View style={styles.eyebrowRight}>
          {!isToday && !isFutureDate && !isOffseason && (
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
        </View>
      </View>

      {/* ── Identity ─ BIG tricode + record, team name subline ─────── */}
      <View style={styles.identityBlock}>
        <View style={styles.tricodeRow}>
          <ThemedText
            type="display"
            style={styles.tricode}
            numberOfLines={1}
            accessibilityLabel={
              myTeam?.name
                ? `${myTeam.name}${record ? `, ${record}` : ""}`
                : tricode
            }
          >
            {tricode}
          </ThemedText>
          {record ? (
            <>
              <View style={styles.identityDivider} />
              <ThemedText
                type="mono"
                style={styles.identityRecord}
                numberOfLines={1}
              >
                {record}
              </ThemedText>
            </>
          ) : null}
        </View>
        {teamName ? (
          <ThemedText style={styles.teamName} numberOfLines={1}>
            {teamName}
          </ThemedText>
        ) : null}
      </View>

      {/* ── Status row ─ matchup | decision, flanked by day arrows ─── */}
      {!isOffseason && (
        <View style={styles.statusRow}>
          <TouchableOpacity
            onPress={onPrevDay}
            disabled={!canGoBack}
            style={[
              styles.statusArrow,
              !canGoBack && styles.statusArrowDisabled,
            ]}
            hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
            accessibilityRole="button"
            accessibilityLabel="Previous day"
            accessibilityState={{ disabled: !canGoBack }}
          >
            <Text style={styles.statusArrowText}>‹</Text>
          </TouchableOpacity>

          {hasMatchup ? (
            <View style={styles.statusBody}>
              <View style={styles.statusHalf}>
                <ThemedText
                  type="varsitySmall"
                  style={styles.statusLabel}
                  numberOfLines={1}
                >
                  vs {opponent?.tricode}
                </ThemedText>
                <ThemedText
                  style={[
                    styles.statusScore,
                    { color: scoreColor(myScore, oppScore, weekIsLive) },
                  ]}
                  numberOfLines={1}
                >
                  {formatScoreLine(myScore, oppScore)}
                </ThemedText>
              </View>
              <View style={styles.statusDivider} />
              <View style={styles.statusHalf}>
                <ThemedText
                  style={[
                    styles.statusDecision,
                    {
                      color: decision!.urgent
                        ? Brand.vintageGold
                        : decision!.muted
                          ? Brand.ecruMuted
                          : Brand.ecru,
                    },
                  ]}
                  numberOfLines={1}
                >
                  {decision!.text}
                </ThemedText>
                {subline && (
                  <ThemedText
                    type="varsitySmall"
                    style={styles.statusSubline}
                    numberOfLines={1}
                  >
                    {subline}
                  </ThemedText>
                )}
              </View>
            </View>
          ) : (
            // Bye / eliminated / no-matchup — full-width fallback band.
            // Drops the matchup half so the decision side gets the full
            // width without the divider looking lopsided.
            <View style={styles.statusBodyFallback}>
              <ThemedText
                style={[
                  styles.statusFallback,
                  {
                    color: isBye ? Brand.ecruMuted : Brand.ecru,
                  },
                ]}
                numberOfLines={1}
              >
                {isBye
                  ? "BYE WEEK"
                  : currentWeek?.is_playoff
                    ? "ELIMINATED"
                    : "NO MATCHUP"}
              </ThemedText>
              {subline && (
                <ThemedText
                  type="varsitySmall"
                  style={styles.statusSubline}
                  numberOfLines={1}
                >
                  {subline}
                </ThemedText>
              )}
            </View>
          )}

          <TouchableOpacity
            onPress={onNextDay}
            style={styles.statusArrow}
            hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
            accessibilityRole="button"
            accessibilityLabel="Next day"
          >
            <Text style={styles.statusArrowText}>›</Text>
          </TouchableOpacity>
        </View>
      )}

      <ContextStrip items={contextItems} />
    </View>
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
    paddingHorizontal: s(12),
    paddingTop: s(10),
    paddingBottom: s(10),
    overflow: "hidden",
    // Hold height stable across in-season / offseason / bye so the card
    // doesn't jump when the status-row band collapses.
    minHeight: s(170),
  },
  topRule: {
    position: "absolute",
    top: 0,
    left: s(12),
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

  // ── Eyebrow ─────────────────────────────────────────────────────────
  eyebrowRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: s(6),
    minHeight: ms(20),
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
    justifyContent: "flex-end",
    gap: s(5),
  },
  eyebrowSpacer: {
    flex: 1,
  },
  eyebrowDate: {
    color: Brand.ecru,
    fontSize: ms(11),
    letterSpacing: 1.1,
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
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#E55353",
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

  // ── Identity ────────────────────────────────────────────────────────
  identityBlock: {
    alignItems: "center",
    marginBottom: s(8),
  },
  tricodeRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: s(8),
  },
  tricode: {
    color: Brand.ecru,
    fontSize: ms(36),
    lineHeight: ms(42),
    letterSpacing: -0.4,
  },
  identityDivider: {
    width: s(8),
    height: 1,
    backgroundColor: Brand.vintageGold,
    opacity: 0.65,
    alignSelf: "center",
  },
  identityRecord: {
    color: Brand.ecru,
    fontSize: ms(15),
    letterSpacing: 0.4,
  },
  teamName: {
    color: Brand.ecruMuted,
    fontSize: ms(11),
    letterSpacing: 0.4,
    marginTop: s(2),
  },

  // ── Status row ──────────────────────────────────────────────────────
  statusRow: {
    flexDirection: "row",
    alignItems: "stretch",
    marginBottom: s(8),
  },
  statusBody: {
    flex: 1,
    flexDirection: "row",
    alignItems: "stretch",
    paddingVertical: s(2),
  },
  statusBodyFallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: s(4),
  },
  statusHalf: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: s(2),
  },
  statusDivider: {
    width: StyleSheet.hairlineWidth,
    backgroundColor: "rgba(233, 226, 203, 0.18)",
    marginHorizontal: s(6),
  },
  statusLabel: {
    color: Brand.ecruMuted,
    fontSize: ms(10),
    letterSpacing: 0.8,
  },
  statusScore: {
    fontFamily: Fonts.varsityBold,
    fontSize: ms(15),
    lineHeight: ms(18),
    fontVariant: ["tabular-nums"],
    letterSpacing: -0.1,
  },
  statusDecision: {
    fontFamily: Fonts.varsityBold,
    fontSize: ms(13),
    lineHeight: ms(16),
    letterSpacing: 0.4,
  },
  statusSubline: {
    color: Brand.ecruMuted,
    fontSize: ms(9),
    letterSpacing: 0.6,
    marginTop: s(1),
  },
  statusFallback: {
    fontFamily: Fonts.varsityBold,
    fontSize: ms(15),
    lineHeight: ms(18),
    letterSpacing: 0.6,
  },
  statusArrow: {
    paddingHorizontal: s(6),
    justifyContent: "center",
  },
  statusArrowDisabled: {
    opacity: 0.3,
  },
  statusArrowText: {
    color: Brand.ecru,
    fontSize: ms(24),
    lineHeight: ms(28),
    fontWeight: "300",
  },

  // ── Chip strip ──────────────────────────────────────────────────────
  contextStrip: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    flexWrap: "wrap",
    gap: s(6),
    minHeight: ms(16),
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
