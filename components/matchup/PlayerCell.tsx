import { Image } from "expo-image";
import React, { useEffect, useRef } from "react";
import {
  Animated,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { MatchupChip } from "@/components/player/MatchupChip";
import { PlayerHeadshotImage } from "@/components/player/PlayerHeadshotImage";
import { PlayerName } from "@/components/player/PlayerName";
import { rosterStyles } from "@/components/roster/rosterStyles";
import { Colors, Fonts } from "@/constants/Colors";
import { useActiveLeagueSport } from "@/hooks/useActiveLeagueSport";
import { useColorScheme } from "@/hooks/useColorScheme";
import { ScoringWeight } from "@/types/player";
import { getInjuryBadge } from "@/utils/nba/injuryBadge";
import {
  formatClock,
  formatGameInfo,
  LivePlayerStats,
  liveToGameLog,
} from "@/utils/nba/nbaLive";
import { formatGameTime, ScheduleEntry } from "@/utils/nba/nbaSchedule";
import { getTeamLogoUrl } from "@/utils/nba/playerHeadshot";
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
  /** Active (started) games this player had during the week — used to
   *  scale season-average expectation for the weekly performance bar. */
  weekGames: number;
  dayPoints: number;
  dayMatchup: string | null;
  dayStatLine: string | null;
  projectedFpts: number | null;
  /** Raw per-game season average (not zeroed for dropped/OUT) — baseline
   *  for the weekly summary's vs-expected indicator. */
  seasonAvgFpts: number | null;
  dayGameStats?: Record<string, number | boolean> | null;
  weekGameStats?: Record<string, number> | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function round1(n: number) {
  return Math.round(n * 100) / 100;
}

// Build a stat line string for a live/historical stat object.
// Always shows all three categories (including zeros, e.g. "0R") so the line
// keeps a stable shape, but stays compact — single-space separated, no digit
// padding — so it reads cleanly and never grows wide enough to truncate.
export function buildStatLine(
  stats: Record<string, number>,
  _scoring: ScoringWeight[],
): string {
  const fields: [string, string][] = [
    ["pts", "P"],
    ["reb", "R"],
    ["ast", "A"],
  ];
  return fields.map(([key, label]) => `${stats[key] ?? 0}${label}`).join(" ");
}

// Compact live game status for the half-width matchup cell, e.g. "Q3 9:43 48-52"
// or "HALF 48-52". The roster page uses the verbose formatGameInfo ("3rd 9:43 ·
// 48-52"); here space is tight, so the period abbreviates to Q# and the
// separators are dropped to fit the chip line without truncating.
function compactLiveInfo(live: LivePlayerStats): string {
  const isAway = live.matchup?.startsWith("@");
  const myScore = isAway ? live.away_score : live.home_score;
  const oppScore = isAway ? live.home_score : live.away_score;
  const score = `${myScore}-${oppScore}`;
  const clock = formatClock(live.game_clock);
  if (live.period === 2 && (!clock || clock === "0:00")) return `HALF ${score}`;
  const period =
    live.period <= 4
      ? `Q${live.period}`
      : live.period === 5
        ? "OT"
        : `OT${live.period - 4}`;
  return clock ? `${period} ${clock} ${score}` : `${period} ${score}`;
}

// ─── Sub-components ──────────────────────────────────────────────────────────

// Static green dot shown when player is actively on the floor. Shared with the
// roster + team-roster rows so the on-court cue reads identically everywhere.
export function OnCourtDot() {
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

// Stat line as fixed-width blocks — each category (P/R/A) sits in its own
// equal-width slot so single- and double-digit values line up in columns and
// the whole line is a CONSTANT width. That fixed width is what lets the FPTS
// after it lock to one position for every player.
const STAT_FIELDS: [string, string][] = [
  ["pts", "P"],
  ["reb", "R"],
  ["ast", "A"],
];
// Category leagues hide the FPTS column, freeing room for two more stat
// blocks. Steals/blocks are the most-scored extra cats, so we surface them
// here (the full per-category breakdown still lives in the scoreboard above).
const CAT_STAT_FIELDS: [string, string][] = [
  ...STAT_FIELDS,
  ["stl", "S"],
  ["blk", "B"],
];
function StatBlocks({
  stats,
  color,
  fields,
}: {
  stats: Record<string, number | boolean> | null | undefined;
  color: string;
  fields: [string, string][];
}) {
  return (
    <View style={pStyles.statBlocks}>
      {fields.map(([key, label]) => (
        <Text key={label} style={[pStyles.statBlock, { color }]} numberOfLines={1}>
          {Number(stats?.[key] ?? 0)}
          {label}
        </Text>
      ))}
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
  schedule,
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
  schedule?: Map<string, ScheduleEntry>;
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
  // Both info lines flow from the portrait/outer side: line 2 leads with the
  // opponent chip then the game status; line 3 leads with the stat blocks then
  // the FPTS. row-reverse on the right side mirrors that flow.
  const rowDir = side === "left" ? ("row" as const) : ("row-reverse" as const);
  // FPTS locks to a fixed column near the center seam (a spacer fills the gap
  // between the fixed-width stat blocks and it); centerPad keeps it off the pill.
  const centerPad =
    side === "left" ? { paddingRight: s(6) } : { paddingLeft: s(6) };

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

  // Headshot + team-logo pill. The gold border is constant in every state —
  // on-court is signalled by the dot on the name line, not by the border.
  const logoUrl = player.nbaTricode ? getTeamLogoUrl(player.nbaTricode, sport) : null;
  const headshotEl = (
    <View style={pStyles.portraitWrap} accessibilityLabel={`${player.name} headshot`}>
      <View
        style={[
          pStyles.headshotCircle,
          { borderColor: c.heritageGold, backgroundColor: c.cardAlt },
        ]}
      >
        <PlayerHeadshotImage
          externalIdNba={player.external_id_nba}
          sport={sport}
          style={pStyles.headshotImg}
        />
      </View>
      {player.nbaTricode && (
        <View
          style={rosterStyles.rosterTeamPill}
          importantForAccessibility="no"
          accessibilityElementsHidden
        >
          {logoUrl && (
            <Image
              source={{ uri: logoUrl }}
              style={rosterStyles.rosterTeamPillLogo}
              contentFit="contain"
              cachePolicy="memory-disk"
              recyclingKey={logoUrl}
            />
          )}
          <Text style={[rosterStyles.rosterTeamPillText, { color: c.statusText }]}>
            {player.nbaTricode}
          </Text>
        </View>
      )}
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
        activeColor={c.accent}
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
      ? (schedule?.get(player.nbaTricode) ?? null)
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
        <View style={[pStyles.infoCol, { alignItems: align }]}>
          {/* Line 1 — Identity: name + injury (injury toward center) */}
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
              style={[pStyles.name, { color: c.text, textAlign }]}
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
          {/* Line 2 — Game: opponent chip (beside the portrait) + tipoff caption.
              Pre-game has no production, so there's no Line 3. Falls back to the
              position label with no schedule entry. */}
          <View
            style={[
              pStyles.gameInfoRow,
              { justifyContent: align, flexDirection: rowDir },
            ]}
          >
            {schedEntry ? (
              <>
                <MatchupChip matchup={schedEntry.matchup} isLive={false} c={c} />
                {schedEntry.gameTimeUtc ? (
                  <Text style={[pStyles.gameInfo, { color: c.secondaryText }]}>
                    {formatGameTime(schedEntry.gameTimeUtc)}
                  </Text>
                ) : null}
              </>
            ) : (
              <Text style={[pStyles.meta, { color: c.secondaryText }]}>
                {player.position}
              </Text>
            )}
          </View>
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
    const hasStarted = liveStats.game_status !== 1;
    // Live games show a compact "Q3 9:43 48-52"; finished games drop the
    // "Final" word entirely and show just the "85-75" score.
    const isFinalGame = liveStats.game_status === 3;
    const gameInfo = isFinalGame
      ? formatGameInfo(liveStats).replace(/^Final\s*·\s*/i, "")
      : isLive
        ? compactLiveInfo(liveStats)
        : "";

    return (
      <Wrapper
        style={[
          pStyles.cell,
          { flexDirection: "row", alignItems: "center", gap: 4 },
        ]}
        {...wrapperProps}
      >
        {side === "left" && headshotEl}
        <View style={[pStyles.infoCol, { alignItems: align }]}>
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
              style={[pStyles.name, { color: c.text, textAlign }]}
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
          {/* Line 2 — Game: opponent chip (beside the portrait) + condensed
              clock/score (or empty pre-tip) */}
          <View
            style={[
              pStyles.gameInfoRow,
              { justifyContent: align, flexDirection: rowDir },
            ]}
          >
            {liveStats.matchup ? (
              <MatchupChip
                matchup={liveStats.matchup}
                isLive={isLive}
                c={c}
              />
            ) : null}
            {gameInfo ? (
              <Text
                style={[
                  pStyles.gameInfo,
                  { color: isLive ? c.success : c.secondaryText, flexShrink: 1 },
                ]}
                numberOfLines={1}
              >
                {gameInfo}
              </Text>
            ) : null}
          </View>
          {/* Line 3 — Production: fixed-width stat blocks at the outer edge, a
              spacer, then the FPTS locked at the center column. Only once the
              game has tipped. */}
          {hasStarted ? (
            <View style={[pStyles.statsRow, { flexDirection: rowDir }, centerPad]}>
              <StatBlocks
                stats={liveToGameLog(liveStats) as Record<string, number | boolean>}
                color={c.secondaryText}
                fields={isCategories ? CAT_STAT_FIELDS : STAT_FIELDS}
              />
              {!isCategories && (
                <View
                  style={[
                    pStyles.fptsSlot,
                    { alignItems: side === "left" ? "flex-end" : "flex-start" },
                  ]}
                >
                  {renderFpts(
                    liveFp,
                    liveToGameLog(liveStats) as Record<string, number | boolean>,
                    liveStats.matchup ?? "",
                  )}
                </View>
              )}
            </View>
          ) : null}
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
  // Real final score for the game, read from the persisted schedule (live stats
  // have long expired by the time a day is "past"), oriented to this team.
  const schedEntry = player.nbaTricode
    ? (schedule?.get(player.nbaTricode) ?? null)
    : null;
  const finalScore = schedEntry?.score ?? null;
  // Team played but the player has no box-score row (injured/inactive — BDL
  // omits non-participants, so no player_games row is ever written). Show the
  // matchup + "DNP" so the day reads "game happened, player sat" rather than
  // looking identical to a day the team didn't play.
  const didNotPlay = !hasDayGame && !!schedEntry;
  const pastMatchup =
    player.dayMatchup ?? (didNotPlay ? schedEntry!.matchup : null);
  return (
    <Wrapper
      style={[
        pStyles.cell,
        { flexDirection: "row", alignItems: "center", gap: 4 },
      ]}
      {...wrapperProps}
    >
      {side === "left" && headshotEl}
      <View style={[pStyles.infoCol, { alignItems: align }]}>
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
            style={[pStyles.name, { color: c.text, textAlign }]}
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
        {/* Line 2 — Game: opponent chip (beside the portrait) + the real final
            score, read from the persisted schedule so it survives live-stat TTL. */}
        <View
          style={[
            pStyles.gameInfoRow,
            { justifyContent: align, flexDirection: rowDir },
          ]}
        >
          {pastMatchup ? (
            <>
              <MatchupChip matchup={pastMatchup} isLive={false} c={c} />
              {finalScore ? (
                <Text
                  style={[pStyles.gameInfo, { color: c.secondaryText }]}
                  numberOfLines={1}
                >
                  {finalScore}
                </Text>
              ) : didNotPlay ? (
                <Text
                  style={[pStyles.gameInfo, { color: c.secondaryText }]}
                  numberOfLines={1}
                >
                  DNP
                </Text>
              ) : null}
            </>
          ) : (
            <Text style={[pStyles.meta, { color: c.secondaryText }]}>
              {player.position}
            </Text>
          )}
        </View>
        {/* Line 3 — Production: fixed-width stat blocks + FPTS locked at the
            center column (only when the player played). */}
        {hasDayGame ? (
          <View style={[pStyles.statsRow, { flexDirection: rowDir }, centerPad]}>
            <StatBlocks
              stats={player.dayGameStats}
              color={c.secondaryText}
              fields={isCategories ? CAT_STAT_FIELDS : STAT_FIELDS}
            />
            {!isCategories && (
              <View
                style={[
                  pStyles.fptsSlot,
                  { alignItems: side === "left" ? "flex-end" : "flex-start" },
                ]}
              >
                {renderFpts(
                  player.dayPoints,
                  player.dayGameStats,
                  player.dayMatchup ?? "",
                )}
              </View>
            )}
          </View>
        ) : null}
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
  // Each cell's content is vertically centered on its own portrait (the row +
  // wrapper both center-align), so a played player (3 lines) and an unplayed
  // one (2 lines) each sit balanced against their headshot with no pinned-to-
  // top dead space. Names offset between sides when one has more info — that's
  // the intended broadcast-style per-portrait balance.
  infoCol: { flex: 1 },
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
  // Line 3 packs the fixed-width stat blocks and the FPTS toward the center
  // seam (justifyContent flex-end + centerPad), with a small constant gap
  // between them (gap: s(8)) so the last block isn't flush against the FPTS.
  statsRow: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "stretch",
    justifyContent: "flex-end",
    gap: s(6),
    marginTop: s(3),
  },
  // Stat line rendered as equal-width blocks (one per category), value centered
  // in each. Equal widths keep the line a constant total width — single vs
  // double digits never shift anything — so the FPTS after it stays locked.
  // gap guarantees the blocks never touch even when a value grows past the
  // minWidth (e.g. two double-digit stats like "17P" "10R").
  statBlocks: { flexDirection: "row", gap: s(3) },
  statBlock: {
    fontFamily: Fonts.mono,
    fontSize: ms(10),
    lineHeight: ms(13),
    letterSpacing: 0.3,
    minWidth: s(18),
    textAlign: "center",
  },
  // FPTS gets its own fixed-width slot too, so its (varying) width never drags
  // the stat blocks around — the number aligns to the center-seam edge of the
  // slot while the slot's outer edge stays put.
  fptsSlot: { minWidth: s(40) },
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
  // Game status caption beside the opponent pill — live clock·score, "FINAL",
  // or tipoff time. Mono (narrower than the varsity caps) at a small size so
  // the longest case ("3RD 5:16 · 58-43") fits the half-width cell without
  // truncating. flexShrink on the instance keeps the pill intact if it can't.
  gameInfo: {
    fontFamily: Fonts.mono,
    fontSize: ms(8),
    lineHeight: ms(11),
    letterSpacing: 0.2,
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
  // Headline FPTS — the matchup's deciding number, so it's the largest, gold
  // (color applied inline by AnimatedFpts), and weightiest text in the cell.
  pts: {
    fontFamily: Fonts.mono,
    fontSize: ms(16),
    lineHeight: ms(17),
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  injuryBadge: { paddingHorizontal: s(4), paddingVertical: 1, borderRadius: 3 },
  injuryText: {
    fontSize: ms(8),
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  // Wrap anchors the team-logo pill to the portrait base. No overflow:hidden
  // here (only on the circle) so the pill can sit slightly below the headshot.
  portraitWrap: {
    width: s(38),
    height: s(38),
    alignItems: "center",
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
