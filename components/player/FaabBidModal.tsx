import {
  Modal,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import { ThemedText } from "@/components/ui/ThemedText";
import { PlayerSeasonStats } from "@/types/player";
import { formatPosition } from "@/utils/formatting";
import { ms } from "@/utils/scale";

import { freeAgentListStyles as styles } from "./freeAgentListStyles";

interface FaabBidModalProps {
  player: PlayerSeasonStats | null;
  bidAmount: string;
  faabRemaining: number | null | undefined;
  colors: {
    card: string;
    secondaryText: string;
    text: string;
    border: string;
    input: string;
    cardAlt: string;
    accent: string;
    accentText: string;
  };
  onBidAmountChange: (v: string) => void;
  onCancel: () => void;
  onSubmit: (player: PlayerSeasonStats, bid: number) => void;
}

export function FaabBidModal({
  player,
  bidAmount,
  faabRemaining,
  colors,
  onBidAmountChange,
  onCancel,
  onSubmit,
}: FaabBidModalProps) {
  return (
    <Modal
      visible={!!player}
      animationType="fade"
      transparent
      onRequestClose={onCancel}
    >
      <View style={styles.modalOverlay}>
        <View style={[styles.faabModal, { backgroundColor: colors.card }]}>
          <ThemedText
            type="defaultSemiBold"
            style={{ fontSize: ms(16), marginBottom: 4 }}
          >
            Place FAAB Bid
          </ThemedText>
          <ThemedText
            style={{
              fontSize: ms(13),
              color: colors.secondaryText,
              marginBottom: 16,
            }}
          >
            {player?.name} - {formatPosition(player?.position ?? "")}
          </ThemedText>

          <View style={styles.bidRow}>
            <ThemedText
              style={{ fontSize: ms(14), color: colors.secondaryText }}
            >
              Bid Amount ($)
            </ThemedText>
            <TextInput
              style={[
                styles.bidInput,
                {
                  color: colors.text,
                  borderColor: colors.border,
                  backgroundColor: colors.input,
                },
              ]}
              value={bidAmount}
              onChangeText={onBidAmountChange}
              keyboardType="number-pad"
              selectTextOnFocus
              accessibilityLabel="Bid amount in dollars"
            />
          </View>
          <ThemedText
            style={{
              fontSize: ms(11),
              color: colors.secondaryText,
              marginBottom: 16,
            }}
          >
            Remaining budget: ${faabRemaining ?? 0}
          </ThemedText>

          <View style={styles.modalButtons}>
            <TouchableOpacity
              style={[styles.modalBtn, { backgroundColor: colors.cardAlt }]}
              onPress={onCancel}
              accessibilityRole="button"
              accessibilityLabel="Cancel bid"
            >
              <ThemedText>Cancel</ThemedText>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modalBtn, { backgroundColor: colors.accent }]}
              accessibilityRole="button"
              accessibilityLabel="Submit bid"
              onPress={() => {
                if (!player) return;
                const bid = Math.max(
                  0,
                  Math.min(parseInt(bidAmount) || 0, faabRemaining ?? 0),
                );
                onSubmit(player, bid);
              }}
            >
              <Text style={{ color: colors.accentText, fontWeight: "600" }}>
                Submit Bid
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}
