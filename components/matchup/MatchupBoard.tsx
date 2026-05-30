import { Text, View } from "react-native";

import { CategoryScoreboard } from "@/components/matchup/CategoryScoreboard";
import {
  computeLiveCategoryResults,
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
import { type LivePlayerStats } from "@/utils/nba/nbaLive";
import { slotLabel } from "@/utils/roster/rosterSlots";
import { ROSTER_SLOT } from "@/utils/roster/rosterSlotsShared";

interface MatchupBoardProps {
  leftTeam: TeamMatchupData;
  rightTeam: TeamMatchupData | null;
  leftSlots: MatchupSlotEntry[];
  rightSlots: MatchupSlotEntry[];
  c: any;
  mode: DisplayMode;
  liveMap: Map<string, LivePlayerStats>;
  scoring: ScoringWeight[];
  schedule?: Map<string, any>;
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
  schedule,
  seedMap,
  onPlayerPress,
  onFptsPress,
  scoringType,
}: MatchupBoardProps) {
  const isCategories = scoringType === "h2h_categories";

  // For category leagues, compute the live category comparison (active
  // starters only, with in-progress games merged in). Shared helper keeps this
  // identical to the hero's week-wide tally.
  const categoryComparison = isCategories
    ? computeLiveCategoryResults(leftTeam, rightTeam, scoring, liveMap)
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
        schedule={schedule}
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
        schedule={schedule}
        onPress={onPlayerPress}
        isCategories={isCategories}
        onFptsPress={onFptsPress}
      />
    </View>
  );

  return (
    <View>
      {/* Category scoreboard (only for category leagues — the per-category
          breakdown that backs the win tally shown in the hero). */}
      {isCategories && categoryComparison && rightTeam && (
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
              homeName={leftTeam.tricode ?? leftTeam.teamName}
              awayName={rightTeam.tricode ?? rightTeam.teamName}
              homeSeed={seedMap?.get(leftTeam.teamId)}
              awaySeed={seedMap?.get(rightTeam.teamId)}
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
