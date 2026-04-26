import { Image } from "expo-image";
import React, { useEffect, useRef } from "react";
import {
  Animated,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { Colors } from "@/constants/Colors";
import { useActiveLeagueSport } from "@/hooks/useActiveLeagueSport";
import { useColorScheme } from "@/hooks/useColorScheme";
import { ScoringWeight } from "@/types/player";
import { getInjuryBadge } from "@/utils/nba/injuryBadge";
import {
  formatGameInfo,
  LivePlayerStats,
  liveToGameLog,
} from "@/utils/nba/nbaLive";
import { formatGameTime, ScheduleEntry } from "@/utils/nba/nbaSchedule";
import { getPlayerHeadshotUrl, PLAYER_SILHOUETTE } from "@/utils/nba/playerHeadshot";
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
// Only includes stats that the league actually scores.
export function buildStatLine(
  stats: Record<string, number>,
  _scoring: ScoringWeight[],
): string {
  const LIVE_KEY: Record<string, string> = {
    PTS: "pts",
    REB: "reb",
    AST: "ast",
  };

  return ["PTS", "REB", "AST"]
    .map((key) => `${stats[LIVE_KEY[key]] ?? 0} ${key}`)
    .join(" · ");
}

// ─── Sub-components ──────────────────────────────────────────────────────────

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

// ─── Sub-components: Matchup Chip ────────────────────────────────────────────

function MatchupChip({
  matchup,
  isLive,
  cardAlt,
  secondaryText,
  successColor,
  gameTimeUtc,
}: {
  matchup: string;
  isLive: boolean;
  cardAlt: string;
  secondaryText: string;
  successColor: string;
  gameTimeUtc?: string | null;
}) {
  const timeLabel = gameTimeUtc && !isLive ? formatGameTime(gameTimeUtc) : null;
  const display = timeLabel ? `${matchup} · ${timeLabel}` : matchup;
  return (
    <View
      style={[
        pStyles.matchupChip,
        { backgroundColor: cardAlt },
        isLive && [pStyles.matchupChipLive, { borderColor: successColor }],
      ]}
      accessibilityLabel={`Matchup: ${matchup}${timeLabel ? `, ${timeLabel}` : ""}${isLive ? ", live" : ""}`}
    >
      <Text
        style={[
          pStyles.matchupChipText,
          { color: isLive ? successColor : secondaryText },
        ]}
      >
        {display}
      </Text>
    </View>
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

  const headshotUrl = getPlayerHeadshotUrl(player.external_id_nba, sport);
  const headshotEl = (
    <View
      style={[
        pStyles.headshotCircle,
        { borderColor: c.heritageGold, backgroundColor: c.cardAlt },
      ]}
      accessibilityLabel={`${player.name} headshot`}
    >
      <Image
        source={headshotUrl ? { uri: headshotUrl } : PLAYER_SILHOUETTE}
        style={pStyles.headshotImg}
        contentFit="cover"
        cachePolicy="memory-disk"
        recyclingKey={headshotUrl ?? "silhouette"}
        placeholder={PLAYER_SILHOUETTE}
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
            <Text
              style={[
                pStyles.name,
                { color: c.text, flexShrink: 1, textAlign },
              ]}
              numberOfLines={1}
            >
              {player.name}
            </Text>
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
          {/* Line 2: matchup chip with game time */}
          <View
            style={[
              pStyles.gameInfoRow,
              { justifyContent: align, flexDirection: rowDir },
            ]}
          >
            {schedEntry ? (
              <MatchupChip
                matchup={schedEntry.matchup}
                isLive={false}
                cardAlt={c.cardAlt}
                secondaryText={c.secondaryText}
                successColor={c.success}
                gameTimeUtc={schedEntry.gameTimeUtc}
              />
            ) : (
              <Text style={[pStyles.meta, { color: c.secondaryText }]}>
                {player.position}
              </Text>
            )}
          </View>
          {/* Line 3: 0.0 if has game, — if not */}
          {!isCategories && (
            <View style={[pStyles.statsRow, { flexDirection: rowDir }]}>
              <Text
                style={[
                  pStyles.pts,
                  { color: schedEntry ? c.text : c.secondaryText, textAlign },
                ]}
              >
                {schedEntry ? "0.0" : "—"}
              </Text>
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
            <Text
              style={[
                pStyles.name,
                { color: c.text, flexShrink: 1, textAlign },
              ]}
              numberOfLines={1}
            >
              {player.name}
            </Text>
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
                style={[pStyles.meta, { color: c.secondaryText }]}
                numberOfLines={1}
              >
                {gameInfo}
              </Text>
            ) : null}
            {liveStats.matchup ? (
              <MatchupChip
                matchup={liveStats.matchup}
                isLive={isLive}
                cardAlt={c.cardAlt}
                secondaryText={c.secondaryText}
                successColor={c.success}
              />
            ) : null}
          </View>
          {/* Line 3: stats + fpts */}
          <View style={[pStyles.statsRow, { flexDirection: rowDir }]}>
            {statLine ? (
              <Text
                style={[
                  pStyles.meta,
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
  const hasDayGame = player.dayPoints > 0;
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
          <Text
            style={[pStyles.name, { color: c.text, flexShrink: 1, textAlign }]}
            numberOfLines={1}
          >
            {player.name}
          </Text>
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
              cardAlt={c.cardAlt}
              secondaryText={c.secondaryText}
              successColor={c.success}
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
              style={[pStyles.meta, { color: c.secondaryText, flexShrink: 1 }]}
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
    paddingVertical: s(6),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  cell: { flex: 1, paddingHorizontal: s(2) },
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
    marginTop: 1,
  },
  statsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: s(6),
    marginTop: 1,
  },
  name: { fontSize: ms(12), fontWeight: "500" },
  meta: { fontSize: ms(10) },
  pts: { fontSize: ms(15), fontWeight: "700" },
  matchupChip: { paddingHorizontal: s(4), paddingVertical: 1, borderRadius: 3 },
  matchupChipLive: { borderWidth: 1 },
  matchupChipText: { fontSize: ms(9), fontWeight: "600" },
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
