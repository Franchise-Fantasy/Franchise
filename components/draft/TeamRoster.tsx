import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { Image } from "expo-image";
import { useState } from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { PlayerHeadshotImage } from "@/components/player/PlayerHeadshotImage";
import { PlayerName } from "@/components/player/PlayerName";
import {
  rosterStyles as styles,
  slotPillVariant,
} from "@/components/roster/rosterStyles";
import { SectionEyebrow } from "@/components/roster/SectionEyebrow";
import { LogoSpinner } from "@/components/ui/LogoSpinner";
import { ThemedText } from "@/components/ui/ThemedText";
import { queryKeys } from "@/constants/queryKeys";
import { useActiveLeagueSport } from "@/hooks/useActiveLeagueSport";
import { useColors } from "@/hooks/useColors";
import { useLeagueRosterConfig } from "@/hooks/useLeagueRosterConfig";
import { useLeagueScoring } from "@/hooks/useLeagueScoring";
import { useLeagueScoringType } from "@/hooks/useLeagueScoringType";
import { supabase } from "@/lib/supabase";
import { PlayerSeasonStats } from "@/types/player";
import { formatPosition } from "@/utils/formatting";
import { getInjuryBadge } from "@/utils/nba/injuryBadge";
import { getTeamLogoUrl } from "@/utils/nba/playerHeadshot";
import { slotLabel } from "@/utils/roster/rosterSlots";
import {
  isEligibleForSlot,
  SLOT_ELIGIBLE_POSITIONS,
} from "@/utils/roster/rosterSlotsShared";
import { ms, s } from "@/utils/scale";
import { calculateAvgFantasyPoints } from "@/utils/scoring/fantasyPoints";

import { PlayerDetailModal } from "../player/PlayerDetailModal";

interface TeamRosterProps {
  teamId: string;
  leagueId: string;
}

interface RosterPlayer extends PlayerSeasonStats {
  roster_slot: string | null;
}

interface SlotEntry {
  slotPosition: string;
  slotIndex: number;
  player: RosterPlayer | null;
}

// Order position slots read in left-to-right; the league config decides which
// of these actually appear (NBA runs PG/SG/SF/PF/C ± G/F flex; WNBA runs G/F/C).
const POSITION_SLOT_ORDER = ["PG", "SG", "G", "SF", "PF", "F", "C"];

export function TeamRoster({ teamId, leagueId }: TeamRosterProps) {
  const c = useColors();
  const sport = useActiveLeagueSport(leagueId);
  const [selectedPlayer, setSelectedPlayer] =
    useState<PlayerSeasonStats | null>(null);

  const { data: scoringWeights } = useLeagueScoring(leagueId);
  const { isCategories } = useLeagueScoringType(leagueId);
  const { data: rosterConfig, isLoading: isLoadingConfig } =
    useLeagueRosterConfig(leagueId);

  const { data: rosterPlayers, isLoading: isLoadingPlayers } = useQuery<
    RosterPlayer[]
  >({
    // Distinct from the thin {position, roster_slot} position-limit query that
    // AvailablePlayers / DraftQueue cache under the bare teamRoster(teamId) key.
    // Sharing that key let their lighter shape populate the cache first (they're
    // mounted before this tab), so this view rendered blank names/stats/photos
    // until a roster-change invalidation forced a refetch of the full shape.
    // Still under the "teamRoster" prefix, so every broad invalidation hits it.
    queryKey: queryKeys.teamRoster(teamId, "draft"),
    queryFn: async () => {
      const { data: leaguePlayers, error: lpError } = await supabase
        .from("league_players")
        .select("player_id, roster_slot")
        .eq("team_id", teamId);

      if (lpError) throw lpError;
      if (!leaguePlayers || leaguePlayers.length === 0) return [];

      const playerIds = leaguePlayers.map((lp) => lp.player_id);

      // Stats come from the player_season_stats materialized view, but identity
      // (name / position / headshot / team) is backstopped by the players table.
      // Otherwise a row blanks out when the matview lags a fresh draft pick, or
      // shows no team pill for a player currently between teams (null pro_team).
      // We map over leaguePlayers (not stats) so a player missing from the
      // matview still renders rather than vanishing into an empty slot.
      const [statsRes, identRes] = await Promise.all([
        supabase.from("player_season_stats").select("*").in("player_id", playerIds),
        supabase
          .from("players")
          .select("id, name, position, pro_team, external_id_nba, status")
          .in("id", playerIds),
      ]);

      if (statsRes.error) throw statsRes.error;
      if (identRes.error) throw identRes.error;

      const statMap = new Map(
        (statsRes.data ?? []).map((p) => [p.player_id, p as PlayerSeasonStats]),
      );
      const identMap = new Map((identRes.data ?? []).map((p) => [p.id, p]));
      const slotMap = new Map(
        leaguePlayers.map((lp) => [lp.player_id, lp.roster_slot]),
      );

      return leaguePlayers.map((lp) => {
        const stat = statMap.get(lp.player_id);
        const ident = identMap.get(lp.player_id);
        return {
          ...(stat ?? ({} as PlayerSeasonStats)),
          player_id: lp.player_id,
          games_played: stat?.games_played ?? 0,
          name: stat?.name ?? ident?.name ?? "",
          position: stat?.position ?? ident?.position ?? "",
          pro_team: stat?.pro_team ?? ident?.pro_team ?? null,
          external_id_nba: stat?.external_id_nba ?? ident?.external_id_nba ?? null,
          status: stat?.status ?? ident?.status ?? null,
          roster_slot: slotMap.get(lp.player_id) ?? null,
        } as RosterPlayer;
      });
    },
    enabled: !!teamId,
  });

  const isLoading = isLoadingConfig || isLoadingPlayers;

  // Build slot entries from roster config (mirrors roster page logic)
  const starterSlots: SlotEntry[] = [];
  const benchSlots: SlotEntry[] = [];
  const irSlots: SlotEntry[] = [];

  if (rosterConfig && rosterPlayers) {
    const benchConfig = rosterConfig.find((cfg) => cfg.position === "BE");
    const irConfig = rosterConfig.find((cfg) => cfg.position === "IR");
    // TAXI is a reserve slot like BE/IR — exclude it from the starter configs
    // so taxi slots don't render as starter rows. Taxi-slotted players fall
    // through to the Bench list (mirrors the original draft view).
    const activeConfigs = rosterConfig.filter(
      (cfg) =>
        cfg.position !== "BE" && cfg.position !== "IR" && cfg.position !== "TAXI",
    );

    const validSlotNames = new Set<string>();
    for (const config of activeConfigs) {
      if (config.position === "UTIL") {
        for (let i = 1; i <= config.slot_count; i++)
          validSlotNames.add(`UTIL${i}`);
      } else {
        validSlotNames.add(config.position);
      }
    }

    for (const config of activeConfigs) {
      if (config.position === "UTIL") {
        for (let i = 0; i < config.slot_count; i++) {
          const numberedSlot = `UTIL${i + 1}`;
          const player =
            rosterPlayers.find((p) => p.roster_slot === numberedSlot) ?? null;
          starterSlots.push({
            slotPosition: numberedSlot,
            slotIndex: i,
            player,
          });
        }
      } else {
        const playersInSlot = rosterPlayers.filter(
          (p) => p.roster_slot === config.position,
        );
        for (let i = 0; i < config.slot_count; i++) {
          starterSlots.push({
            slotPosition: config.position,
            slotIndex: i,
            player: playersInSlot[i] ?? null,
          });
        }
      }
    }

    const benchPlayers: RosterPlayer[] = [];
    for (const player of rosterPlayers) {
      if (player.roster_slot === "IR") continue;
      if (
        !player.roster_slot ||
        player.roster_slot === "BE" ||
        !validSlotNames.has(player.roster_slot)
      ) {
        benchPlayers.push(player);
      }
    }

    const benchSlotCount = Math.max(
      benchConfig?.slot_count ?? 0,
      benchPlayers.length,
    );
    for (let i = 0; i < benchSlotCount; i++) {
      benchSlots.push({
        slotPosition: "BE",
        slotIndex: i,
        player: benchPlayers[i] ?? null,
      });
    }

    if (irConfig && irConfig.slot_count > 0) {
      const irPlayers = rosterPlayers.filter((p) => p.roster_slot === "IR");
      const irSlotCount = Math.max(irConfig.slot_count, irPlayers.length);
      for (let i = 0; i < irSlotCount; i++) {
        irSlots.push({
          slotPosition: "IR",
          slotIndex: i,
          player: irPlayers[i] ?? null,
        });
      }
    }
  }

  // Roster-depth summary — for each position slot the league actually defines,
  // how many rostered players are eligible to fill it. Counting via
  // isEligibleForSlot makes this sport-correct without branching: a WNBA "G"
  // player counts toward a G slot, an NBA "PG-SG" toward both PG and SG.
  const positionCounts: { label: string; filled: number }[] = [];
  if (rosterConfig && rosterPlayers) {
    const usedPositions = new Set(
      rosterConfig
        .filter((cfg) => SLOT_ELIGIBLE_POSITIONS[cfg.position])
        .map((cfg) => cfg.position),
    );
    for (const pos of POSITION_SLOT_ORDER) {
      if (!usedPositions.has(pos)) continue;
      const filled = rosterPlayers.filter((p) =>
        isEligibleForSlot(p.position, pos),
      ).length;
      positionCounts.push({ label: pos, filled });
    }
  }

  if (isLoading) {
    return (
      <View style={[styles.container, { backgroundColor: c.background }]}>
        <View style={styles.centered}>
          <LogoSpinner />
        </View>
      </View>
    );
  }

  const renderSlotRow = (slot: SlotEntry, idx: number, list: SlotEntry[]) => {
    const player = slot.player;
    const avgFpts =
      player && scoringWeights && !isCategories
        ? calculateAvgFantasyPoints(player, scoringWeights)
        : null;
    const catLine =
      player && isCategories && (player.games_played ?? 0) > 0
        ? `${(player.avg_pts ?? 0).toFixed(1)}/${(player.avg_reb ?? 0).toFixed(1)}/${(player.avg_ast ?? 0).toFixed(1)}`
        : null;

    return (
      <View
        key={`${slot.slotPosition}-${slot.slotIndex}`}
        style={[
          styles.slotRow,
          idx % 2 === 1 && { backgroundColor: c.cardAlt },
          idx < list.length - 1 && {
            borderBottomColor: c.border,
            borderBottomWidth: StyleSheet.hairlineWidth,
          },
        ]}
      >
        {/* Slot pill — read-only during the draft (lineup isn't editable here),
            so it uses the neutral-border variant matching the locked pills on
            the roster page. */}
        {(() => {
          const pill = slotPillVariant(c, {
            canEdit: false,
            isActive: false,
            hasPlayer: !!player,
          });
          return (
            <View style={[styles.slotPill, pill.container]}>
              <ThemedText
                type="varsitySmall"
                style={[styles.slotPillText, { color: pill.textColor }]}
              >
                {slotLabel(slot.slotPosition)}
              </ThemedText>
            </View>
          );
        })()}

        {player ? (
          <TouchableOpacity
            style={styles.slotPlayer}
            onPress={() => setSelectedPlayer(player)}
            accessibilityRole="button"
            accessibilityLabel={`${player.name}, ${formatPosition(player.position)}${player.pro_team ? `, ${player.pro_team}` : ""}${!isCategories && avgFpts && avgFpts > 0 ? `, ${avgFpts.toFixed(1)} fantasy points per game` : ""}`}
            accessibilityHint="Opens player details"
          >
            <View style={styles.rosterPortraitWrap} accessible={false}>
              <View
                style={[
                  styles.rosterHeadshotCircle,
                  { borderColor: c.heritageGold, backgroundColor: c.cardAlt },
                ]}
                accessible={false}
              >
                <PlayerHeadshotImage
                  externalIdNba={player.external_id_nba}
                  sport={sport}
                  style={styles.rosterHeadshotImg}
                  accessible={false}
                />
              </View>
              {/* Only render the team pill when the player has a pro team —
                  a player between teams (null pro_team) would otherwise show
                  an empty dark medallion. */}
              {player.pro_team
                ? (() => {
                    const logoUrl = getTeamLogoUrl(player.pro_team, sport);
                    return (
                      <View style={styles.rosterTeamPill}>
                        {logoUrl && (
                          <Image
                            source={{ uri: logoUrl }}
                            style={styles.rosterTeamPillLogo}
                            contentFit="contain"
                            cachePolicy="memory-disk"
                            recyclingKey={logoUrl}
                          />
                        )}
                        <Text
                          style={[styles.rosterTeamPillText, { color: c.statusText }]}
                        >
                          {player.pro_team}
                        </Text>
                      </View>
                    );
                  })()
                : null}
            </View>

            <View style={styles.slotPlayerInfo}>
              <View style={styles.slotLine1}>
                <PlayerName
                  name={player.name}
                  type="defaultSemiBold"
                  style={styles.slotPlayerName}
                  containerStyle={{ flexShrink: 1 }}
                />
                {(() => {
                  const badge = getInjuryBadge(player.status);
                  return badge ? (
                    <View
                      style={[styles.liveBadge, { backgroundColor: badge.color }]}
                    >
                      <Text style={[styles.liveText, { color: c.statusText }]}>
                        {badge.label}
                      </Text>
                    </View>
                  ) : null;
                })()}
              </View>
              {/* Position only — no matchup chip in the draft view (no games
                  during a draft); the season average is the right-hand readout. */}
              <View style={styles.slotFptsRow}>
                <ThemedText
                  type="varsitySmall"
                  style={[styles.slotPosLabel, { color: c.secondaryText }]}
                  numberOfLines={1}
                >
                  {formatPosition(player.position)}
                </ThemedText>
              </View>
            </View>

            {/* Right column — season FPTS/G average (points) or the season
                box-score slash (categories). */}
            {!isCategories ? (
              <ThemedText
                style={[
                  styles.slotFpts,
                  { color: avgFpts && avgFpts > 0 ? c.gold : c.secondaryText },
                ]}
              >
                {avgFpts && avgFpts > 0 ? avgFpts.toFixed(1) : "—"}
              </ThemedText>
            ) : catLine ? (
              <ThemedText
                style={[styles.slotStatLine, { color: c.secondaryText, marginTop: 0 }]}
              >
                {catLine}
              </ThemedText>
            ) : null}
          </TouchableOpacity>
        ) : (
          <View
            style={styles.slotPlayer}
            accessibilityLabel={`${slotLabel(slot.slotPosition)} slot, empty`}
          >
            <View style={styles.rosterPortraitWrap} accessible={false}>
              <View
                style={[
                  styles.emptyHeadshot,
                  { borderColor: c.border, backgroundColor: c.cardAlt },
                ]}
              >
                <Ionicons name="remove" size={18} color={c.secondaryText} />
              </View>
            </View>
            <View style={styles.slotPlayerInfo}>
              <ThemedText
                type="varsitySmall"
                style={[styles.emptySlotEyebrow, { color: c.secondaryText }]}
              >
                EMPTY SLOT
              </ThemedText>
            </View>
          </View>
        )}
      </View>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: c.background }]}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Roster-depth summary */}
        {positionCounts.length > 0 && (
          <View
            style={summaryStyles.strip}
            accessibilityLabel={`Roster depth: ${positionCounts.map((p) => `${p.label} ${p.filled}`).join(", ")}`}
          >
            {positionCounts.map((p) => (
              <View
                key={p.label}
                style={[
                  summaryStyles.chip,
                  { backgroundColor: c.cardAlt, borderColor: c.border },
                ]}
              >
                <ThemedText
                  type="varsitySmall"
                  style={[summaryStyles.chipLabel, { color: c.gold }]}
                >
                  {p.label}
                </ThemedText>
                <ThemedText
                  type="mono"
                  style={[summaryStyles.chipCount, { color: c.text }]}
                >
                  {p.filled}
                </ThemedText>
              </View>
            ))}
          </View>
        )}

        {/* Starters */}
        <View style={styles.section}>
          <SectionEyebrow label="STARTERS" />
          <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
            {starterSlots.map((slot, idx) =>
              renderSlotRow(slot, idx, starterSlots),
            )}
          </View>
        </View>

        {/* Bench */}
        <View style={styles.section}>
          <SectionEyebrow label="BENCH" />
          <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
            {benchSlots.length > 0 ? (
              benchSlots.map((slot, idx) => renderSlotRow(slot, idx, benchSlots))
            ) : (
              <View style={styles.emptyBench}>
                <ThemedText
                  type="varsitySmall"
                  style={{ color: c.secondaryText, letterSpacing: 1.2 }}
                >
                  NO BENCH SLOTS
                </ThemedText>
              </View>
            )}
          </View>
        </View>

        {/* IR */}
        {irSlots.length > 0 && (
          <View style={styles.section}>
            <SectionEyebrow label="INJURED RESERVE" />
            <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
              {irSlots.map((slot, idx) => renderSlotRow(slot, idx, irSlots))}
            </View>
          </View>
        )}
      </ScrollView>

      <PlayerDetailModal
        player={selectedPlayer}
        leagueId={leagueId}
        teamId={teamId}
        onClose={() => setSelectedPlayer(null)}
        hideRosterActions
      />
    </View>
  );
}

const summaryStyles = StyleSheet.create({
  strip: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: s(6),
    paddingHorizontal: s(16),
    paddingTop: s(14),
    paddingBottom: s(2),
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: s(5),
    paddingHorizontal: s(9),
    paddingVertical: s(4),
    borderRadius: 8,
    borderWidth: 1,
  },
  chipLabel: { fontSize: ms(9.5), letterSpacing: 1.0 },
  chipCount: { fontSize: ms(12), fontWeight: "700" },
});
