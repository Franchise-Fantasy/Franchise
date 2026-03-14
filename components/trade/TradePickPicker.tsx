import { ThemedText } from '@/components/ThemedText';
import { NumberStepper } from '@/components/ui/NumberStepper';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useTeamTradablePicks } from '@/hooks/useTrades';
import { formatPickLabel } from '@/types/trade';
import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';

export interface TradablePickRow {
  id: string;
  season: string;
  round: number;
  current_team_id: string;
  original_team_id: string;
  original_team_name: string;
}

interface TradePickPickerProps {
  teamId: string;
  teamName: string;
  leagueId: string;
  selectedPickIds: string[];
  pickProtections: Record<string, number | undefined>;
  pickConditionsEnabled: boolean;
  draftPickTradingEnabled?: boolean;
  lockedPickIds?: Set<string>;
  teamCount: number;
  onToggle: (pick: TradablePickRow) => void;
  onSetProtection: (pickId: string, threshold: number | undefined) => void;
  onBack: () => void;
}

export function TradePickPicker({
  teamId,
  teamName,
  leagueId,
  selectedPickIds,
  pickProtections,
  pickConditionsEnabled,
  draftPickTradingEnabled,
  lockedPickIds,
  teamCount,
  onToggle,
  onSetProtection,
  onBack,
}: TradePickPickerProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const [expandedPickId, setExpandedPickId] = useState<string | null>(null);

  const { data: picks, isLoading } = useTeamTradablePicks(teamId, leagueId, draftPickTradingEnabled);

  const renderItem = ({ item }: { item: TradablePickRow }) => {
    const isSelected = selectedPickIds.includes(item.id);
    const isLocked = lockedPickIds?.has(item.id) ?? false;
    const isTraded = item.current_team_id !== item.original_team_id;
    const protection = pickProtections[item.id];
    const showProtectionEditor = pickConditionsEnabled && isSelected && expandedPickId === item.id;

    return (
      <View>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={`${formatPickLabel(item.season, item.round)}${isLocked ? ', in active trade' : ''}${isTraded ? `, via ${item.original_team_name}` : ''}${protection != null ? `, Top-${protection} protected` : ''}`}
          accessibilityState={{ selected: isSelected, disabled: isLocked }}
          disabled={isLocked}
          style={[
            styles.row,
            { borderBottomColor: c.border },
            isSelected && { backgroundColor: c.activeCard },
            isLocked && { opacity: 0.45 },
          ]}
          onPress={() => onToggle(item)}
        >
          <View style={styles.info}>
            <View style={styles.pickLabelRow}>
              <ThemedText type="defaultSemiBold" style={styles.pickName}>
                {formatPickLabel(item.season, item.round)}
              </ThemedText>
              {protection != null && (
                <View style={[styles.protectionBadge, { backgroundColor: '#f59e0b20' }]}>
                  <Ionicons name="shield-checkmark" size={10} color="#f59e0b" />
                  <ThemedText style={styles.protectionBadgeText}>Top-{protection}</ThemedText>
                </View>
              )}
            </View>
            {isTraded && (
              <ThemedText style={[styles.sub, { color: c.secondaryText }]}>
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
                  color={protection != null ? '#f59e0b' : c.secondaryText}
                />
              </TouchableOpacity>
            )}
            <ThemedText style={styles.check}>{isSelected ? '✓' : ''}</ThemedText>
          </View>
        </TouchableOpacity>

        {showProtectionEditor && (
          <View style={[styles.protectionEditor, { backgroundColor: c.cardAlt, borderBottomColor: c.border }]}>
            <View style={styles.protectionHeader}>
              <Ionicons name="shield-checkmark" size={16} color="#f59e0b" accessible={false} />
              <ThemedText accessibilityRole="header" style={styles.protectionTitle}>Protection</ThemedText>
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
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel="Remove protection"
                  style={[styles.removeBtn, { borderColor: c.border }]}
                  onPress={() => {
                    onSetProtection(item.id, undefined);
                    setExpandedPickId(null);
                  }}
                >
                  <ThemedText style={[styles.removeBtnText, { color: '#ef4444' }]}>
                    Remove Protection
                  </ThemedText>
                </TouchableOpacity>
              </>
            ) : (
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Add protection"
                style={[styles.addProtectionBtn, { backgroundColor: '#f59e0b20', borderColor: '#f59e0b' }]}
                onPress={() => onSetProtection(item.id, 3)}
              >
                <Ionicons name="add" size={16} color="#f59e0b" accessible={false} />
                <ThemedText style={[styles.addProtectionText, { color: '#f59e0b' }]}>
                  Add Protection
                </ThemedText>
              </TouchableOpacity>
            )}
          </View>
        )}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <View style={[styles.header, { borderBottomColor: c.border }]}>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Back" onPress={onBack} style={styles.backBtn}>
          <ThemedText style={[styles.backText, { color: c.accent }]}>‹ Back</ThemedText>
        </TouchableOpacity>
        <ThemedText accessibilityRole="header" type="defaultSemiBold" style={styles.headerTitle} numberOfLines={1}>
          {teamName} Picks
        </ThemedText>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Done" onPress={onBack} style={styles.doneBtn}>
          <ThemedText style={[styles.doneText, { color: c.accent }]}>Done</ThemedText>
        </TouchableOpacity>
      </View>

      {isLoading ? (
        <ActivityIndicator style={styles.loader} />
      ) : (picks ?? []).length === 0 ? (
        <View style={styles.empty}>
          <ThemedText style={[styles.emptyText, { color: c.secondaryText }]}>
            No tradeable picks available
          </ThemedText>
        </View>
      ) : (
        <FlatList
          data={picks as TradablePickRow[]}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          extraData={[selectedPickIds, pickProtections, expandedPickId]}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { width: 60 },
  backText: { fontSize: 16, fontWeight: '500' },
  headerTitle: { flex: 1, fontSize: 16, textAlign: 'center' },
  doneBtn: { width: 60, alignItems: 'flex-end' },
  doneText: { fontSize: 15, fontWeight: '600' },
  loader: { marginTop: 20 },
  empty: { padding: 40, alignItems: 'center' },
  emptyText: { fontSize: 15 },
  list: { paddingBottom: 16 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  info: { flex: 1 },
  pickLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pickName: { fontSize: 14 },
  sub: { fontSize: 11, marginTop: 1 },
  rightActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  shieldBtn: { padding: 4 },
  check: {
    width: 22,
    fontSize: 16,
    fontWeight: '700',
    color: '#28a745',
    textAlign: 'center',
  },
  protectionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
  },
  protectionBadgeText: { fontSize: 10, fontWeight: '600', color: '#f59e0b' },
  protectionEditor: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  protectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  protectionTitle: { fontSize: 13, fontWeight: '600' },
  removeBtn: {
    marginTop: 8,
    alignItems: 'center',
    paddingVertical: 6,
    borderWidth: 1,
    borderRadius: 8,
  },
  removeBtnText: { fontSize: 13, fontWeight: '500' },
  addProtectionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    borderWidth: 1,
    borderRadius: 8,
  },
  addProtectionText: { fontSize: 13, fontWeight: '600' },
});
