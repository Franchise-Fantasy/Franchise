import { Image } from "expo-image";
import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  StyleSheet,
  Text,
  TextStyle,
  TouchableOpacity,
  View,
} from "react-native";

import { MatchupChip } from "@/components/player/MatchupChip";
import { PlayerHeadshotImage } from "@/components/player/PlayerHeadshotImage";
import { Colors, Fonts } from "@/constants/Colors";
import { useActiveLeagueSport } from "@/hooks/useActiveLeagueSport";
import { useColorScheme } from "@/hooks/useColorScheme";
import { ScoringWeight } from "@/types/player";
import { abbreviateFirstName } from "@/utils/formatting";
import { getInjuryBadge } from "@/utils/nba/injuryBadge";
import {
  formatGameInfo,
  LivePlayerStats,
  liveToGameLog,
} from "@/utils/nba/nbaLive";
import { ScheduleEntry } from "@/utils/nba/nbaSchedule";
import { ms, s } from "@/utils/scale";
import { calculateGameFantasyPoints, formatScore } from "@/utils/scoring/fantasyPoints";


// ─── Types ───────────────────────────────────────────────────────────────────

export type DisplayMode = "past" | "today" | "future";

export interface RosterPlayer {
  player_id: string;
  name: string;
  position: string;
  pro_team: string;
  nbaTricode: string | null;
  roster_slot: string;
  external_id_nba: number | null;
  status: string;
  weekPoints: number;
  dayPoints: number;
  dayMatchup: string | null;
  dayStatLine: string | null;
  projectedFpts: number | null;
  dayGameStats?: Record<string, number | boolean> | null;
  weekGameStats?: Record<string, number> | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function round1(n: number) {
  return Math.round(n * 100) / 100;
}

// Build a stat line string for a live/historical stat object.
// Compact single-letter labels keep the line readable in the narrow
// per-side cell where the matchup page splits horizontal space.
// Zero-value categories are dropped so the line shows only what the
// player actually produced.
export function buildStatLine(
  stats: Record<string, number>,
  _scoring: ScoringWeight[],
): string {
  const fields: [string, string][] = [
    ["pts", "P"],
    ["reb", "R"],
    ["ast", "A"],
  ];
  return fields
    .filter(([key]) => (stats[key] ?? 0) > 0)
    .map(([key, label]) => `${stats[key]}${label}`)
    .join(" ");
}

// ─── Sub-components ──────────────────────────────────────────────────────────

// Player-name renderer that swaps to "F. LastName" only when the full name
// would clip to a second line. A hidden Text in the same flex slot reports
// its natural line count via onTextLayout — > 1 line means abbreviate.
function PlayerName({
  name,
  style,
  textAlign,
}: {
  name: string;
  style: TextStyle | TextStyle[];
  textAlign: "left" | "right";
}) {
  const [overflows, setOverflows] = useState(false);
  const display = overflows ? abbreviateFirstName(name) : name;
  return (
    <View style={{ flexShrink: 1 }}>
      {!overflows && (
        <Text
          style={[
            style,
            { position: "absolute", opacity: 0, textAlign },
          ]}
          onTextLayout={(e) => {
            if (e.nativeEvent.lines.length > 1) setOverflows(true);
          }}
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no"
        >
          {name}
        </Text>
      )}
      <Text style={[style, { textAlign }]} numberOfLines={1}>
        {display}
      </Text>
    </View>
  );
}

// Static green dot shown when player is actively on the floor.
function OnCourtDot() {
  const scheme = useColorScheme() ?? "light";
  return (
    <View
      style={{
        width: 6,
        height: 6,
        borderRadius: 3,
        backgroundColor: Colors[scheme].success,
        marginRight: 2,
      }}
    />
  );
}

// Pops on value change (1 → 1.35 → 1 spring)
function AnimatedFpts({
  value,
  activeColor,
  dimColor,
  textStyle,
  projected,
}: {
  value: number | null;
  activeColor: string;
  dimColor: string;
  textStyle: any;
  projected?: boolean;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const prev = useRef<number | null | undefined>(undefined);

  useEffect(() => {
    if (prev.current !== undefined && value !== prev.current) {
      Animated.sequence([
        Animated.timing(scale, {
          toValue: 1.35,
          duration: 150,
          useNativeDriver: true,
        }),
        Animated.spring(scale, {
          toValue: 1,
          useNativeDriver: true,
          bounciness: 12,
        }),
      ]).start();
    }
    prev.current = value;
  }, [value]);

  return (
    <Animated.Text
      style={[
        textStyle,
        {
          transform: [{ scale }],
          color: value !== null ? activeColor : dimColor,
        },
      ]}
    >
      {value !== null
        ? projected
          ? value.toFixed(1)
          : formatScore(value)
        : "—"}
    </Animated.Text>
  );
}

// ─── PlayerCell ──────────────────────────────────────────────────────────────

// Renders a single player cell (one side of a matchup row).
// 3-line layout: (1) Name + injury  (2) time/score + matchup chip  (3) stats + fpts
export const PlayerCell = React.memo(function PlayerCell({
  player,
  c,
  side,
  mode,
  liveStats,
  scoring,
  futureSchedule,
  onPress,
  isCategories,
  onFptsPress,
}: {
  player: RosterPlayer | null;
  c: any;
  side: "left" | "right";
  mode: DisplayMode;
  liveStats: LivePlayerStats | null;
  scoring: ScoringWeight[];
  futureSchedule?: Map<string, ScheduleEntry>;
  onPress?: (playerId: string) => void;
  isCategories?: boolean;
  onFptsPress?: (
    stats: Record<string, number | boolean>,
    playerName: string,
    gameLabel: string,
  ) => void;
}) {
  const sport = useActiveLeagueSport();
  const align = side === "right" ? "flex-end" : "flex-start";
  const textAlign = side === "right" ? ("right" as const) : ("left" as const);
  // Line 2/3 row direction: push fpts & chip toward center (near headshots)
  const rowDir = side === "left" ? ("row-reverse" as const) : ("row" as const);

  const injuryBadge = player ? getInjuryBadge(player.status) : null;

  // Empty slot
  if (!player) {
    return (
      <View
        style={[pStyles.cell, { alignItems: align }]}
        accessibilityLabel="Empty slot"
      >
        <Text
          style={[
            pStyles.name,
            { color: c.secondaryText, fontStyle: "italic", textAlign },
          ]}
        >
          Empty
        </Text>
        <Text style={[pStyles.pts, { color: c.secondaryText, textAlign }]}>
          —
        </Text>
      </View>
    );
  }

  const Wrapper = onPress ? TouchableOpacity : View;
  const wrapperProps = onPress
    ? {
        activeOpacity: 0.6,
        onPress: () => onPress(player.player_id),
        accessibilityRole: "button" as const,
        accessibilityLabel: `${player.name}, ${player.position}`,
      }
    : { accessibilityLabel: `${player.name}, ${player.position}` };

  const headshotEl = (
    <View
      style={[
        pStyles.headshotCircle,
        { borderColor: c.heritageGold, backgroundColor: c.cardAlt },
      ]}
      accessibilityLabel={`${player.name} headshot`}
    >
      <PlayerHeadshotImage
        externalIdNba={player.external_id_nba}
        sport={sport}
        style={pStyles.headshotImg}
      />
    </View>
  );

  // ── Render helper for the fpts value (inline or touchable for breakdown) ──
  const renderFpts = (
    value: number | null,
    stats?: Record<string, number | boolean> | null,
    gameLabel?: string,
    projected?: boolean,
  ) => {
    if (isCategories) return null;
    const canBreakdown = onFptsPress && stats && value !== null;
    const fptsEl = (
      <AnimatedFpts
        value={value}
        activeColor={c.text}
        dimColor={c.secondaryText}
        textStyle={pStyles.pts}
        projected={projected}
      />
    );
    if (canBreakdown) {
      return (
        <TouchableOpacity
          onPress={() => onFptsPress!(stats!, player.name, gameLabel ?? "")}
          accessibilityRole="button"
          accessibilityLabel={`View breakdown: ${value} fantasy points`}
        >
          {fptsEl}
        </TouchableOpacity>
      );
    }
    return fptsEl;
  };

  // ── Future / Today-no-live ────────────────────────────────────────────────
  if (mode === "future" || (mode === "today" && !liveStats)) {
    const schedEntry = player.nbaTricode
      ? (futureSchedule?.get(player.nbaTricode) ?? null)
      : null;
    return (
      <Wrapper
        style={[
          pStyles.cell,
          { flexDirection: "row", alignItems: "center", gap: 4 },
        ]}
        {...wrapperProps}
      >
        {side === "left" && headshotEl}
        <View style={{ flex: 1, alignItems: align }}>
          {/* Line 1: Name + injury (injury toward center) */}
          <View style={[pStyles.nameRow, { justifyContent: align }]}>
            {side === "right" && injuryBadge && (
              <View
                style={[
                  pStyles.injuryBadge,
                  { backgroundColor: injuryBadge.color },
                ]}
              >
                <Text style={[pStyles.injuryText, { color: c.statusText }]}>{injuryBadge.label}</Text>
              </View>
            )}
            <PlayerName
              name={player.name}
              style={[pStyles.name, { color: c.text }]}
              textAlign={textAlign}
            />
            {side === "left" && injuryBadge && (
              <View
                style={[
                  pStyles.injuryBadge,
                  { backgroundColor: injuryBadge.color },
                ]}
              >
                <Text style={[pStyles.injuryText, { color: c.statusText }]}>{injuryBadge.label}</Text>
              </View>
            )}
          </View>
          {/* Line 2: position label — kept visible pre-game so we don't lose
              the at-a-glance "what does this player do" cue. */}
          <View style={[pStyles.gameInfoRow, { justifyContent: align }]}>
            <Text style={[pStyles.meta, { color: c.secondaryText }]}>
              {player.position}
            </Text>
          </View>
          {/* Line 3: matchup chip + tipoff (replaces a meaningless 0.0).
              Mirrors the roster pre-game treatment — chip in place of FPTS.
              For CAT leagues we still want the chip (so users can see when
              tipoff is) but drop the "—" fallback since there's no fpts to
              stand in for. */}
          {(schedEntry || !isCategories) && (
            <View
              style={[
                pStyles.statsRow,
                { justifyContent: align, flexDirection: rowDir },
              ]}
            >
              {schedEntry ? (
                <MatchupChip
                  matchup={schedEntry.matchup}
                  isLive={false}
                  c={c}
                  gameTimeUtc={schedEntry.gameTimeUtc}
                />
              ) : (
                <Text
                  style={[
                    pStyles.pts,
                    { color: c.secondaryText, textAlign },
                  ]}
                >
                  —
                </Text>
              )}
            </View>
          )}
        </View>
        {side === "right" && headshotEl}
      </Wrapper>
    );
  }

  // ── Today/Past with live stats ────────────────────────────────────────────
  if (liveStats && (mode === "today" || mode === "past")) {
    const liveFp = round1(
      calculateGameFantasyPoints(liveToGameLog(liveStats) as any, scoring),
    );
    const isLive = liveStats.game_status === 2;
    const statLine =
      liveStats.game_status !== 1
        ? buildStatLine(
            liveToGameLog(liveStats) as Record<string, number>,
            scoring,
          )
        : null;
    const gameInfo = formatGameInfo(liveStats);

    return (
      <Wrapper
        style={[
          pStyles.cell,
          { flexDirection: "row", alignItems: "center", gap: 4 },
        ]}
        {...wrapperProps}
      >
        {side === "left" && headshotEl}
        <View style={{ flex: 1, alignItems: align }}>
          {/* Line 1: Name + injury (toward center) + on-court dot */}
          <View style={[pStyles.nameRow, { justifyContent: align }]}>
            {side === "right" && injuryBadge && (
              <View
                style={[
                  pStyles.injuryBadge,
                  { backgroundColor: injuryBadge.color },
                ]}
              >
                <Text style={[pStyles.injuryText, { color: c.statusText }]}>{injuryBadge.label}</Text>
              </View>
            )}
            {side === "right" && liveStats.oncourt && isLive && <OnCourtDot />}
            <PlayerName
              name={player.name}
              style={[pStyles.name, { color: c.text }]}
              textAlign={textAlign}
            />
            {side === "left" && liveStats.oncourt && isLive && <OnCourtDot />}
            {side === "left" && injuryBadge && (
              <View
                style={[
                  pStyles.injuryBadge,
                  { backgroundColor: injuryBadge.color },
                ]}
              >
                <Text style={[pStyles.injuryText, { color: c.statusText }]}>{injuryBadge.label}</Text>
              </View>
            )}
          </View>
          {/* Line 2: time/score + matchup chip */}
          <View
            style={[
              pStyles.gameInfoRow,
              { justifyContent: align, flexDirection: rowDir },
            ]}
          >
            {gameInfo ? (
              <Text
                style={[
                  pStyles.gameInfo,
                  { color: c.secondaryText, flexShrink: 1 },
                ]}
                numberOfLines={1}
              >
                {gameInfo}
              </Text>
            ) : null}
            {liveStats.matchup ? (
              <MatchupChip
                matchup={liveStats.matchup}
                isLive={isLive}
                c={c}
              />
            ) : null}
          </View>
          {/* Line 3: stats + fpts */}
          <View style={[pStyles.statsRow, { flexDirection: rowDir }]}>
            {statLine ? (
              <Text
                style={[
                  pStyles.statLine,
                  { color: c.secondaryText, flexShrink: 1 },
                ]}
                numberOfLines={1}
              >
                {statLine}
              </Text>
            ) : null}
            {renderFpts(
              liveFp,
              liveToGameLog(liveStats) as Record<string, number | boolean>,
              liveStats.matchup ?? "",
            )}
          </View>
        </View>
        {side === "right" && headshotEl}
      </Wrapper>
    );
  }

  // ── Past (no live stats) ──────────────────────────────────────────────────
  // Gate on presence of a stat line / matchup, not dayPoints — bench players
  // who played still need their stat line and matchup chip rendered even
  // though their dayPoints stay at 0 (they don't contribute to the score).
  const hasDayGame = !!(player.dayStatLine || player.dayMatchup);
  return (
    <Wrapper
      style={[
        pStyles.cell,
        { flexDirection: "row", alignItems: "center", gap: 4 },
      ]}
      {...wrapperProps}
    >
      {side === "left" && headshotEl}
      <View style={{ flex: 1, alignItems: align }}>
        {/* Line 1: Name + injury (injury toward center) */}
        <View style={[pStyles.nameRow, { justifyContent: align }]}>
          {side === "right" && injuryBadge && (
            <View
              style={[
                pStyles.injuryBadge,
                { backgroundColor: injuryBadge.color },
              ]}
            >
              <Text style={[pStyles.injuryText, { color: c.statusText }]}>{injuryBadge.label}</Text>
            </View>
          )}
          <PlayerName
            name={player.name}
            style={[pStyles.name, { color: c.text }]}
            textAlign={textAlign}
          />
          {side === "left" && injuryBadge && (
            <View
              style={[
                pStyles.injuryBadge,
                { backgroundColor: injuryBadge.color },
              ]}
            >
              <Text style={[pStyles.injuryText, { color: c.statusText }]}>{injuryBadge.label}</Text>
            </View>
          )}
        </View>
        {/* Line 2: matchup chip */}
        <View
          style={[
            pStyles.gameInfoRow,
            { justifyContent: align, flexDirection: rowDir },
          ]}
        >
          {hasDayGame && player.dayMatchup ? (
            <MatchupChip
              matchup={player.dayMatchup}
              isLive={false}
              c={c}
            />
          ) : (
            <Text style={[pStyles.meta, { color: c.secondaryText }]}>
              {player.position}
            </Text>
          )}
        </View>
        {/* Line 3: stats + fpts */}
        <View style={[pStyles.statsRow, { flexDirection: rowDir }]}>
          {hasDayGame && player.dayStatLine ? (
            <Text
              style={[pStyles.statLine, { color: c.secondaryText, flexShrink: 1 }]}
              numberOfLines={1}
            >
              {player.dayStatLine}
            </Text>
          ) : null}
          {renderFpts(
            hasDayGame ? player.dayPoints : null,
            hasDayGame ? player.dayGameStats : null,
            player.dayMatchup ?? "",
          )}
        </View>
      </View>
      {side === "right" && headshotEl}
    </Wrapper>
  );
});

// ─── Styles ──────────────────────────────────────────────────────────────────

export const pStyles = StyleSheet.create({
  slotRow: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: s(64),
    paddingVertical: s(8),
    paddingHorizontal: s(8),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  cell: { flex: 1 },
  slotCenter: { width: s(34), alignItems: "center", justifyContent: "center" },
  slotText: { fontSize: ms(10), fontWeight: "600" },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: s(3),
    flexShrink: 1,
  },
  gameInfoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: s(4),
    marginTop: s(3),
  },
  statsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: s(4),
    marginTop: s(3),
  },
  // Explicit lineHeights below tighten the default text bounding boxes so
  // the three rows in a player cell sit at visually equal vertical gaps.
  // Default lineHeight on RN ≈ 1.3× fontSize, which makes the larger FPTS
  // row (ms(15)) eat more vertical space than the smaller meta rows.
  name: { fontSize: ms(12), fontWeight: "500", lineHeight: ms(14) },
  // Position label + small body meta — Oswald varsity caps so it reads
  // the same broadcast voice the roster page uses.
  meta: {
    fontFamily: Fonts.varsityBold,
    fontSize: ms(10),
    lineHeight: ms(13),
    letterSpacing: 1.0,
    textTransform: "uppercase",
  },
  // Live game time + score sits next to the matchup chip and competes for
  // horizontal space, so it reads at a notch smaller than the rest of the
  // varsity-caps voice.
  gameInfo: {
    fontFamily: Fonts.varsityBold,
    fontSize: ms(8.5),
    lineHeight: ms(11),
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  // Mono stat line ("20P 8R 5A") + FPTS — same family the roster slot uses
  // so the two pages read as one numeric voice.
  statLine: {
    fontFamily: Fonts.mono,
    fontSize: ms(10),
    lineHeight: ms(13),
    letterSpacing: 0.4,
  },
  pts: {
    fontFamily: Fonts.mono,
    fontSize: ms(15),
    lineHeight: ms(16),
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  injuryBadge: { paddingHorizontal: s(4), paddingVertical: 1, borderRadius: 3 },
  injuryText: {
    fontSize: ms(8),
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  headshotCircle: {
    width: s(38),
    height: s(38),
    borderRadius: 20,
    borderWidth: 1.5,
    overflow: "hidden" as const,
  },
  headshotImg: {
    position: "absolute" as const,
    bottom: -2,
    left: 0,
    right: 0,
    height: s(34),
  },
});
