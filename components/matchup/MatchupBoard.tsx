import { Text, View } from "react-native";

import { CategoryScoreboard } from "@/components/matchup/CategoryScoreboard";
import {
  type MatchupSlotEntry,
  type TeamMatchupData,
} from "@/components/matchup/matchupData";
import { colStyles } from "@/components/matchup/matchupStyles";
import {
  DisplayMode,
  PlayerCell,
  pStyles,
  RosterPlayer,
} from "@/components/matchup/PlayerCell";
import { SectionEyebrow } from "@/components/roster/SectionEyebrow";
import { ScoringWeight } from "@/types/player";
import { liveToGameLog, type LivePlayerStats } from "@/utils/nba/nbaLive";
import { slotLabel } from "@/utils/roster/rosterSlots";
import { ROSTER_SLOT } from "@/utils/roster/rosterSlotsShared";
import {
  computeCategoryResults,
  type TeamStatTotals,
} from "@/utils/scoring/categoryScoring";

interface MatchupBoardProps {
  leftTeam: TeamMatchupData;
  rightTeam: TeamMatchupData | null;
  leftSlots: MatchupSlotEntry[];
  rightSlots: MatchupSlotEntry[];
  c: any;
  mode: DisplayMode;
  liveMap: Map<string, LivePlayerStats>;
  scoring: ScoringWeight[];
  futureSchedule?: Map<string, any>;
  seedMap?: Map<string, number>;
  onPlayerPress?: (playerId: string) => void;
  onFptsPress?: (
    stats: Record<string, number | boolean>,
    playerName: string,
    gameLabel: string,
  ) => void;
  scoringType?: string;
}

// Renders the matchup body: starter card + bench card + (categories) scoreboard.
// Score block + day picker now live in MatchupHero — this component is purely
// the per-slot rosters.
export function MatchupBoard({
  leftTeam,
  rightTeam,
  leftSlots,
  rightSlots,
  c,
  mode,
  liveMap,
  scoring,
  futureSchedule,
  seedMap,
  onPlayerPress,
  onFptsPress,
  scoringType,
}: MatchupBoardProps) {
  const isCategories = scoringType === "h2h_categories";

  // Merge live in-progress game stats into a team's DB-based teamStats
  const mergeWithLive = (team: TeamMatchupData): TeamStatTotals => {
    if (liveMap.size === 0) return team.teamStats;
    const merged = { ...team.teamStats };
    for (const p of team.players) {
      if (p.roster_slot === 'BE' || p.roster_slot === 'IR' || p.roster_slot === ROSTER_SLOT.DROPPED) continue;
      const live = liveMap.get(p.player_id);
      if (!live) continue;
      const gameLog = liveToGameLog(live);
      for (const [key, val] of Object.entries(gameLog)) {
        if (val == null) continue;
        const numVal = typeof val === 'boolean' ? (val ? 1 : 0) : Number(val);
        merged[key] = (merged[key] ?? 0) + numVal;
      }
    }
    return merged;
  };

  // For category leagues, compute live category comparison
  const categoryComparison =
    isCategories && rightTeam
      ? computeCategoryResults(
          mergeWithLive(leftTeam),
          mergeWithLive(rightTeam),
          scoring.map((s) => ({ stat_name: s.stat_name, inverse: s.inverse ?? false })),
        )
      : null;

  // Use the longer slot list (should always be the same length)
  const slotCount = Math.max(leftSlots.length, rightSlots.length);

  // Bench rosters precomputed here so the eyebrow can reflect counts.
  const leftStarterIds = new Set(
    leftSlots.filter((s) => s.player).map((s) => s.player!.player_id),
  );
  const leftBench = leftTeam.players.filter(
    (p) =>
      !leftStarterIds.has(p.player_id) &&
      p.roster_slot !== "IR" &&
      p.roster_slot !== ROSTER_SLOT.DROPPED &&
      p.roster_slot !== ROSTER_SLOT.TAXI,
  );
  const rightStarterIds = new Set(
    rightSlots.filter((s) => s.player).map((s) => s.player!.player_id),
  );
  const rightBench =
    rightTeam?.players.filter(
      (p) =>
        !rightStarterIds.has(p.player_id) &&
        p.roster_slot !== "IR" &&
        p.roster_slot !== ROSTER_SLOT.DROPPED &&
        p.roster_slot !== ROSTER_SLOT.TAXI,
    ) ?? [];
  const maxBench = Math.max(leftBench.length, rightBench.length);
  const hasBench = maxBench > 0;

  const leftIR = leftTeam.players.filter((p) => p.roster_slot === "IR");
  const rightIR =
    rightTeam?.players.filter((p) => p.roster_slot === "IR") ?? [];
  const maxIR = Math.max(leftIR.length, rightIR.length);
  const hasIR = maxIR > 0;

  const renderSlotRow = (
    key: string,
    idx: number,
    lPlayer: RosterPlayer | null,
    rPlayer: RosterPlayer | null,
    slotPos: string,
    isLast: boolean,
    isBench: boolean,
  ) => (
    <View
      key={key}
      style={[
        pStyles.slotRow,
        { borderBottomColor: c.border },
        idx % 2 === 1 && { backgroundColor: c.cardAlt },
        isLast && { borderBottomWidth: 0 },
        isBench && { opacity: 0.85 },
      ]}
    >
      <PlayerCell
        player={lPlayer}
        c={c}
        side="left"
        mode={mode}
        liveStats={
          lPlayer ? (liveMap.get(lPlayer.player_id) ?? null) : null
        }
        scoring={scoring}
        futureSchedule={futureSchedule}
        onPress={onPlayerPress}
        isCategories={isCategories}
        onFptsPress={onFptsPress}
      />
      {/* Slot pill — informational only on the matchup page (lineup edits
          live on the roster tab), so we render it dimmed to mirror the
          roster's locked-state pill. */}
      <View
        style={[
          colStyles.slotPill,
          {
            backgroundColor: c.cardAlt,
            borderColor: c.border,
            opacity: 0.6,
          },
        ]}
      >
        <Text style={[colStyles.slotPillText, { color: c.secondaryText }]}>
          {slotLabel(slotPos)}
        </Text>
      </View>
      <PlayerCell
        player={rPlayer}
        c={c}
        side="right"
        mode={mode}
        liveStats={
          rPlayer ? (liveMap.get(rPlayer.player_id) ?? null) : null
        }
        scoring={scoring}
        futureSchedule={futureSchedule}
        onPress={onPlayerPress}
        isCategories={isCategories}
        onFptsPress={onFptsPress}
      />
    </View>
  );

  return (
    <View>
      {/* Category scoreboard (only for category leagues — replaces the
          fpts-based score block in the hero conceptually). */}
      {isCategories && categoryComparison && (
        <View style={colStyles.sectionWrap}>
          <SectionEyebrow label="CATEGORIES" />
          <View
            style={[
              colStyles.card,
              { backgroundColor: c.card, borderColor: c.border },
            ]}
          >
            <CategoryScoreboard
              results={categoryComparison.results}
              homeWins={categoryComparison.homeWins}
              awayWins={categoryComparison.awayWins}
              ties={categoryComparison.ties}
              homeTeamName={`${seedMap?.has(leftTeam.teamId) ? `#${seedMap.get(leftTeam.teamId)} ` : ""}${leftTeam.teamName}`}
              awayTeamName={
                rightTeam
                  ? `${rightTeam.teamName}${seedMap?.has(rightTeam.teamId) ? ` #${seedMap.get(rightTeam.teamId)}` : ""}`
                  : "BYE"
              }
            />
          </View>
        </View>
      )}

      {/* Starters card */}
      <View style={colStyles.sectionWrap}>
        <SectionEyebrow label="STARTERS" />
        <View
          style={[
            colStyles.card,
            { backgroundColor: c.card, borderColor: c.border },
          ]}
        >
          {Array.from({ length: slotCount }).map((_, i) => {
            const lSlot = leftSlots[i] ?? null;
            const rSlot = rightSlots[i] ?? null;
            const slotPos =
              lSlot?.slotPosition ?? rSlot?.slotPosition ?? "";
            return renderSlotRow(
              `slot-${i}`,
              i,
              lSlot?.player ?? null,
              rSlot?.player ?? null,
              slotPos,
              i === slotCount - 1,
              false,
            );
          })}
        </View>
      </View>

      {/* Bench card */}
      {hasBench && (
        <View style={colStyles.sectionWrap}>
          <SectionEyebrow label="BENCH" />
          <View
            style={[
              colStyles.card,
              { backgroundColor: c.card, borderColor: c.border },
            ]}
          >
            {Array.from({ length: maxBench }).map((_, i) =>
              renderSlotRow(
                `bench-${i}`,
                i,
                leftBench[i] ?? null,
                rightBench[i] ?? null,
                "BE",
                i === maxBench - 1,
                true,
              ),
            )}
          </View>
        </View>
      )}

      {/* IR card */}
      {hasIR && (
        <View style={colStyles.sectionWrap}>
          <SectionEyebrow label="INJURED RESERVE" />
          <View
            style={[
              colStyles.card,
              { backgroundColor: c.card, borderColor: c.border },
            ]}
          >
            {Array.from({ length: maxIR }).map((_, i) =>
              renderSlotRow(
                `ir-${i}`,
                i,
                leftIR[i] ?? null,
                rightIR[i] ?? null,
                "IR",
                i === maxIR - 1,
                true,
              ),
            )}
          </View>
        </View>
      )}
    </View>
  );
}
