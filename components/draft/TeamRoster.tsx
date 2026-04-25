import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { LogoSpinner } from "@/components/ui/LogoSpinner";
import { Colors } from "@/constants/Colors";
import { queryKeys } from "@/constants/queryKeys";
import { useActiveLeagueSport } from "@/hooks/useActiveLeagueSport";
import { useColorScheme } from "@/hooks/useColorScheme";
import { useLeagueRosterConfig } from "@/hooks/useLeagueRosterConfig";
import { useLeagueScoring } from "@/hooks/useLeagueScoring";
import { supabase } from "@/lib/supabase";
import { PlayerSeasonStats } from "@/types/player";
import { calculateAvgFantasyPoints } from "@/utils/fantasyPoints";
import { formatPosition } from "@/utils/formatting";
import { getInjuryBadge } from "@/utils/injuryBadge";
import { getPlayerHeadshotUrl, getTeamLogoUrl } from "@/utils/playerHeadshot";
import { slotLabel } from "@/utils/rosterSlots";
import { ms, s } from "@/utils/scale";

import { PlayerDetailModal } from "../player/PlayerDetailModal";
import { ThemedText } from "../ui/ThemedText";


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

export function TeamRoster({ teamId, leagueId }: TeamRosterProps) {
  const colorScheme = useColorScheme() ?? "light";
  const c = Colors[colorScheme];
  const sport = useActiveLeagueSport(leagueId);
  const [selectedPlayer, setSelectedPlayer] =
    useState<PlayerSeasonStats | null>(null);

  const { data: scoringWeights } = useLeagueScoring(leagueId);
  const { data: rosterConfig, isLoading: isLoadingConfig } =
    useLeagueRosterConfig(leagueId);

  const { data: rosterPlayers, isLoading: isLoadingPlayers } = useQuery<
    RosterPlayer[]
  >({
    queryKey: queryKeys.teamRoster(teamId),
    queryFn: async () => {
      const { data: leaguePlayers, error: lpError } = await supabase
        .from("league_players")
        .select("player_id, roster_slot")
        .eq("team_id", teamId);

      if (lpError) throw lpError;
      if (!leaguePlayers || leaguePlayers.length === 0) return [];

      const playerIds = leaguePlayers.map((lp) => lp.player_id);

      const { data: stats, error: statsError } = await supabase
        .from("player_season_stats")
        .select("*")
        .in("player_id", playerIds);

      if (statsError) throw statsError;

      const slotMap = new Map(
        leaguePlayers.map((lp) => [lp.player_id, lp.roster_slot]),
      );

      return (stats as PlayerSeasonStats[]).map((p) => ({
        ...p,
        roster_slot: slotMap.get(p.player_id) ?? null,
      }));
    },
    enabled: !!teamId,
  });

  const isLoading = isLoadingConfig || isLoadingPlayers;

  // Build slot entries from roster config (mirrors roster page logic)
  const starterSlots: SlotEntry[] = [];
  const benchSlots: SlotEntry[] = [];
  const irSlots: SlotEntry[] = [];

  if (rosterConfig && rosterPlayers) {
    const benchConfig = rosterConfig.find((c) => c.position === "BE");
    const irConfig = rosterConfig.find((c) => c.position === "IR");
    const activeConfigs = rosterConfig.filter(
      (c) => c.position !== "BE" && c.position !== "IR",
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

  if (isLoading) {
    return (
      <View style={[styles.container, { backgroundColor: c.cardAlt }]}>
        <View style={styles.centered}><LogoSpinner /></View>
      </View>
    );
  }

  // Build position fill summary — count by player's actual position, not roster slot
  const positionCounts: { label: string; filled: number; isAggregate?: boolean }[] = [];
  if (rosterConfig && rosterPlayers) {
    const countByPosition = (pos: string) =>
      rosterPlayers.filter((p) => p.position?.split("-").includes(pos)).length;

    const pg = countByPosition("PG");
    const sg = countByPosition("SG");
    const sf = countByPosition("SF");
    const pf = countByPosition("PF");
    const ctr = countByPosition("C");

    positionCounts.push({ label: "PG", filled: pg });
    positionCounts.push({ label: "SG", filled: sg });
    positionCounts.push({ label: "G", filled: pg + sg, isAggregate: true });
    positionCounts.push({ label: "SF", filled: sf });
    positionCounts.push({ label: "PF", filled: pf });
    positionCounts.push({ label: "F", filled: sf + pf, isAggregate: true });
    positionCounts.push({ label: "C", filled: ctr });
  }

  if (!rosterPlayers || rosterPlayers.length === 0) {
    return (
      <View style={[styles.container, { backgroundColor: c.cardAlt }]}>
        <View style={styles.centered}>
          <ThemedText style={{ color: c.secondaryText }}>
            No players drafted yet.
          </ThemedText>
        </View>
      </View>
    );
  }

  const renderSlotRow = (slot: SlotEntry, idx: number, list: SlotEntry[]) => {
    const avgFpts =
      slot.player && scoringWeights
        ? calculateAvgFantasyPoints(slot.player, scoringWeights)
        : null;

    return (
      <View
        key={`${slot.slotPosition}-${slot.slotIndex}`}
        style={[
          styles.slotRow,
          idx < list.length - 1 && {
            borderBottomColor: c.border,
            borderBottomWidth: StyleSheet.hairlineWidth,
          },
        ]}
      >
        <View
          style={[
            styles.slotLabel,
            { backgroundColor: slot.player ? c.activeCard : c.cardAlt },
          ]}
        >
          <ThemedText
            style={[
              styles.slotLabelText,
              { color: slot.player ? c.activeText : c.secondaryText },
            ]}
          >
            {slotLabel(slot.slotPosition)}
          </ThemedText>
        </View>

        {slot.player ? (
          <TouchableOpacity
            style={styles.slotPlayer}
            onPress={() => setSelectedPlayer(slot.player)}
          >
            <View style={styles.portraitWrap}>
              {(() => {
                const url = getPlayerHeadshotUrl(slot.player.external_id_nba, sport);
                return (
                  <View
                    style={[
                      styles.headshotCircle,
                      { borderColor: c.heritageGold, backgroundColor: c.cardAlt },
                    ]}
                  >
                    {url ? (
                      <Image
                        source={{ uri: url }}
                        style={styles.headshotImg}
                        resizeMode="cover"
                      />
                    ) : null}
                  </View>
                );
              })()}
              {(() => {
                const logoUrl = getTeamLogoUrl(slot.player.pro_team, sport);
                return (
                  <View style={styles.teamPill}>
                    {logoUrl && (
                      <Image
                        source={{ uri: logoUrl }}
                        style={styles.teamPillLogo}
                        resizeMode="contain"
                      />
                    )}
                    <Text style={[styles.teamPillText, { color: c.statusText }]}>
                      {slot.player.pro_team}
                    </Text>
                  </View>
                );
              })()}
            </View>
            <View style={styles.slotPlayerInfo}>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: s(4),
                  flexWrap: "wrap",
                  flexShrink: 1,
                }}
              >
                <ThemedText
                  type="defaultSemiBold"
                  style={styles.slotPlayerName}
                >
                  {slot.player.name}
                </ThemedText>
                {(() => {
                  const badge = getInjuryBadge(slot.player.status);
                  return badge ? (
                    <View
                      style={[styles.badge, { backgroundColor: badge.color }]}
                    >
                      <Text style={[styles.badgeText, { color: c.statusText }]}>{badge.label}</Text>
                    </View>
                  ) : null;
                })()}
              </View>
              <ThemedText
                style={[styles.slotPlayerSub, { color: c.secondaryText }]}
                numberOfLines={1}
              >
                {formatPosition(slot.player.position)}
              </ThemedText>
            </View>
            {avgFpts !== null && (
              <Text style={[styles.slotFpts, { color: c.accent }]}>
                {avgFpts.toFixed(1)}
              </Text>
            )}
          </TouchableOpacity>
        ) : (
          <View style={styles.slotPlayer}>
            <ThemedText
              style={[styles.emptySlotText, { color: c.secondaryText }]}
            >
              Empty
            </ThemedText>
          </View>
        )}
      </View>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: c.cardAlt }]}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Position Fill Summary */}
        {positionCounts.length > 0 && (
          <View
            style={styles.positionSummary}
            accessibilityLabel={`Roster positions filled: ${positionCounts.map((p) => `${p.label} ${p.filled}`).join(", ")}`}
          >
            {positionCounts.map((p, i) => (
              <ThemedText
                key={p.label}
                style={[
                  styles.positionSummaryText,
                  { color: p.isAggregate ? c.text : c.secondaryText },
                  p.isAggregate && { fontWeight: "700" },
                ]}
              >
                {i > 0 ? "  |  " : ""}
                {p.label} {p.filled}
              </ThemedText>
            ))}
          </View>
        )}

        {/* Starters */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <ThemedText type="subtitle">Starters</ThemedText>
          </View>
          <View style={[styles.card, { backgroundColor: c.card }]}>
            {starterSlots.map((slot, idx) =>
              renderSlotRow(slot, idx, starterSlots),
            )}
          </View>
        </View>

        {/* Bench */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <ThemedText type="subtitle">Bench</ThemedText>
          </View>
          <View style={[styles.card, { backgroundColor: c.card }]}>
            {benchSlots.length > 0 ? (
              benchSlots.map((slot, idx) =>
                renderSlotRow(slot, idx, benchSlots),
              )
            ) : (
              <View style={styles.emptyBench}>
                <ThemedText
                  style={[styles.emptySlotText, { color: c.secondaryText }]}
                >
                  No bench slots
                </ThemedText>
              </View>
            )}
          </View>
        </View>

        {/* IR */}
        {irSlots.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <ThemedText type="subtitle">Injured Reserve</ThemedText>
            </View>
            <View style={[styles.card, { backgroundColor: c.card }]}>
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
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { paddingBottom: s(56) },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: s(20),
  },
  positionSummary: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingHorizontal: s(16),
    paddingTop: s(12),
    paddingBottom: s(4),
  },
  positionSummaryText: {
    fontSize: ms(11),
    fontWeight: "600",
  },
  section: { padding: s(16), paddingBottom: 0 },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: s(8),
  },
  card: {
    borderRadius: 8,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  slotRow: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: s(56),
  },
  slotLabel: {
    width: s(44),
    alignSelf: "stretch",
    justifyContent: "center",
    alignItems: "center",
  },
  slotLabelText: { fontSize: ms(11), fontWeight: "700" },
  slotPlayer: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: s(6),
    paddingHorizontal: s(12),
  },
  portraitWrap: {
    width: s(50),
    height: s(50),
    marginRight: s(8),
  },
  headshotCircle: {
    width: s(48),
    height: s(48),
    borderRadius: 25,
    borderWidth: 1.5,
    overflow: "hidden",
  },
  headshotImg: {
    position: "absolute" as const,
    bottom: s(-2),
    left: 0,
    right: 0,
    height: s(42),
  },
  teamPill: {
    position: "absolute",
    bottom: s(-1),
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.75)",
    borderRadius: 8,
    paddingHorizontal: s(3),
    paddingVertical: 1,
    gap: s(2),
  },
  teamPillLogo: {
    width: s(9),
    height: s(9),
  },
  teamPillText: {
    fontSize: ms(7),
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  slotPlayerInfo: { flex: 1, marginRight: s(8) },
  slotPlayerName: { fontSize: ms(14) },
  slotPlayerSub: { fontSize: ms(11), marginTop: 1 },
  slotFpts: { fontSize: ms(13), fontWeight: "600" },
  emptySlotText: { fontSize: ms(13), fontStyle: "italic" },
  emptyBench: { padding: s(16), alignItems: "center" },
  badge: {
    paddingHorizontal: s(4),
    paddingVertical: 1,
    borderRadius: 3,
  },
  badgeText: {
    fontSize: ms(8),
    fontWeight: "800",
    letterSpacing: 0.5,
  },
});
