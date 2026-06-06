import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, TouchableOpacity, View, type StyleProp, type ViewStyle } from "react-native";

import { LogoSpinner } from "@/components/ui/LogoSpinner";
import { ThemedText } from "@/components/ui/ThemedText";
import { useColors } from "@/hooks/useColors";
import { ms, s } from "@/utils/scale";

const TAXI_PURPLE = "#8e44ad";

interface PlayerActionBarProps {
  playerName: string;
  isOnMyTeam: boolean;
  isFreeAgent: boolean;
  draftMode: boolean;
  playerRosterSlot: string | null;
  isTaxiSlot: boolean;
  // gating
  isProcessing: boolean;
  canTransact: boolean;
  canAdd: boolean;
  canDraft: boolean;
  needsWaiverClaim: boolean;
  playerGameStarted: boolean;
  canMoveToIR: boolean;
  canMoveToTaxi: boolean;
  isOnTradeBlock: boolean;
  // handlers
  onAdd: () => void;
  onDraft: () => void;
  onActivateFromIR: () => void;
  onPromoteFromTaxi: () => void;
  onDrop: () => void;
  onMoveToIR: () => void;
  onMoveToTaxi: () => void;
  onToggleTradeBlock: () => void;
}

/**
 * Docked footer action bar for the player detail sheet. Pure presentation —
 * the parent owns every mutation; this only renders the right buttons for the
 * current context (own roster move set, draft pick, or free-agent add/claim).
 */
export function PlayerActionBar({
  playerName,
  isOnMyTeam,
  isFreeAgent,
  draftMode,
  playerRosterSlot,
  isTaxiSlot,
  isProcessing,
  canTransact,
  canAdd,
  canDraft,
  needsWaiverClaim,
  playerGameStarted,
  canMoveToIR,
  canMoveToTaxi,
  isOnTradeBlock,
  onAdd,
  onDraft,
  onActivateFromIR,
  onPromoteFromTaxi,
  onDrop,
  onMoveToIR,
  onMoveToTaxi,
  onToggleTradeBlock,
}: PlayerActionBarProps) {
  const c = useColors();

  if (draftMode) {
    return (
      <View style={styles.row}>
        <ActionButton
          label="Draft"
          fill={c.link}
          textColor={c.statusText}
          onPress={onDraft}
          disabled={!canDraft}
          flex
          accessibilityLabel={`Draft ${playerName}`}
        />
      </View>
    );
  }

  if (isOnMyTeam) {
    const isIR = playerRosterSlot === "IR";
    return (
      <View style={styles.row}>
        {isIR && (
          <ActionButton
            label="Activate"
            fill={c.success}
            textColor={c.statusText}
            onPress={onActivateFromIR}
            disabled={!canTransact || playerGameStarted}
            loading={isProcessing}
            flex
            accessibilityLabel={`Activate ${playerName} from IR`}
          />
        )}
        {isTaxiSlot && (
          <ActionButton
            label="Promote"
            fill={c.success}
            textColor={c.statusText}
            onPress={onPromoteFromTaxi}
            disabled={!canTransact}
            loading={isProcessing}
            flex
            accessibilityLabel={`Promote ${playerName} from taxi squad`}
          />
        )}
        <ActionButton
          label="Drop"
          fill={c.danger}
          textColor={c.statusText}
          onPress={onDrop}
          disabled={!canTransact}
          loading={isProcessing && !isIR}
          flex
          accessibilityLabel={`Drop ${playerName}`}
        />
        {canMoveToIR && (
          <ActionButton
            label="IR"
            outlineColor={c.warning}
            onPress={onMoveToIR}
            disabled={!canTransact}
            flex
            accessibilityLabel={`Move ${playerName} to IR`}
          />
        )}
        {canMoveToTaxi && (
          <ActionButton
            label="Taxi"
            fill={TAXI_PURPLE}
            textColor="#FFFFFF"
            onPress={onMoveToTaxi}
            disabled={!canTransact}
            flex
            accessibilityLabel={`Move ${playerName} to taxi squad`}
          />
        )}
        <TouchableOpacity
          style={[
            styles.btn,
            styles.iconBtn,
            isOnTradeBlock
              ? { backgroundColor: c.warning }
              : { borderWidth: 1, borderColor: c.warning },
            isProcessing && styles.disabled,
          ]}
          onPress={onToggleTradeBlock}
          disabled={isProcessing}
          accessibilityRole="button"
          accessibilityLabel={
            isOnTradeBlock
              ? `Remove ${playerName} from trade block`
              : `Add ${playerName} to trade block`
          }
        >
          <Ionicons
            name={isOnTradeBlock ? "megaphone" : "megaphone-outline"}
            size={ms(16)}
            color={isOnTradeBlock ? c.statusText : c.warning}
          />
        </TouchableOpacity>
      </View>
    );
  }

  if (isFreeAgent) {
    return (
      <View style={styles.row}>
        <ActionButton
          label={needsWaiverClaim ? "Claim" : "Add"}
          fill={needsWaiverClaim ? c.gold : c.success}
          textColor={c.statusText}
          onPress={onAdd}
          disabled={!canAdd}
          loading={isProcessing}
          flex
          accessibilityLabel={needsWaiverClaim ? `Claim ${playerName}` : `Add ${playerName}`}
        />
      </View>
    );
  }

  return null;
}

function ActionButton({
  label,
  onPress,
  fill,
  textColor,
  outlineColor,
  disabled,
  loading,
  flex,
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  fill?: string;
  textColor?: string;
  outlineColor?: string;
  disabled?: boolean;
  loading?: boolean;
  flex?: boolean;
  accessibilityLabel: string;
}) {
  const isOutline = !!outlineColor;
  const containerStyle: StyleProp<ViewStyle> = [
    styles.btn,
    flex && styles.btnFlex,
    isOutline
      ? { borderWidth: 1, borderColor: outlineColor }
      : { backgroundColor: fill },
    disabled && styles.disabled,
  ];
  return (
    <TouchableOpacity
      style={containerStyle}
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: !!disabled, busy: !!loading }}
    >
      {loading ? (
        <LogoSpinner size={ms(18)} />
      ) : (
        <ThemedText
          type="varsity"
          style={[styles.btnText, { color: isOutline ? outlineColor : textColor }]}
        >
          {label}
        </ThemedText>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: s(8),
  },
  btn: {
    height: s(42),
    borderRadius: 10,
    paddingHorizontal: s(14),
    alignItems: "center",
    justifyContent: "center",
  },
  btnFlex: {
    flex: 1,
  },
  iconBtn: {
    width: s(46),
    paddingHorizontal: 0,
  },
  btnText: {
    fontSize: ms(12),
    letterSpacing: 0.8,
  },
  disabled: {
    opacity: 0.5,
  },
});
