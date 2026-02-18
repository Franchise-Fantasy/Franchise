import { PlayerDetailModal } from "@/components/player/PlayerDetailModal";
import { ThemedText } from "@/components/ThemedText";
import { Colors } from "@/constants/Colors";
import { useAppState } from "@/context/AppStateProvider";
import { useColorScheme } from "@/hooks/useColorScheme";
import { useLeagueRosterConfig } from "@/hooks/useLeagueRosterConfig";
import { useLeagueScoring } from "@/hooks/useLeagueScoring";
import { supabase } from "@/lib/supabase";
import { PlayerSeasonStats } from "@/types/player";
import { calculateAvgFantasyPoints } from "@/utils/fantasyPoints";
import { formatPosition } from "@/utils/formatting";
import { isEligibleForSlot, SLOT_LABELS } from "@/utils/rosterSlots";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Modal,
  PanResponder,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

interface RosterPlayer extends PlayerSeasonStats {
  roster_slot: string | null;
}

/** A single renderable slot in the roster view. */
interface SlotEntry {
  slotPosition: string;
  slotIndex: number;
  player: RosterPlayer | null;
}

export default function RosterScreen() {
  const scheme = useColorScheme() ?? "light";
  const c = Colors[scheme];
  const { leagueId, teamId } = useAppState();
  const queryClient = useQueryClient();

  const [selectedPlayer, setSelectedPlayer] =
    useState<PlayerSeasonStats | null>(null);
  const [activeSlot, setActiveSlot] = useState<SlotEntry | null>(null);
  const [isAssigning, setIsAssigning] = useState(false);

  const { data: scoringWeights } = useLeagueScoring(leagueId ?? "");
  const { data: rosterConfig, isLoading: isLoadingConfig } =
    useLeagueRosterConfig(leagueId ?? "");

  const { data: rosterPlayers, isLoading: isLoadingRoster } = useQuery<
    RosterPlayer[]
  >({
    queryKey: ["teamRoster", teamId],
    queryFn: async () => {
      const { data: leaguePlayers, error: lpError } = await supabase
        .from("league_players")
        .select("player_id, roster_slot")
        .eq("team_id", teamId!)
        .eq("league_id", leagueId!);

      if (lpError) throw lpError;
      if (!leaguePlayers || leaguePlayers.length === 0) return [];

      const playerIds = leaguePlayers.map((lp) => lp.player_id);

      const { data, error } = await supabase
        .from("player_season_stats")
        .select("*")
        .in("player_id", playerIds);

      if (error) throw error;

      // Merge roster_slot onto stats
      const slotMap = new Map(
        leaguePlayers.map((lp) => [lp.player_id, lp.roster_slot]),
      );
      return (data as PlayerSeasonStats[]).map((p) => ({
        ...p,
        roster_slot: slotMap.get(p.player_id) ?? null,
      }));
    },
    enabled: !!teamId && !!leagueId,
  });

  const isLoading = isLoadingConfig || isLoadingRoster;

  // Build slot entries from roster config
  // Non-bench slots render their configured count.
  // Bench expands to hold any players without a non-bench slot assignment.
  const slots: SlotEntry[] = [];
  const benchPlayers: RosterPlayer[] = [];

  if (rosterConfig && rosterPlayers) {
    const benchConfig = rosterConfig.find((c) => c.position === "BE");
    const nonBenchConfigs = rosterConfig.filter((c) => c.position !== "BE");

    // Build non-bench slots
    for (const config of nonBenchConfigs) {
      const playersInSlot = rosterPlayers.filter(
        (p) => p.roster_slot === config.position,
      );
      for (let i = 0; i < config.slot_count; i++) {
        slots.push({
          slotPosition: config.position,
          slotIndex: i,
          player: playersInSlot[i] ?? null,
        });
      }
    }

    // Collect bench players: anyone with roster_slot='BE', null, or an invalid slot
    const validNonBenchSlots = new Set(nonBenchConfigs.map((c) => c.position));
    for (const player of rosterPlayers) {
      if (
        !player.roster_slot ||
        player.roster_slot === "BE" ||
        !validNonBenchSlots.has(player.roster_slot)
      ) {
        benchPlayers.push(player);
        continue;
      }
      // Also overflow to bench if too many players in that slot
      const config = nonBenchConfigs.find(
        (c) => c.position === player.roster_slot,
      );
      if (config) {
        const playersInSlot = rosterPlayers.filter(
          (p) => p.roster_slot === config.position,
        );
        const idx = playersInSlot.indexOf(player);
        if (idx >= config.slot_count) {
          benchPlayers.push(player);
        }
      }
    }

    // Build bench slots — at least the configured count, expanding if more players are on bench
    const benchSlotCount = Math.max(
      benchConfig?.slot_count ?? 0,
      benchPlayers.length,
    );
    for (let i = 0; i < benchSlotCount; i++) {
      slots.push({
        slotPosition: "BE",
        slotIndex: i,
        player: benchPlayers[i] ?? null,
      });
    }
  }

  // Get eligible players for the slot picker.
  // Starter slots show bench players. Bench slots show starters (for swapping).
  const getEligiblePlayersForSlot = (slotPosition: string): RosterPlayer[] => {
    if (!rosterPlayers) return [];
    const isBenchSlot = slotPosition === "BE";

    return rosterPlayers.filter((p) => {
      // The player currently in this slot is handled separately in the picker header
      if (activeSlot?.player?.player_id === p.player_id) return false;

      if (isBenchSlot) {
        // Bench slot: show starters (for swapping)
        const isOnBench = !p.roster_slot || p.roster_slot === "BE";
        return !isOnBench;
      }

      // Starter slot: must be position-eligible, and must be on bench
      if (!isEligibleForSlot(p.position, slotPosition)) return false;
      const isOnBench = !p.roster_slot || p.roster_slot === "BE";
      return isOnBench;
    });
  };

  const handleAssignPlayer = async (player: RosterPlayer) => {
    if (!activeSlot || !teamId || !leagueId) return;

    setIsAssigning(true);
    try {
      const isBenchSlot = activeSlot.slotPosition === "BE";
      const selectedIsStarter =
        player.roster_slot && player.roster_slot !== "BE";

      if (isBenchSlot && selectedIsStarter && activeSlot.player) {
        const starterSlot = player.roster_slot!;
        const benchPlayerEligible = isEligibleForSlot(
          activeSlot.player.position,
          starterSlot,
        );

        // Move the starter to bench
        const { error: e2 } = await supabase
          .from("league_players")
          .update({ roster_slot: "BE" })
          .eq("league_id", leagueId)
          .eq("team_id", teamId)
          .eq("player_id", player.player_id);
        if (e2) throw e2;

        if (benchPlayerEligible) {
          // Swap: bench player fills the starter's old slot
          const { error: e1 } = await supabase
            .from("league_players")
            .update({ roster_slot: starterSlot })
            .eq("league_id", leagueId)
            .eq("team_id", teamId)
            .eq("player_id", activeSlot.player.player_id);
          if (e1) throw e1;
        }
        // If not eligible, bench player stays on bench (extra bench slot)
      } else {
        // Standard assign: displaced player goes to bench
        if (activeSlot.player) {
          const { error: clearError } = await supabase
            .from("league_players")
            .update({ roster_slot: "BE" })
            .eq("league_id", leagueId)
            .eq("team_id", teamId)
            .eq("player_id", activeSlot.player.player_id);
          if (clearError) throw clearError;
        }

        const { error } = await supabase
          .from("league_players")
          .update({ roster_slot: activeSlot.slotPosition })
          .eq("league_id", leagueId)
          .eq("team_id", teamId)
          .eq("player_id", player.player_id);
        if (error) throw error;
      }

      queryClient.invalidateQueries({ queryKey: ["teamRoster", teamId] });
      setActiveSlot(null);
    } catch (err: any) {
      Alert.alert("Error", err.message ?? "Failed to assign player");
    } finally {
      setIsAssigning(false);
    }
  };

  const handleClearSlot = async () => {
    if (!activeSlot?.player || !teamId || !leagueId) return;

    setIsAssigning(true);
    try {
      // Move player to bench
      const { error } = await supabase
        .from("league_players")
        .update({ roster_slot: "BE" })
        .eq("league_id", leagueId)
        .eq("team_id", teamId)
        .eq("player_id", activeSlot.player.player_id);

      if (error) throw error;

      queryClient.invalidateQueries({ queryKey: ["teamRoster", teamId] });
      setActiveSlot(null);
    } catch (err: any) {
      Alert.alert("Error", err.message ?? "Failed to move player to bench");
    } finally {
      setIsAssigning(false);
    }
  };

  if (isLoading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: c.cardAlt }]}>
        <ActivityIndicator style={styles.centered} />
      </SafeAreaView>
    );
  }

  if (!rosterPlayers || rosterPlayers.length === 0) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: c.cardAlt }]}>
        <View style={styles.centered}>
          <ThemedText style={{ color: c.secondaryText }}>
            No players on your roster yet.
          </ThemedText>
        </View>
      </SafeAreaView>
    );
  }

  const starterSlots = slots.filter((s) => s.slotPosition !== "BE");
  const benchSlots = slots.filter((s) => s.slotPosition === "BE");

  // Total projected FPTS from starters only
  const starterTotal = scoringWeights
    ? starterSlots.reduce((sum, slot) => {
        if (!slot.player) return sum;
        return sum + calculateAvgFantasyPoints(slot.player, scoringWeights);
      }, 0)
    : null;

  const renderSlotRow = (slot: SlotEntry, idx: number, list: SlotEntry[]) => {
    const fpts =
      slot.player && scoringWeights
        ? calculateAvgFantasyPoints(slot.player, scoringWeights)
        : null;

    const isActive =
      activeSlot?.slotPosition === slot.slotPosition &&
      activeSlot?.slotIndex === slot.slotIndex;

    return (
      <View
        key={`${slot.slotPosition}-${slot.slotIndex}`}
        style={[
          styles.slotRow,
          idx < list.length - 1 && {
            borderBottomColor: c.border,
            borderBottomWidth: StyleSheet.hairlineWidth,
          },
          isActive && {
            backgroundColor: c.activeCard,
            borderLeftWidth: 3,
            borderLeftColor: c.accent,
          },
        ]}
      >
        <TouchableOpacity
          style={[
            styles.slotLabel,
            {
              backgroundColor: isActive
                ? c.activeCard
                : slot.player
                  ? c.activeCard
                  : c.cardAlt,
            },
          ]}
          onPress={() => setActiveSlot(slot)}
        >
          <ThemedText
            style={[
              styles.slotLabelText,
              {
                color: isActive
                  ? c.accent
                  : slot.player
                    ? c.activeText
                    : c.secondaryText,
              },
            ]}
          >
            {SLOT_LABELS[slot.slotPosition] ?? slot.slotPosition}
          </ThemedText>
        </TouchableOpacity>

        {slot.player ? (
          <TouchableOpacity
            style={styles.slotPlayer}
            onPress={() => setSelectedPlayer(slot.player)}
            onLongPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setActiveSlot(slot);
            }}
            delayLongPress={400}
          >
            <View style={styles.slotPlayerInfo}>
              <ThemedText
                type="defaultSemiBold"
                numberOfLines={1}
                style={styles.slotPlayerName}
              >
                {slot.player.name}
              </ThemedText>
              <ThemedText
                style={[styles.slotPlayerSub, { color: c.secondaryText }]}
              >
                {formatPosition(slot.player.position)} · {slot.player.nba_team}
              </ThemedText>
            </View>
            {fpts !== null && (
              <ThemedText style={[styles.slotFpts, { color: c.accent }]}>
                {fpts}
              </ThemedText>
            )}
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={styles.slotPlayer}
            onPress={() => setActiveSlot(slot)}
          >
            <ThemedText
              style={[styles.emptySlotText, { color: c.secondaryText }]}
            >
              Empty
            </ThemedText>
          </TouchableOpacity>
        )}
      </View>
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.cardAlt }]}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Starters */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <ThemedText type="subtitle">Starters</ThemedText>
            {starterTotal !== null && (
              <View
                style={[
                  styles.totalBadge,
                  {
                    backgroundColor: c.activeCard,
                    borderColor: c.activeBorder,
                  },
                ]}
              >
                <ThemedText
                  style={[styles.totalLabel, { color: c.secondaryText }]}
                >
                  FPTS
                </ThemedText>
                <ThemedText
                  style={[styles.totalValue, { color: c.activeText }]}
                >
                  {starterTotal.toFixed(1)}
                </ThemedText>
              </View>
            )}
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
      </ScrollView>

      {/* Slot Picker Modal */}
      <SlotPickerModal
        visible={!!activeSlot}
        slot={activeSlot}
        eligiblePlayers={
          activeSlot ? getEligiblePlayersForSlot(activeSlot.slotPosition) : []
        }
        scoringWeights={scoringWeights}
        isAssigning={isAssigning}
        onSelectPlayer={handleAssignPlayer}
        onClear={handleClearSlot}
        onClose={() => setActiveSlot(null)}
      />

      <PlayerDetailModal
        player={selectedPlayer}
        leagueId={leagueId ?? ""}
        teamId={teamId ?? undefined}
        onClose={() => setSelectedPlayer(null)}
      />
    </SafeAreaView>
  );
}

// --- Slot Picker Modal ---

interface SlotPickerModalProps {
  visible: boolean;
  slot: SlotEntry | null;
  eligiblePlayers: RosterPlayer[];
  scoringWeights: any;
  isAssigning: boolean;
  onSelectPlayer: (player: RosterPlayer) => void;
  onClear: () => void;
  onClose: () => void;
}

function SlotPickerModal({
  visible,
  slot,
  eligiblePlayers,
  scoringWeights,
  isAssigning,
  onSelectPlayer,
  onClear,
  onClose,
}: SlotPickerModalProps) {
  const scheme = useColorScheme() ?? "light";
  const c = Colors[scheme];

  const translateY = useRef(new Animated.Value(0)).current;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, gestureState) => gestureState.dy > 10,
      onPanResponderMove: (_, gestureState) => {
        if (gestureState.dy > 0) {
          translateY.setValue(gestureState.dy);
        }
      },
      onPanResponderRelease: (_, gestureState) => {
        if (gestureState.dy > 80 || gestureState.vy > 0.5) {
          Animated.timing(translateY, {
            toValue: 500,
            duration: 200,
            useNativeDriver: true,
          }).start(() => {
            onCloseRef.current();
            translateY.setValue(0);
          });
        } else {
          Animated.spring(translateY, {
            toValue: 0,
            useNativeDriver: true,
            bounciness: 8,
          }).start();
        }
      },
    }),
  ).current;

  if (!slot) return null;

  const label = SLOT_LABELS[slot.slotPosition] ?? slot.slotPosition;

  // Filter out the currently assigned player from the list data
  const listData = eligiblePlayers.filter(
    (p) => p.player_id !== slot.player?.player_id,
  );

  // Only show differentials for starter slots (bench swaps don't affect total FPTS)
  const isStarterSlot = slot.slotPosition !== "BE";
  const currentFpts =
    isStarterSlot && slot.player && scoringWeights
      ? calculateAvgFantasyPoints(slot.player, scoringWeights)
      : null;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <TouchableOpacity
        style={styles.pickerOverlay}
        activeOpacity={1}
        onPress={onClose}
      >
        <Animated.View
          style={[
            styles.pickerSheet,
            { backgroundColor: c.background, transform: [{ translateY }] },
          ]}
          {...panResponder.panHandlers}
        >
          {/* Header */}
          <View style={[styles.pickerHeader, { borderBottomColor: c.border }]}>
            <View style={{ flex: 1 }}>
              <ThemedText type="defaultSemiBold" style={{ fontSize: 17 }}>
                {label} Slot
              </ThemedText>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <ThemedText style={{ fontSize: 16 }}>✕</ThemedText>
            </TouchableOpacity>
          </View>

          {isAssigning ? (
            <ActivityIndicator style={{ padding: 20 }} />
          ) : (
            <ScrollView style={styles.pickerScroll} bounces={false}>
              {/* Currently assigned player */}
              {slot.player && (
                <View
                  style={[
                    styles.currentPlayerRow,
                    {
                      borderBottomColor: c.border,
                      borderBottomWidth: StyleSheet.hairlineWidth,
                    },
                  ]}
                >
                  <View style={{ flex: 1 }}>
                    <ThemedText type="defaultSemiBold">
                      {slot.player.name}
                    </ThemedText>
                    <ThemedText
                      style={{ color: c.secondaryText, fontSize: 12 }}
                    >
                      {formatPosition(slot.player.position)} ·{" "}
                      {slot.player.nba_team}
                    </ThemedText>
                  </View>
                  {isStarterSlot && (
                    <TouchableOpacity
                      style={[styles.clearButton, { borderColor: c.border }]}
                      onPress={onClear}
                    >
                      <ThemedText
                        style={{
                          color: "#dc3545",
                          fontSize: 13,
                          fontWeight: "600",
                        }}
                      >
                        Bench
                      </ThemedText>
                    </TouchableOpacity>
                  )}
                </View>
              )}

              {/* Available players */}
              {listData.length === 0 && !slot.player && (
                <View style={{ padding: 20, alignItems: "center" }}>
                  <ThemedText style={{ color: c.secondaryText }}>
                    No eligible players available
                  </ThemedText>
                </View>
              )}
              {listData.map((item, idx) => {
                const fpts = scoringWeights
                  ? calculateAvgFantasyPoints(item, scoringWeights)
                  : null;

                const diff =
                  fpts !== null && currentFpts !== null
                    ? fpts - currentFpts
                    : null;

                return (
                  <TouchableOpacity
                    key={item.player_id}
                    style={[
                      styles.pickerRow,
                      idx < listData.length - 1 && {
                        borderBottomColor: c.border,
                        borderBottomWidth: StyleSheet.hairlineWidth,
                      },
                    ]}
                    onPress={() => onSelectPlayer(item)}
                  >
                    <View style={{ flex: 1 }}>
                      <ThemedText type="defaultSemiBold" numberOfLines={1}>
                        {item.name}
                      </ThemedText>
                      <ThemedText
                        style={{ color: c.secondaryText, fontSize: 12 }}
                      >
                        {formatPosition(item.position)} · {item.nba_team}
                      </ThemedText>
                    </View>
                    {fpts !== null && (
                      <View style={{ alignItems: "flex-end" }}>
                        <ThemedText
                          style={{
                            color: c.accent,
                            fontWeight: "600",
                            fontSize: 14,
                          }}
                        >
                          {fpts} FPTS
                        </ThemedText>
                        {diff !== null && (
                          <ThemedText
                            style={{
                              fontSize: 11,
                              fontWeight: "600",
                              marginTop: 1,
                              color:
                                diff > 0
                                  ? "#28a745"
                                  : diff < 0
                                    ? "#dc3545"
                                    : c.secondaryText,
                            }}
                          >
                            ({diff > 0 ? "+" : ""}
                            {diff.toFixed(1)})
                          </ThemedText>
                        )}
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}
        </Animated.View>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 56,
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  section: {
    padding: 16,
    paddingBottom: 0,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  totalBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    gap: 6,
  },
  totalLabel: {
    fontSize: 10,
    fontWeight: "600",
  },
  totalValue: {
    fontSize: 16,
    fontWeight: "700",
  },
  sectionTitle: {
    marginBottom: 8,
  },
  emptyBench: {
    padding: 16,
    alignItems: "center",
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
    height: 52,
  },
  slotLabel: {
    width: 44,
    alignSelf: "stretch",
    justifyContent: "center",
    alignItems: "center",
  },
  slotLabelText: {
    fontSize: 11,
    fontWeight: "700",
  },
  slotPlayer: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  slotPlayerInfo: {
    flex: 1,
    marginRight: 8,
  },
  slotPlayerName: {
    fontSize: 14,
  },
  slotPlayerSub: {
    fontSize: 11,
    marginTop: 1,
  },
  slotFpts: {
    fontSize: 13,
    fontWeight: "600",
  },
  emptySlotText: {
    fontSize: 13,
    fontStyle: "italic",
  },
  // Picker modal styles
  pickerHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  pickerSubtitle: {
    fontSize: 13,
    marginTop: 2,
  },
  closeButton: {
    padding: 8,
    marginTop: -4,
    marginRight: -4,
  },
  currentPlayerSection: {
    paddingHorizontal: 8,
    paddingVertical: 12,
    marginBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  pickerSectionLabel: {
    fontSize: 11,
    fontWeight: "600",
    marginBottom: 8,
    textTransform: "uppercase",
  },
  currentPlayerRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  clearButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
  },
  pickerOverlay: {
    flex: 1,
    justifyContent: "flex-end",
  },
  pickerSheet: {
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    maxHeight: "70%",
    overflow: "hidden",
    paddingBottom: 32,
  },
  pickerScroll: {
    flexGrow: 0,
  },
  pickerRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
});
