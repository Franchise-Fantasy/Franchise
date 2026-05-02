import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { FlatList, StyleSheet, TouchableOpacity, View } from 'react-native';

import { Badge } from '@/components/ui/Badge';
import { BrandButton } from '@/components/ui/BrandButton';
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
  const [expandedPickId, setExpandedPickId] = useState<string | null>(null);

  const { data: picks, isLoading } = useTeamTradablePicks(teamId, leagueId, draftPickTradingEnabled);

  const renderItem = ({ item, index }: { item: TradablePickRow; index: number }) => {
    const isSelected = selectedPickIds.includes(item.id);
    const isLocked = lockedPickIds?.has(item.id) ?? false;
    const isTraded = item.current_team_id !== item.original_team_id;
    const protection = pickProtections[item.id];
    const showProtectionEditor = pickConditionsEnabled && isSelected && expandedPickId === item.id;
    const isLast = index === (picks as TradablePickRow[]).length - 1;

    return (
      <View>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={`${formatPickLabel(item.season, item.round)}${isLocked ? ', in active trade' : ''}${isTraded ? `, via ${item.original_team_name}` : ''}${protection != null ? `, Top-${protection} protected` : ''}`}
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
                {formatPickLabel(item.season, item.round)}
              </ThemedText>
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
          </View>
          <View style={styles.rightActions}>
            {pickConditionsEnabled && isSelected && (
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={protection != null ? 'Edit pick protection' : 'Add pick protection'}
                accessibilityState={{ expanded: expandedPickId === item.id }}
                style={styles.shieldBtn}
                onPress={() => setExpandedPickId(expandedPickId === item.id ? null : item.id)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons
                  name="shield-checkmark-outline"
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

        {showProtectionEditor && (
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
            {protection != null ? (
              <>
                <NumberStepper
                  label={`Top-${protection} protected`}
                  value={protection}
                  onValueChange={(v) => onSetProtection(item.id, v)}
                  min={1}
                  max={teamCount - 1}
                />
                <View style={styles.protectionCta}>
                  <BrandButton
                    label="Remove Protection"
                    variant="secondary"
                    size="small"
                    fullWidth
                    onPress={() => {
                      onSetProtection(item.id, undefined);
                      setExpandedPickId(null);
                    }}
                    accessibilityLabel="Remove protection"
                  />
                </View>
              </>
            ) : (
              <BrandButton
                label="Add Protection"
                icon="add"
                variant="primary"
                size="small"
                fullWidth
                onPress={() => onSetProtection(item.id, 3)}
                accessibilityLabel="Add protection"
              />
            )}
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
      extraData={[selectedPickIds, pickProtections, expandedPickId]}
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
  protectionCta: {
    marginTop: s(4),
  },
});
