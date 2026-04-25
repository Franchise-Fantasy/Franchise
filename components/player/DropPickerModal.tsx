import {
  Alert,
  Animated,
  FlatList,
  Modal,
  TouchableOpacity,
  View,
} from "react-native";

import { LogoSpinner } from "@/components/ui/LogoSpinner";
import { ThemedText } from "@/components/ui/ThemedText";
import { PlayerSeasonStats } from "@/types/player";
import { formatPosition } from "@/utils/formatting";
import { GameTimeMap, isGameStarted } from "@/utils/nba/gameStarted";
import { s } from "@/utils/scale";
import { calculateAvgFantasyPoints } from "@/utils/scoring/fantasyPoints";

import { playerDetailStyles as styles } from "./playerDetailStyles";

interface DropPickerModalProps {
  player: PlayerSeasonStats;
  rosterPlayers: PlayerSeasonStats[] | undefined;
  isProcessing: boolean;
  activateFromIR: boolean;
  startInDropPicker?: boolean;
  startInActivateFromIR?: boolean;
  needsWaiverClaim: boolean;
  scoringWeights: Parameters<typeof calculateAvgFantasyPoints>[1] | undefined;
  playerLockType: "daily" | "individual" | undefined;
  gameTimeMap: GameTimeMap;
  translateY: Animated.Value;
  panHandlers: object;
  colors: {
    background: string;
    border: string;
    secondaryText: string;
    accent: string;
  };
  onClose: () => void;
  onDismissDropPicker: () => void;
  onDropForClaim: ((dropPlayer: PlayerSeasonStats) => void) | undefined;
  onDropAndActivateFromIR: (dropPlayer: PlayerSeasonStats) => void;
  onDropPlayer: (dropPlayer: PlayerSeasonStats) => void;
  onSubmitWaiverClaim: (dropPlayerId?: string) => Promise<void>;
}

export function DropPickerModal({
  player,
  rosterPlayers,
  isProcessing,
  activateFromIR,
  startInDropPicker,
  startInActivateFromIR,
  needsWaiverClaim,
  scoringWeights,
  playerLockType,
  gameTimeMap,
  translateY,
  panHandlers,
  colors,
  onClose,
  onDismissDropPicker,
  onDropForClaim,
  onDropAndActivateFromIR,
  onDropPlayer,
  onSubmitWaiverClaim,
}: DropPickerModalProps) {
  const dropCandidates = (rosterPlayers ?? []).filter(
    (p) => playerLockType === "daily" || !isGameStarted(p.pro_team, gameTimeMap),
  );

  const renderDropPickerItem = ({
    item,
    index,
  }: {
    item: PlayerSeasonStats;
    index: number;
  }) => {
    const fpts = scoringWeights
      ? calculateAvgFantasyPoints(item, scoringWeights)
      : null;

    return (
      <TouchableOpacity
        style={[
          styles.dropPickerRow,
          { borderBottomColor: colors.border },
          index === dropCandidates.length - 1 && { borderBottomWidth: 0 },
        ]}
        accessibilityRole="button"
        accessibilityLabel={`Drop ${item.name}, ${formatPosition(item.position)}, ${item.pro_team}${fpts !== null ? `, ${fpts} fantasy points` : ""}`}
        onPress={() => {
          if (activateFromIR) {
            Alert.alert(
              "Confirm Transaction",
              `Drop ${item.name} to activate ${player.name} from IR?`,
              [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Confirm",
                  style: "destructive",
                  onPress: () => onDropAndActivateFromIR(item),
                },
              ],
            );
          } else if (onDropForClaim) {
            Alert.alert(
              "Select Drop for Claim",
              `Drop ${item.name} when your claim for ${player.name} processes?`,
              [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Confirm",
                  onPress: () => {
                    onDropForClaim(item);
                    onClose();
                  },
                },
              ],
            );
          } else if (needsWaiverClaim) {
            Alert.alert(
              "Select Drop for Claim",
              `Drop ${item.name} when your claim for ${player.name} processes?`,
              [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Submit Claim",
                  onPress: async () => {
                    try {
                      await onSubmitWaiverClaim(item.player_id);
                      onClose();
                    } catch (err: any) {
                      Alert.alert(
                        "Error",
                        err.message ?? "Failed to submit claim",
                      );
                    }
                  },
                },
              ],
            );
          } else {
            Alert.alert(
              "Confirm Transaction",
              `Drop ${item.name} to add ${player.name}?`,
              [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Confirm",
                  style: "destructive",
                  onPress: () => onDropPlayer(item),
                },
              ],
            );
          }
        }}
        disabled={isProcessing}
      >
        <View style={styles.dropPickerInfo}>
          <ThemedText type="defaultSemiBold" numberOfLines={1}>
            {item.name}
          </ThemedText>
          <ThemedText
            style={[styles.dropPickerSub, { color: colors.secondaryText }]}
          >
            {formatPosition(item.position)} · {item.pro_team}
          </ThemedText>
        </View>
        {fpts !== null && (
          <ThemedText style={[styles.dropPickerFpts, { color: colors.accent }]}>
            {fpts} FPTS
          </ThemedText>
        )}
      </TouchableOpacity>
    );
  };

  const onHeaderClose =
    startInDropPicker || startInActivateFromIR ? onClose : onDismissDropPicker;

  return (
    <Modal visible animationType="slide" transparent>
      <View style={styles.overlay}>
        <Animated.View
          style={[
            styles.sheet,
            { backgroundColor: colors.background, transform: [{ translateY }] },
          ]}
          accessibilityViewIsModal={true}
        >
          <View {...panHandlers}>
            <View style={[styles.header, { borderBottomColor: colors.border }]}>
              <View style={styles.headerInfo}>
                <ThemedText
                  type="title"
                  style={styles.playerName}
                  accessibilityRole="header"
                >
                  Drop a Player
                </ThemedText>
                <ThemedText
                  style={[styles.subtitle, { color: colors.secondaryText }]}
                >
                  {activateFromIR
                    ? `Your active roster is full. Select a player to drop in order to activate ${player.name} from IR.`
                    : `Your roster is full. Select a player to drop in order to add ${player.name}.`}
                </ThemedText>
              </View>
              <TouchableOpacity
                onPress={onHeaderClose}
                style={styles.closeButton}
                accessibilityRole="button"
                accessibilityLabel="Close"
              >
                <ThemedText style={styles.closeText}>✕</ThemedText>
              </TouchableOpacity>
            </View>
          </View>

          {isProcessing ? (
            <View style={styles.loading}>
              <LogoSpinner />
            </View>
          ) : (
            <FlatList
              data={dropCandidates}
              renderItem={renderDropPickerItem}
              keyExtractor={(item) => item.player_id}
              contentContainerStyle={styles.dropPickerList}
              maxToRenderPerBatch={10}
              windowSize={5}
              ListEmptyComponent={
                <View style={{ padding: s(20), alignItems: "center" }}>
                  <ThemedText
                    style={{ color: colors.secondaryText, textAlign: "center" }}
                  >
                    All your roster players have games in progress. Try again
                    later.
                  </ThemedText>
                </View>
              }
            />
          )}
        </Animated.View>
      </View>
    </Modal>
  );
}
