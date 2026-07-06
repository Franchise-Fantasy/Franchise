import { Ionicons } from '@expo/vector-icons';
import { FlatList, StyleSheet, TouchableOpacity, View } from 'react-native';

import { Badge } from '@/components/ui/Badge';
import { LogoSpinner } from '@/components/ui/LogoSpinner';
import { NumberStepper } from '@/components/ui/NumberStepper';
import { ThemedText } from '@/components/ui/ThemedText';
import { useColors } from '@/hooks/useColors';
import { useTeamTradablePicks } from '@/hooks/useTrades';
import { formatPickLabel } from '@/types/trade';
import { ms, s } from '@/utils/scale';

export interface TradablePickRow {
  id: string;
  season: string;
  round: number;
  current_team_id: string;
  original_team_id: string;
  original_team_name: string;
  /** Resolved pick slot — set post-lottery (from `slot_number`) or pre-lottery
   *  via reverse-standings projection. Null when no standings data is available
   *  yet (e.g. brand-new league). */
  display_slot: number | null;
  /** Protection already carried by the pick (set by an earlier trade). A pick
   *  holds at most one protection — execute-trade rejects adding another. */
  protection_threshold: number | null;
  protection_owner_id: string | null;
  protection_owner_name: string | null;
  /** Active swap right on this pick's round the owning team is party to. */
  swap_info: { isBeneficiary: boolean; partner_name: string } | null;
}

interface TradePickPickerBodyProps {
  teamId: string;
  leagueId: string;
  selectedPickIds: string[];
  pickProtections: Record<string, number | undefined>;
  pickConditionsEnabled: boolean;
  draftPickTradingEnabled?: boolean;
  lockedPickIds?: Set<string>;
  teamCount: number;
  onToggle: (pick: TradablePickRow) => void;
  onSetProtection: (pickId: string, threshold: number | undefined) => void;
}

/**
 * Interactive body of the pick picker — list + selection + per-row inline
 * protection editor (NumberStepper + BrandButton row).
 *
 * Extracted so it can compose into both the full-screen `TradePickPicker`
 * and the inline reveal in the upcoming `TradeFloor` rework.
 *
 * The protection-editor expand state is internal here (not lifted) — it's
 * scoped to "which row is open right now" and resets cleanly when the
 * picker collapses, which is the desired behavior in both compositions.
 */
export function TradePickPickerBody({
  teamId,
  leagueId,
  selectedPickIds,
  pickProtections,
  pickConditionsEnabled,
  draftPickTradingEnabled,
  lockedPickIds,
  teamCount,
  onToggle,
  onSetProtection,
}: TradePickPickerBodyProps) {
  const c = useColors();

  const { data: picks, isLoading } = useTeamTradablePicks(teamId, leagueId, draftPickTradingEnabled);

  // Default protection threshold when toggling protection ON via the
  // shield. Top-3 covers the common "lottery protection" intent; users
  // adjust via the inline NumberStepper after the toggle.
  const DEFAULT_PROTECTION = 3;

  const renderItem = ({ item, index }: { item: TradablePickRow; index: number }) => {
    const isSelected = selectedPickIds.includes(item.id);
    const isLocked = lockedPickIds?.has(item.id) ?? false;
    const isTraded = item.current_team_id !== item.original_team_id;
    const protection = pickProtections[item.id];
    // Protection the pick ALREADY carries from an earlier trade. A pick holds
    // at most one protection, so the shield toggle is hidden for these —
    // execute-trade rejects a second protection server-side.
    const existingProtection = item.protection_threshold;
    // Stepper auto-shows whenever a protection is engaged — no separate
    // "is the editor open" state. Tapping the shield toggles protection
    // on/off; the threshold is adjusted inline via the stepper.
    const showProtectionEditor = pickConditionsEnabled && isSelected && protection != null;
    const isLast = index === (picks as TradablePickRow[]).length - 1;

    return (
      <View>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={`${formatPickLabel(item.season, item.round, item.display_slot)}${isLocked ? ', in active trade' : ''}${isTraded ? `, via ${item.original_team_name}` : ''}${existingProtection != null ? `, already Top-${existingProtection} protected${item.protection_owner_name ? ` for ${item.protection_owner_name}` : ''}` : ''}${item.swap_info ? `, in a pick swap with ${item.swap_info.partner_name}` : ''}${protection != null ? `, Top-${protection} protected` : ''}`}
          accessibilityState={{ selected: isSelected, disabled: isLocked }}
          disabled={isLocked}
          style={[
            styles.row,
            { borderBottomColor: c.border, backgroundColor: isSelected ? c.cardAlt : 'transparent' },
            isLocked && { opacity: 0.45 },
            isLast && { borderBottomWidth: 0 },
          ]}
          onPress={() => onToggle(item)}
        >
          <View
            style={[
              styles.rowRule,
              { backgroundColor: isSelected ? c.gold : 'transparent' },
            ]}
          />
          <View style={styles.info}>
            <View style={styles.pickLabelRow}>
              <ThemedText
                type="defaultSemiBold"
                style={[styles.pickName, { color: c.text }]}
              >
                {formatPickLabel(item.season, item.round, item.display_slot)}
              </ThemedText>
              {existingProtection != null && (
                <Badge label={`Top ${existingProtection} protected`} variant="warning" size="small" />
              )}
              {item.swap_info != null && (
                <Badge label="Swap" variant="turf" size="small" />
              )}
              {protection != null && (
                <Badge label={`Top ${protection}`} variant="gold" size="small" />
              )}
            </View>
            {isTraded && (
              <ThemedText
                type="varsitySmall"
                style={[styles.via, { color: c.gold }]}
                numberOfLines={1}
              >
                via {item.original_team_name}
              </ThemedText>
            )}
            {existingProtection != null && item.protection_owner_name && (
              <ThemedText
                type="varsitySmall"
                style={[styles.via, { color: c.warning }]}
                numberOfLines={1}
              >
                reverts to {item.protection_owner_name} if top {existingProtection}
              </ThemedText>
            )}
            {item.swap_info != null && (
              <ThemedText
                type="varsitySmall"
                style={[styles.via, { color: c.success }]}
                numberOfLines={1}
              >
                {item.swap_info.isBeneficiary ? 'swaps up vs' : 'swap right held by'} {item.swap_info.partner_name}
              </ThemedText>
            )}
          </View>
          <View style={styles.rightActions}>
            {pickConditionsEnabled && isSelected && existingProtection == null && (
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={protection != null ? 'Remove pick protection' : 'Add pick protection'}
                accessibilityState={{ checked: protection != null }}
                style={styles.shieldBtn}
                onPress={() =>
                  onSetProtection(
                    item.id,
                    protection != null ? undefined : DEFAULT_PROTECTION,
                  )
                }
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons
                  name={protection != null ? 'shield-checkmark' : 'shield-outline'}
                  size={18}
                  color={protection != null ? c.gold : c.secondaryText}
                />
              </TouchableOpacity>
            )}
            {isSelected ? (
              <Ionicons name="checkmark-circle" size={20} color={c.gold} accessible={false} />
            ) : (
              <View style={styles.checkSpacer} />
            )}
          </View>
        </TouchableOpacity>

        {showProtectionEditor && protection != null && (
          <View style={[styles.protectionEditor, { backgroundColor: c.cardAlt, borderBottomColor: c.border }]}>
            <View style={styles.protectionHeader}>
              <View style={[styles.protectionRule, { backgroundColor: c.gold }]} />
              <ThemedText
                type="varsitySmall"
                style={[styles.protectionLabel, { color: c.gold }]}
              >
                Protection
              </ThemedText>
            </View>
            <NumberStepper
              label={`Top-${protection} protected`}
              value={protection}
              onValueChange={(v) => onSetProtection(item.id, v)}
              min={1}
              max={teamCount - 1}
            />
          </View>
        )}
      </View>
    );
  };

  if (isLoading) {
    return (
      <View style={styles.loader}>
        <LogoSpinner />
      </View>
    );
  }
  if ((picks ?? []).length === 0) {
    return (
      <View style={styles.empty}>
        <ThemedText style={[styles.emptyText, { color: c.secondaryText }]}>
          No tradeable picks available
        </ThemedText>
      </View>
    );
  }
  return (
    <FlatList
      data={picks as TradablePickRow[]}
      renderItem={renderItem}
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.list}
      extraData={[selectedPickIds, pickProtections]}
      keyboardShouldPersistTaps="handled"
      nestedScrollEnabled
    />
  );
}

const styles = StyleSheet.create({
  loader: { marginTop: s(20) },
  empty: { padding: s(40), alignItems: 'center' },
  emptyText: { fontSize: ms(15) },
  list: { paddingBottom: s(16) },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: s(12),
    paddingHorizontal: s(12),
    gap: s(10),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowRule: {
    width: 3,
    height: s(28),
  },
  info: { flex: 1, minWidth: 0 },
  pickLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(6),
  },
  pickName: { fontSize: ms(14) },
  via: {
    fontSize: ms(9),
    letterSpacing: 1.0,
    marginTop: s(2),
  },
  rightActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(8),
  },
  shieldBtn: { padding: s(4) },
  checkSpacer: { width: s(20) },

  protectionEditor: {
    paddingHorizontal: s(14),
    paddingVertical: s(12),
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: s(10),
  },
  protectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(8),
  },
  protectionRule: { height: 2, width: s(14) },
  protectionLabel: {
    fontSize: ms(9),
    letterSpacing: 1.4,
  },
});
