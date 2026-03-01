import { ThemedText } from "@/components/ThemedText";
import { Colors } from "@/constants/Colors";
import { useColorScheme } from "@/hooks/useColorScheme";
import { PlayerSeasonStats } from "@/types/player";
import { calculateAvgFantasyPoints } from "@/utils/fantasyPoints";
import { formatPosition } from "@/utils/formatting";
import { getInjuryBadge } from "@/utils/injuryBadge";
import { slotLabel } from "@/utils/rosterSlots";
import { useRef } from "react";
import {
  ActivityIndicator,
  Animated,
  Modal,
  PanResponder,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface RosterPlayer extends PlayerSeasonStats {
  roster_slot: string | null;
  nbaTricode: string | null; // real team tricode from players.nba_team (e.g. "OKC")
}

export interface SlotEntry {
  slotPosition: string;
  slotIndex: number;
  player: RosterPlayer | null;
}

// ─── Props ───────────────────────────────────────────────────────────────────

interface SlotPickerModalProps {
  visible: boolean;
  slot: SlotEntry | null;
  eligiblePlayers: RosterPlayer[];
  benchPlayerIds: Set<string>;
  scoringWeights: any;
  isAssigning: boolean;
  seatLocked?: boolean;
  daySchedule: Map<string, string> | undefined;
  onSelectPlayer: (player: RosterPlayer) => void;
  onClear: () => void;
  onClose: () => void;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function SlotPickerModal({
  visible,
  slot,
  eligiblePlayers,
  benchPlayerIds,
  scoringWeights,
  isAssigning,
  seatLocked,
  daySchedule,
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

  const label = slotLabel(slot.slotPosition);
  const listData = eligiblePlayers.filter(
    (p) => p.player_id !== slot.player?.player_id,
  );
  const isStarterSlot = slot.slotPosition !== "BE" && slot.slotPosition !== "IR";

  const hasGame = (player: RosterPlayer) =>
    player.nbaTricode ? !!daySchedule?.get(player.nbaTricode) : false;

  const playerFpts = (player: RosterPlayer): number | null => {
    if (!scoringWeights) return null;
    if (!hasGame(player)) return 0;
    return calculateAvgFantasyPoints(player, scoringWeights);
  };

  const isBenchSlot = slot.slotPosition === "BE";
  const currentFpts = slot.player ? playerFpts(slot.player) : null;

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
          accessibilityViewIsModal={true}
          style={[
            styles.pickerSheet,
            { backgroundColor: c.background, transform: [{ translateY }] },
          ]}
          {...panResponder.panHandlers}
        >
          <View style={[styles.pickerHeader, { borderBottomColor: c.border }]}>
            <View style={{ flex: 1 }}>
              <ThemedText accessibilityRole="header" type="defaultSemiBold" style={{ fontSize: 17 }}>
                {label} Slot
              </ThemedText>
            </View>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={styles.closeButton}>
              <ThemedText style={{ fontSize: 16 }}>✕</ThemedText>
            </TouchableOpacity>
          </View>

          {isAssigning ? (
            <ActivityIndicator style={{ padding: 20 }} />
          ) : (
            <ScrollView style={styles.pickerScroll} bounces={false}>
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
                  {(isStarterSlot || slot.slotPosition === "IR") && !seatLocked && (
                    <TouchableOpacity
                      accessibilityRole="button"
                      accessibilityLabel={slot.slotPosition === "IR" ? "Activate player" : "Bench player"}
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
                        {slot.slotPosition === "IR" ? "Activate" : "Bench"}
                      </ThemedText>
                    </TouchableOpacity>
                  )}
                </View>
              )}

              {listData.length === 0 && !slot.player && (
                <View style={{ padding: 20, alignItems: "center" }}>
                  <ThemedText style={{ color: c.secondaryText }}>
                    {slot.slotPosition === "IR"
                      ? "No players with OUT designation on your roster"
                      : "No eligible players available"}
                  </ThemedText>
                </View>
              )}
              {listData.map((item, idx) => {
                const fpts = playerFpts(item);
                const itemOnBench = benchPlayerIds.has(item.player_id);
                // Show diff when promoting bench->starter or when bench slot views starters
                const showDiff =
                  fpts !== null &&
                  currentFpts !== null &&
                  ((isStarterSlot && itemOnBench) || (isBenchSlot && !itemOnBench));
                const diff = showDiff
                  ? isBenchSlot
                    ? currentFpts! - fpts!   // bench perspective: positive = bench player is better
                    : fpts! - currentFpts!   // starter perspective: positive = candidate is better
                  : null;

                return (
                  <TouchableOpacity
                    key={item.player_id}
                    accessibilityRole="button"
                    accessibilityLabel={`${item.name}, ${formatPosition(item.position)}, ${item.nba_team}${fpts !== null ? `, ${fpts} fantasy points` : ''}`}
                    style={[
                      styles.pickerRow,
                      idx < listData.length - 1 && {
                        borderBottomColor: c.border,
                        borderBottomWidth: StyleSheet.hairlineWidth,
                      },
                    ]}
                    onPress={() => onSelectPlayer(item)}
                  >
                    <View style={[styles.pickerSlotChip, { backgroundColor: c.cardAlt }]}>
                      <Text style={[styles.pickerSlotChipText, { color: c.secondaryText }]}>
                        {itemOnBench ? 'BE' : slotLabel(item.roster_slot!)}
                      </Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                        <ThemedText type="defaultSemiBold" numberOfLines={1} style={{ flexShrink: 1 }}>
                          {item.name}
                        </ThemedText>
                        {(() => {
                          const badge = getInjuryBadge(item.status);
                          return badge ? (
                            <View style={[styles.liveBadge, { backgroundColor: badge.color }]}>
                              <Text style={styles.liveText}>{badge.label}</Text>
                            </View>
                          ) : null;
                        })()}
                      </View>
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

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  pickerOverlay: { flex: 1, justifyContent: "flex-end" },
  pickerSheet: {
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    maxHeight: "70%",
    overflow: "hidden",
    paddingBottom: 32,
  },
  pickerHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  closeButton: { padding: 8, marginTop: -4, marginRight: -4 },
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
  pickerScroll: { flexGrow: 0 },
  pickerRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  pickerSlotChip: {
    width: 36,
    paddingVertical: 4,
    borderRadius: 6,
    alignItems: "center",
    marginRight: 10,
  },
  pickerSlotChipText: {
    fontSize: 10,
    fontWeight: "700",
  },
  liveBadge: {
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3,
  },
  liveText: {
    color: "#fff",
    fontSize: 8,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
});
