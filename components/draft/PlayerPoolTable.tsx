import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useCallback } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";

import { PlayerHeadshotImage } from "@/components/player/PlayerHeadshotImage";
import { PlayerName } from "@/components/player/PlayerName";
import { ThemedText } from "@/components/ui/ThemedText";
import { Fonts } from "@/constants/Colors";
import type { Sport } from "@/constants/LeagueDefaults";
import { useColors } from "@/hooks/useColors";
import type { SortKey } from "@/hooks/usePlayerFilter";
import type { PlayerSeasonStats } from "@/types/player";
import { formatPosition } from "@/utils/formatting";
import { getInjuryBadge } from "@/utils/nba/injuryBadge";
import { getTeamLogoUrl } from "@/utils/nba/playerHeadshot";

/**
 * The draft pool as a scouting table — desktop only.
 *
 * The phone renders one card per player because a thumb needs a 74px target and
 * there's only room for a name and a stat blob. A pointer on a monitor wants the
 * opposite: aligned numeric columns it can scan down, headers it can click to
 * re-sort, and enough rows on screen to actually compare. So this isn't the
 * mobile row re-spaced — it's a different reading of the same data, and the
 * phone list in `AvailablePlayers` is left exactly as it was.
 *
 * Draft buttons only render for the row under the pointer (or every row when
 * it's your pick) — a column of 200 disabled grey buttons is noise, and you
 * can't draft off-turn anyway.
 */

type StatCol =
  | "MPG" | "PTS" | "REB" | "AST" | "STL" | "BLK" | "FG%" | "FT%" | "TO" | "FPTS"
  | "GP" | "PASS YDS" | "RUSH YDS" | "REC YDS";

// Column header → the sort key the filter hook understands. NFL stat columns
// have no sort key (usePlayerFilter pins NFL to FPTS) — they render as plain,
// non-clickable headers.
const SORT_FOR: Partial<Record<StatCol, SortKey>> = {
  MPG: "MPG",
  PTS: "PPG",
  REB: "RPG",
  AST: "APG",
  STL: "SPG",
  BLK: "BPG",
  "FG%": "FG%",
  "FT%": "FT%",
  TO: "TO",
  FPTS: "FPTS",
};

const POINTS_COLS: StatCol[] = ["MPG", "PTS", "REB", "AST", "FPTS"];
const CATEGORY_COLS: StatCol[] = ["PTS", "REB", "AST", "STL", "BLK", "FG%", "FT%", "TO"];
// Per-game passing/rushing/receiving yards cover every NFL skill position;
// K/DST rows show dashes there and rank on FPTS like everyone else. GP is the
// sample behind the averages (last season's, pre-season).
const NFL_POINTS_COLS: StatCol[] = ["GP", "PASS YDS", "RUSH YDS", "REC YDS", "FPTS"];

// NFL column → the avg_* season column behind it. Those columns aren't on the
// PlayerSeasonStats type (they ride along from the matview / historical
// merge), so they're read loosely.
const NFL_COL_KEY: Partial<Record<StatCol, string>> = {
  "PASS YDS": "avg_pass_yd",
  "RUSH YDS": "avg_rush_yd",
  "REC YDS": "avg_rec_yd",
};

const NUM_COL_WIDTH = 52;
const FPTS_COL_WIDTH = 62;
// Two-word NFL yardage headers need the extra room at 10px + 1.2 tracking.
const NFL_YDS_COL_WIDTH = 74;

function colWidth(col: StatCol): number {
  if (col === "FPTS") return FPTS_COL_WIDTH;
  if (NFL_COL_KEY[col]) return NFL_YDS_COL_WIDTH;
  return NUM_COL_WIDTH;
}

const fixed1 = (v: number | null | undefined) => (v ?? 0).toFixed(1);

function pct(makes: number | null | undefined, attempts: number | null | undefined): string {
  if (!attempts) return "—";
  return (((makes ?? 0) / attempts) * 100).toFixed(0);
}

function statValue(p: PlayerSeasonStats, col: StatCol, fpts: number | undefined): string {
  const nflKey = NFL_COL_KEY[col];
  if (nflKey) {
    const v = (p as unknown as Record<string, unknown>)[nflKey];
    return v == null ? "—" : fixed1(Number(v));
  }
  switch (col) {
    case "GP":
      return String(p.games_played ?? 0);
    case "MPG":
      return fixed1(p.avg_min);
    case "PTS":
      return fixed1(p.avg_pts);
    case "REB":
      return fixed1(p.avg_reb);
    case "AST":
      return fixed1(p.avg_ast);
    case "STL":
      return fixed1(p.avg_stl);
    case "BLK":
      return fixed1(p.avg_blk);
    case "FG%":
      return pct(p.avg_fgm, p.avg_fga);
    case "FT%":
      return pct(p.avg_ftm, p.avg_fta);
    case "TO":
      return fixed1(p.avg_tov);
    case "FPTS":
      return fpts !== undefined ? fpts.toFixed(1) : "—";
    default:
      // PaYD/RuYD/ReYD are handled by the NFL_COL_KEY branch above; TS just
      // can't see that the Partial covers them.
      return "—";
  }
}

interface PlayerPoolTableProps {
  players: PlayerSeasonStats[];
  sport: Sport;
  isCategories: boolean;
  sortBy: string;
  onSortChange: (sort: string) => void;
  /** Season fantasy points for a player, or undefined in a categories league. */
  fptsFor: (player: PlayerSeasonStats) => number | undefined;
  /** True when the shown line is a projection rather than played games. */
  isProjected: (playerId: string) => boolean;
  /** The player's rank on the viewer's prospect board — rookie drafts only. */
  boardRankFor: (playerId: string) => number | undefined;
  /** Null when the player is draftable; otherwise the blocking limit's label. */
  draftBlockFor: (player: PlayerSeasonStats) => string | null;
  /** The viewer is on the clock and no pick is in flight. */
  canDraft: boolean;
  queuedPlayerIds?: Set<string>;
  addToQueue?: (playerId: string) => void;
  onDraft: (player: PlayerSeasonStats) => void;
  onSelectPlayer: (player: PlayerSeasonStats) => void;
}

export function PlayerPoolTable({
  players,
  sport,
  isCategories,
  sortBy,
  onSortChange,
  fptsFor,
  isProjected,
  boardRankFor,
  draftBlockFor,
  canDraft,
  queuedPlayerIds,
  addToQueue,
  onDraft,
  onSelectPlayer,
}: PlayerPoolTableProps) {
  const c = useColors();
  const cols = sport === "nfl" ? NFL_POINTS_COLS : isCategories ? CATEGORY_COLS : POINTS_COLS;

  const renderRow = useCallback(
    ({ item, index }: { item: PlayerSeasonStats; index: number }) => {
      const fpts = fptsFor(item);
      const badge = getInjuryBadge(item.status);
      const logoUrl = getTeamLogoUrl(item.pro_team, sport);
      const boardRank = boardRankFor(item.player_id);
      const block = draftBlockFor(item);
      const queued = !!queuedPlayerIds?.has(item.player_id);
      const projected = isProjected(item.player_id);

      const statsLabel = cols
        .map((col) => `${col} ${statValue(item, col, fpts)}`)
        .join(", ");

      return (
        <Pressable
          onPress={() => onSelectPlayer(item)}
          accessibilityRole="button"
          accessibilityLabel={
            (boardRank !== undefined ? `Board rank ${boardRank}, ` : "") +
            `${item.name}, ${formatPosition(item.position)}, ${item.pro_team}` +
            (projected ? ", projected" : "") +
            `, ${statsLabel}`
          }
          accessibilityHint="View player details"
          style={({ hovered }: { hovered?: boolean }) => [
            styles.row,
            { borderBottomColor: c.border },
            hovered ? { backgroundColor: c.cardAlt } : null,
          ]}
        >
          {({ hovered }: { hovered?: boolean }) => (
            <>
              <ThemedText style={[styles.rank, { color: c.secondaryText }]}>
                {index + 1}
              </ThemedText>

              <View style={styles.playerCell}>
                <View style={[styles.headshot, { borderColor: c.heritageGold, backgroundColor: c.cardAlt }]}>
                  <PlayerHeadshotImage
                    externalIdNba={item.external_id_nba}
                    sport={sport}
                    style={styles.headshotImg}
                    accessible={false}
                  />
                </View>
                {boardRank !== undefined && (
                  <ThemedText style={[styles.boardRank, { color: c.heritageGold }]}>
                    #{boardRank}
                  </ThemedText>
                )}
                <PlayerName
                  name={item.name}
                  type="defaultSemiBold"
                  style={styles.playerName}
                  containerStyle={styles.playerNameBox}
                />
                {badge && (
                  <View style={[styles.badge, { backgroundColor: badge.color }]} accessible={false}>
                    <Text style={[styles.badgeText, { color: c.statusText }]}>{badge.label}</Text>
                  </View>
                )}
                {projected && (
                  <ThemedText style={[styles.projTag, { color: c.accent }]}>PROJ</ThemedText>
                )}
              </View>

              <ThemedText style={[styles.pos, { color: c.secondaryText }]} numberOfLines={1}>
                {formatPosition(item.position)}
              </ThemedText>

              <View style={styles.teamCell}>
                {logoUrl && (
                  <Image
                    source={{ uri: logoUrl }}
                    style={styles.teamLogo}
                    contentFit="contain"
                    cachePolicy="memory-disk"
                    recyclingKey={logoUrl}
                    accessible={false}
                  />
                )}
                <ThemedText style={[styles.team, { color: c.secondaryText }]}>
                  {item.pro_team}
                </ThemedText>
              </View>

              {cols.map((col) => (
                <ThemedText
                  key={col}
                  style={[
                    styles.stat,
                    { width: colWidth(col) },
                    // SpaceMono ships a single weight and `font-synthesis: none`
                    // is on for web, so FPTS earns its emphasis from color, not
                    // a bold face that would never render.
                    col === "FPTS"
                      ? { color: c.accent }
                      : { color: sortBy === SORT_FOR[col] ? c.text : c.secondaryText },
                  ]}
                >
                  {statValue(item, col, fpts)}
                </ThemedText>
              ))}

              <View style={styles.actions}>
                {/* Off-turn, the Draft button appears on hover only — a full
                    column of disabled buttons reads as broken UI. */}
                {(canDraft || hovered) && (
                  <Pressable
                    onPress={() => onDraft(item)}
                    disabled={!canDraft || !!block}
                    accessibilityRole="button"
                    accessibilityLabel={
                      block
                        ? `${item.name} blocked — roster is full at ${block}`
                        : `Draft ${item.name}`
                    }
                    accessibilityState={{ disabled: !canDraft || !!block }}
                    style={({ hovered: btnHovered }: { hovered?: boolean }) => [
                      styles.draftBtn,
                      block
                        ? { borderColor: c.border, backgroundColor: "transparent" }
                        : canDraft
                          ? { borderColor: c.link, backgroundColor: btnHovered ? c.link : c.link + "22" }
                          : { borderColor: c.border, backgroundColor: "transparent" },
                    ]}
                  >
                    <ThemedText
                      type="varsitySmall"
                      style={[
                        styles.draftBtnText,
                        { color: block ? c.secondaryText : canDraft ? c.text : c.secondaryText },
                      ]}
                      numberOfLines={1}
                    >
                      {block ? `Max ${block}` : "Draft"}
                    </ThemedText>
                  </Pressable>
                )}
                {addToQueue && (
                  <Pressable
                    onPress={() => !queued && addToQueue(item.player_id)}
                    disabled={queued}
                    accessibilityRole="button"
                    accessibilityLabel={
                      queued ? `${item.name} is already in your queue` : `Add ${item.name} to draft queue`
                    }
                    accessibilityState={{ disabled: queued }}
                    style={styles.queueBtn}
                    hitSlop={6}
                  >
                    <Ionicons
                      name={queued ? "checkmark-circle" : "add-circle-outline"}
                      size={20}
                      color={queued ? c.secondaryText : c.accent}
                      accessible={false}
                    />
                  </Pressable>
                )}
              </View>
            </>
          )}
        </Pressable>
      );
    },
    [c, cols, sport, sortBy, fptsFor, isProjected, boardRankFor, draftBlockFor, canDraft, queuedPlayerIds, addToQueue, onDraft, onSelectPlayer],
  );

  return (
    <View style={styles.container}>
      {/* Sticky header — every stat column re-sorts the pool. */}
      <View style={[styles.headerRow, { borderBottomColor: c.border, backgroundColor: c.background }]}>
        <ThemedText type="varsitySmall" style={[styles.rank, styles.headText, { color: c.secondaryText }]}>
          #
        </ThemedText>
        <ThemedText type="varsitySmall" style={[styles.playerCell, styles.headText, { color: c.secondaryText }]}>
          Player
        </ThemedText>
        <ThemedText type="varsitySmall" style={[styles.pos, styles.headText, { color: c.secondaryText }]}>
          Pos
        </ThemedText>
        <ThemedText type="varsitySmall" style={[styles.teamCell, styles.headText, { color: c.secondaryText }]}>
          Team
        </ThemedText>
        {cols.map((col) => {
          const sortKey = SORT_FOR[col];
          if (!sortKey) {
            // No sort behind this column (NFL stat columns — the pool is
            // pinned to FPTS order): plain label, not a dead button.
            return (
              <View key={col} style={[styles.headStat, { width: colWidth(col) }]}>
                <ThemedText
                  type="varsitySmall"
                  style={[styles.headText, styles.headStatText, { color: c.secondaryText }]}
                >
                  {col}
                </ThemedText>
              </View>
            );
          }
          const active = sortBy === sortKey;
          return (
            <Pressable
              key={col}
              onPress={() => onSortChange(sortKey)}
              accessibilityRole="button"
              accessibilityLabel={`Sort by ${col}${active ? ", currently sorted" : ""}`}
              accessibilityState={{ selected: active }}
              style={({ hovered }: { hovered?: boolean }) => [
                styles.headStat,
                { width: colWidth(col) },
                hovered && !active ? { backgroundColor: c.cardAlt } : null,
              ]}
            >
              <ThemedText
                type="varsitySmall"
                style={[styles.headText, styles.headStatText, { color: active ? c.gold : c.secondaryText }]}
              >
                {col}
              </ThemedText>
              {active && (
                <Ionicons name="caret-down" size={8} color={c.gold} style={styles.caret} accessible={false} />
              )}
            </Pressable>
          );
        })}
        <View style={styles.actions} />
      </View>

      <FlatList<PlayerSeasonStats>
        data={players}
        renderItem={renderRow}
        keyExtractor={(item) => item.player_id}
        maxToRenderPerBatch={20}
        windowSize={7}
        removeClippedSubviews
        initialNumToRender={25}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingLeft: 16,
    paddingRight: 12,
    paddingVertical: 7,
    borderBottomWidth: 1,
  },
  headText: {
    fontSize: 10,
    letterSpacing: 1.2,
  },
  headStat: {
    alignItems: "flex-end",
    justifyContent: "center",
    flexDirection: "row",
    gap: 3,
    paddingVertical: 3,
    borderRadius: 4,
  },
  headStatText: {
    textAlign: "right",
  },
  caret: {
    marginBottom: 1,
  },

  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    height: 42,
    paddingLeft: 16,
    paddingRight: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rank: {
    width: 22,
    fontFamily: Fonts.mono,
    fontSize: 11,
    textAlign: "right",
  },
  playerCell: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  headshot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    overflow: "hidden",
  },
  headshotImg: {
    position: "absolute",
    bottom: -1,
    left: 0,
    right: 0,
    height: 24,
  },
  boardRank: {
    fontSize: 11,
    fontWeight: "800",
  },
  playerNameBox: {
    flexShrink: 1,
  },
  playerName: {
    fontSize: 13.5,
  },
  badge: {
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3,
  },
  badgeText: {
    fontSize: 8,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  projTag: {
    fontSize: 8,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  pos: {
    width: 62,
    fontSize: 11.5,
  },
  teamCell: {
    width: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  teamLogo: {
    width: 14,
    height: 14,
  },
  team: {
    fontFamily: Fonts.mono,
    fontSize: 11,
  },
  stat: {
    fontFamily: Fonts.mono,
    fontSize: 12,
    textAlign: "right",
  },
  actions: {
    width: 96,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 6,
  },
  draftBtn: {
    minWidth: 62,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderRadius: 5,
  },
  draftBtnText: {
    fontSize: 10,
    letterSpacing: 0.9,
  },
  queueBtn: {
    width: 20,
    alignItems: "center",
    justifyContent: "center",
  },
});
