import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import {
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { PlayerHeadshotImage } from "@/components/player/PlayerHeadshotImage";
import { AppTextInput } from "@/components/ui/AppTextInput";
import { ThemedText } from "@/components/ui/ThemedText";
import { cardShadowMedium, Fonts } from "@/constants/Colors";
import { useActiveLeagueSport } from "@/hooks/useActiveLeagueSport";
import { useColors } from "@/hooks/useColors";
import { PlayerSeasonStats } from "@/types/player";
import { formatPosition } from "@/utils/formatting";
import { ms, s } from "@/utils/scale";

interface FaabBidModalProps {
  player: PlayerSeasonStats | null;
  /** When true, the modal is changing an existing pending bid rather than
   *  placing a new one — swaps the eyebrow/submit copy accordingly. */
  isEditing?: boolean;
  /** Starting bid when the modal opens (the existing bid when editing). */
  initialBid?: number;
  faabRemaining: number | null | undefined;
  onCancel: () => void;
  onSubmit: (player: PlayerSeasonStats, bid: number) => void;
}

export function FaabBidModal({
  player,
  isEditing = false,
  initialBid = 0,
  faabRemaining,
  onCancel,
  onSubmit,
}: FaabBidModalProps) {
  const c = useColors();
  const sport = useActiveLeagueSport();
  // Bid keystrokes are modal-local state so typing doesn't re-render the
  // owning list screen. Re-seeded from initialBid whenever a new bid session
  // opens (player/edit-mode changes), via the adjust-during-render pattern.
  const sessionKey = player ? `${player.player_id}:${isEditing}` : null;
  const [bidState, setBidState] = useState({ key: sessionKey, value: String(initialBid ?? 0) });
  if (bidState.key !== sessionKey) {
    setBidState({ key: sessionKey, value: String(initialBid ?? 0) });
  }
  const bidAmount = bidState.value;
  const setBidAmount = (v: string) => setBidState({ key: sessionKey, value: v });
  const budget = faabRemaining ?? 0;
  const parsedBid = parseInt(bidAmount) || 0;
  const overBudget = parsedBid > budget;

  return (
    <Modal
      visible={!!player}
      animationType="fade"
      transparent
      onRequestClose={onCancel}
    >
      <TouchableOpacity
        style={styles.overlay}
        activeOpacity={1}
        onPress={onCancel}
      >
        <View
          style={[
            styles.card,
            { backgroundColor: c.card, borderColor: c.border },
          ]}
          onStartShouldSetResponder={() => true}
          accessibilityViewIsModal
        >
          <View style={[styles.topRule, { backgroundColor: c.gold }]} />

          <View style={styles.header}>
            <View style={styles.headerText}>
              <ThemedText
                type="varsitySmall"
                style={[styles.eyebrow, { color: c.gold }]}
              >
                {isEditing ? "EDIT BID" : "PLACE A BID"}
              </ThemedText>
              <ThemedText
                type="display"
                style={[styles.title, { color: c.text }]}
                accessibilityRole="header"
                numberOfLines={2}
              >
                FAAB Waiver
              </ThemedText>
            </View>
            <TouchableOpacity
              onPress={onCancel}
              style={styles.closeBtn}
              accessibilityRole="button"
              accessibilityLabel="Cancel bid"
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="close" size={ms(20)} color={c.secondaryText} />
            </TouchableOpacity>
          </View>

          {player && (
            <View
              style={[
                styles.playerChip,
                { backgroundColor: c.cardAlt, borderColor: c.border },
              ]}
            >
              <View
                style={[
                  styles.headshotCircle,
                  { borderColor: c.heritageGold, backgroundColor: c.cardAlt },
                ]}
                accessibilityLabel={`${player.name} headshot`}
              >
                <PlayerHeadshotImage
                  externalIdNba={player.external_id_nba}
                  sport={sport}
                  style={styles.headshotImg}
                  accessible={false}
                />
              </View>
              <View style={styles.playerInfo}>
                <ThemedText
                  type="defaultSemiBold"
                  numberOfLines={1}
                  style={styles.playerName}
                >
                  {player.name}
                </ThemedText>
                <ThemedText
                  type="varsitySmall"
                  style={[styles.playerMeta, { color: c.secondaryText }]}
                >
                  {formatPosition(player.position)} · {player.pro_team}
                </ThemedText>
              </View>
            </View>
          )}

          <View style={styles.bidSection}>
            <ThemedText
              type="varsitySmall"
              style={[styles.fieldLabel, { color: c.secondaryText }]}
            >
              BID AMOUNT
            </ThemedText>
            <View
              style={[
                styles.bidRow,
                {
                  borderColor: overBudget ? c.danger : c.border,
                  backgroundColor: c.input,
                },
              ]}
            >
              <Text style={[styles.dollarSign, { color: c.secondaryText }]}>
                $
              </Text>
              <AppTextInput
                style={[styles.bidInput, { color: c.text }]}
                value={bidAmount}
                onChangeText={setBidAmount}
                keyboardType="number-pad"
                selectTextOnFocus
                maxLength={4}
                accessibilityLabel="Bid amount in dollars"
                accessibilityHint={`Maximum bid is ${budget} dollars`}
              />
            </View>
            <View style={styles.budgetRow}>
              <ThemedText
                style={[
                  styles.budgetText,
                  { color: overBudget ? c.danger : c.secondaryText },
                ]}
              >
                {overBudget
                  ? `Exceeds budget of $${budget}`
                  : `Remaining budget: $${budget}`}
              </ThemedText>
              {budget > 0 && (
                <TouchableOpacity
                  onPress={() => setBidAmount(String(budget))}
                  accessibilityRole="button"
                  accessibilityLabel="Bid maximum"
                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                >
                  <ThemedText
                    type="varsitySmall"
                    style={[styles.maxLink, { color: c.gold }]}
                  >
                    BID MAX
                  </ThemedText>
                </TouchableOpacity>
              )}
            </View>
          </View>

          <View style={styles.buttons}>
            <TouchableOpacity
              style={[
                styles.btn,
                styles.btnGhost,
                { borderColor: c.border, backgroundColor: c.cardAlt },
              ]}
              onPress={onCancel}
              accessibilityRole="button"
              accessibilityLabel="Cancel bid"
            >
              <Text style={[styles.btnGhostText, { color: c.text }]}>
                CANCEL
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.btn,
                styles.btnPrimary,
                { backgroundColor: c.accent },
                (!player || parsedBid <= 0) && styles.btnDisabled,
              ]}
              accessibilityRole="button"
              accessibilityLabel={isEditing ? "Update bid" : "Submit bid"}
              disabled={!player || parsedBid <= 0}
              onPress={() => {
                if (!player) return;
                const bid = Math.max(0, Math.min(parsedBid, budget));
                onSubmit(player, bid);
              }}
            >
              <Text style={[styles.btnPrimaryText, { color: c.accentText }]}>
                {isEditing ? "UPDATE BID" : "SUBMIT BID"}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(20, 16, 16, 0.55)",
    justifyContent: "center",
    alignItems: "center",
    padding: s(20),
  },
  card: {
    width: "100%",
    maxWidth: s(360),
    borderRadius: 16,
    borderWidth: 1,
    overflow: "hidden",
    ...cardShadowMedium,
  },
  topRule: {
    height: 3,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingHorizontal: s(20),
    paddingTop: s(16),
    paddingBottom: s(12),
    gap: s(10),
  },
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  eyebrow: {
    fontSize: ms(10),
    letterSpacing: 1.3,
    marginBottom: s(2),
  },
  title: {
    fontFamily: Fonts.display,
    fontSize: ms(22),
    lineHeight: ms(26),
    letterSpacing: -0.2,
  },
  closeBtn: {
    padding: s(2),
    marginTop: s(2),
  },
  playerChip: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: s(20),
    marginBottom: s(16),
    paddingVertical: s(8),
    paddingHorizontal: s(10),
    borderRadius: 10,
    borderWidth: 1,
    gap: s(10),
  },
  headshotCircle: {
    width: s(40),
    height: s(40),
    borderRadius: s(20),
    borderWidth: 1.5,
    overflow: "hidden",
  },
  headshotImg: {
    position: "absolute" as const,
    bottom: s(-2),
    left: 0,
    right: 0,
    height: s(36),
  },
  playerInfo: {
    flex: 1,
    minWidth: 0,
  },
  playerName: {
    fontSize: ms(14),
  },
  playerMeta: {
    fontSize: ms(9.5),
    letterSpacing: 1.0,
    marginTop: s(2),
  },
  bidSection: {
    paddingHorizontal: s(20),
    marginBottom: s(16),
  },
  fieldLabel: {
    fontSize: ms(10),
    letterSpacing: 1.2,
    marginBottom: s(6),
  },
  bidRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: s(14),
    paddingVertical: s(10),
    borderWidth: 1,
    borderRadius: 10,
    gap: s(4),
  },
  dollarSign: {
    fontSize: ms(20),
    fontWeight: "600",
  },
  bidInput: {
    flex: 1,
    fontSize: ms(22),
    fontWeight: "700",
    padding: 0,
    minHeight: ms(28),
  },
  budgetRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: s(8),
  },
  budgetText: {
    fontSize: ms(11),
  },
  maxLink: {
    fontSize: ms(10),
    letterSpacing: 1.2,
  },
  buttons: {
    flexDirection: "row",
    paddingHorizontal: s(20),
    paddingBottom: s(20),
    gap: s(10),
  },
  btn: {
    flex: 1,
    paddingVertical: s(12),
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  btnGhost: {
    borderWidth: 1,
  },
  btnGhostText: {
    fontFamily: Fonts.varsityBold,
    fontSize: ms(12),
    letterSpacing: 1.2,
  },
  btnPrimary: {},
  btnPrimaryText: {
    fontFamily: Fonts.varsityBold,
    fontSize: ms(12),
    letterSpacing: 1.2,
  },
  btnDisabled: {
    opacity: 0.5,
  },
});
