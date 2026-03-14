import { ThemedText } from '@/components/ThemedText';
import { Colors } from '@/constants/Colors';
import { POSITIONS, SortKey, TimeRange } from '@/hooks/usePlayerFilter';
import { useColorScheme } from '@/hooks/useColorScheme';
import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

const SORT_OPTIONS: SortKey[] = ['FPTS', 'PPG', 'RPG', 'APG', 'SPG', 'BPG', 'MPG'];
const TIME_RANGE_OPTIONS: { key: TimeRange; label: string }[] = [
  { key: 'season', label: 'Season' },
  { key: '7d', label: '7D' },
  { key: '14d', label: '14D' },
  { key: '30d', label: '30D' },
];

interface PlayerFilterBarProps {
  searchText: string;
  onSearchChange: (text: string) => void;
  selectedPosition: string;
  onPositionChange: (pos: string) => void;
  sortBy: string;
  onSortChange: (sort: string) => void;
  showMinutesUp?: boolean;
  onMinutesUpChange?: (show: boolean) => void;
  hasMinutesData?: boolean;
  showAvailableToday?: boolean;
  onAvailableTodayChange?: (show: boolean) => void;
  hasScheduleData?: boolean;
  timeRange?: TimeRange;
  onTimeRangeChange?: (range: TimeRange) => void;
  showWatchlistOnly?: boolean;
  onWatchlistOnlyChange?: (show: boolean) => void;
  hasWatchlistData?: boolean;
  showFreeAgentsOnly?: boolean;
  onFreeAgentsOnlyChange?: (show: boolean) => void;
  hasRosteredData?: boolean;
}

export function PlayerFilterBar({
  searchText,
  onSearchChange,
  selectedPosition,
  onPositionChange,
  sortBy,
  onSortChange,
  showMinutesUp,
  onMinutesUpChange,
  hasMinutesData,
  showAvailableToday,
  onAvailableTodayChange,
  hasScheduleData,
  timeRange,
  onTimeRangeChange,
  showWatchlistOnly,
  onWatchlistOnlyChange,
  hasWatchlistData,
  showFreeAgentsOnly,
  onFreeAgentsOnlyChange,
  hasRosteredData,
}: PlayerFilterBarProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const [modalVisible, setModalVisible] = useState(false);

  // Count active filters (non-default) — excludes "All Players" toggle which is inline
  const activeFilterCount =
    (selectedPosition !== 'All' ? 1 : 0) +
    (sortBy !== 'FPTS' ? 1 : 0) +
    (showMinutesUp ? 1 : 0) +
    (showAvailableToday ? 1 : 0) +
    (timeRange && timeRange !== 'season' ? 1 : 0) +
    (showWatchlistOnly ? 1 : 0);

  const resetFilters = () => {
    onPositionChange('All');
    onSortChange('FPTS');
    onMinutesUpChange?.(false);
    onAvailableTodayChange?.(false);
    onTimeRangeChange?.('season');
    onWatchlistOnlyChange?.(false);
    onFreeAgentsOnlyChange?.(true);
  };

  return (
    <View style={[styles.container, { backgroundColor: c.card, borderBottomColor: c.border }]}>
      {/* Search row with filter button */}
      <View style={styles.searchRow}>
        <TextInput
          accessibilityLabel="Search players"
          style={[styles.searchInput, { backgroundColor: c.input, color: c.text, borderColor: c.border }]}
          placeholder="Search players..."
          placeholderTextColor={c.secondaryText}
          value={searchText}
          onChangeText={onSearchChange}
          autoCorrect={false}
          returnKeyType="search"
        />
        {onFreeAgentsOnlyChange && (
          <TouchableOpacity
            onPress={() => onFreeAgentsOnlyChange(!showFreeAgentsOnly)}
            style={[
              styles.filterBtn,
              { backgroundColor: c.input, borderColor: c.border },
              !showFreeAgentsOnly && { backgroundColor: '#007AFF15', borderColor: '#007AFF' },
            ]}
            accessibilityRole="button"
            accessibilityLabel={showFreeAgentsOnly ? 'Show all players' : 'Show free agents only'}
            hitSlop={4}
          >
            <Ionicons name="people" size={18} color={!showFreeAgentsOnly ? '#007AFF' : c.secondaryText} />
          </TouchableOpacity>
        )}
        <TouchableOpacity
          onPress={() => setModalVisible(true)}
          style={[styles.filterBtn, { backgroundColor: c.input, borderColor: c.border }]}
          accessibilityRole="button"
          accessibilityLabel={`Filters${activeFilterCount > 0 ? `, ${activeFilterCount} active` : ''}`}
          hitSlop={4}
        >
          <Ionicons name="options-outline" size={18} color={activeFilterCount > 0 ? c.accent : c.secondaryText} />
          {activeFilterCount > 0 && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{activeFilterCount}</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      {/* Filter modal */}
      <Modal
        visible={modalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setModalVisible(false)}
      >
        <Pressable style={styles.backdrop} onPress={() => setModalVisible(false)}>
          <Pressable
            style={[styles.modal, { backgroundColor: c.card, borderColor: c.border }]}
            onPress={() => {/* prevent close on content tap */}}
          >
            {/* Header */}
            <View style={styles.modalHeader}>
              <ThemedText type="defaultSemiBold" style={styles.modalTitle}>Filters</ThemedText>
              {activeFilterCount > 0 && (
                <TouchableOpacity
                  onPress={resetFilters}
                  accessibilityRole="button"
                  accessibilityLabel="Reset all filters"
                  hitSlop={8}
                >
                  <ThemedText style={[styles.resetText, { color: c.accent }]}>Reset</ThemedText>
                </TouchableOpacity>
              )}
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              {/* Quick Filters */}
              {(onWatchlistOnlyChange || hasMinutesData || hasScheduleData) && (
              <View style={styles.section}>
                <ThemedText style={[styles.sectionLabel, { color: c.secondaryText }]}>Quick Filters</ThemedText>
                <View style={styles.toggleGrid}>
                  {onWatchlistOnlyChange && (
                    <TouchableOpacity
                      accessibilityRole="button"
                      accessibilityLabel="Show only watchlisted players"
                      accessibilityState={{ selected: showWatchlistOnly }}
                      style={[
                        styles.toggleCompact,
                        { borderColor: c.border },
                        showWatchlistOnly && { backgroundColor: '#007AFF15', borderColor: '#007AFF' },
                      ]}
                      onPress={() => onWatchlistOnlyChange(!showWatchlistOnly)}
                    >
                      <Ionicons name={showWatchlistOnly ? 'eye' : 'eye-outline'} size={14} color={showWatchlistOnly ? '#007AFF' : c.secondaryText} />
                      <ThemedText style={[styles.toggleCompactLabel, showWatchlistOnly && { color: '#007AFF' }]}>
                        Watchlist
                      </ThemedText>
                    </TouchableOpacity>
                  )}
                  {hasMinutesData && onMinutesUpChange && (
                    <TouchableOpacity
                      accessibilityRole="button"
                      accessibilityLabel="Show players with rising minutes"
                      accessibilityState={{ selected: showMinutesUp }}
                      style={[
                        styles.toggleCompact,
                        { borderColor: c.border },
                        showMinutesUp && { backgroundColor: '#FF950015', borderColor: '#FF9500' },
                      ]}
                      onPress={() => onMinutesUpChange(!showMinutesUp)}
                    >
                      <Ionicons name="trending-up" size={14} color={showMinutesUp ? '#FF9500' : c.secondaryText} />
                      <ThemedText style={[styles.toggleCompactLabel, showMinutesUp && { color: '#FF9500' }]}>
                        Min Up
                      </ThemedText>
                    </TouchableOpacity>
                  )}
                  {hasScheduleData && onAvailableTodayChange && (
                    <TouchableOpacity
                      accessibilityRole="button"
                      accessibilityLabel="Show only players with a game today"
                      accessibilityState={{ selected: showAvailableToday }}
                      style={[
                        styles.toggleCompact,
                        { borderColor: c.border },
                        showAvailableToday && { backgroundColor: '#34C75915', borderColor: '#34C759' },
                      ]}
                      onPress={() => onAvailableTodayChange(!showAvailableToday)}
                    >
                      <Ionicons name="basketball-outline" size={14} color={showAvailableToday ? '#34C759' : c.secondaryText} />
                      <ThemedText style={[styles.toggleCompactLabel, showAvailableToday && { color: '#34C759' }]}>
                        Playing Today
                      </ThemedText>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
              )}

              {/* Time Range section */}
              {onTimeRangeChange && (
                <View style={styles.section}>
                  <ThemedText style={[styles.sectionLabel, { color: c.secondaryText }]}>Time Range</ThemedText>
                  <View style={styles.chipGrid}>
                    {TIME_RANGE_OPTIONS.map(opt => {
                      const active = timeRange === opt.key;
                      return (
                        <TouchableOpacity
                          key={opt.key}
                          accessibilityRole="button"
                          accessibilityLabel={`Time range: ${opt.label}`}
                          accessibilityState={{ selected: active }}
                          style={[
                            styles.chip,
                            { borderColor: c.border },
                            active && { backgroundColor: c.activeCard, borderColor: c.activeBorder },
                          ]}
                          onPress={() => onTimeRangeChange(opt.key)}
                        >
                          <ThemedText
                            style={[
                              styles.chipText,
                              { color: c.secondaryText },
                              active && { color: c.activeText, fontWeight: '600' },
                            ]}
                          >
                            {opt.label}
                          </ThemedText>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              )}

              {/* Position section */}
              <View style={styles.section}>
                <ThemedText style={[styles.sectionLabel, { color: c.secondaryText }]}>Position</ThemedText>
                <View style={styles.chipGrid}>
                  {POSITIONS.map(pos => {
                    const active = selectedPosition === pos;
                    return (
                      <TouchableOpacity
                        key={pos}
                        accessibilityRole="button"
                        accessibilityLabel={`Position: ${pos}`}
                        accessibilityState={{ selected: active }}
                        style={[
                          styles.chip,
                          { borderColor: c.border },
                          active && { backgroundColor: c.activeCard, borderColor: c.activeBorder },
                        ]}
                        onPress={() => onPositionChange(pos)}
                      >
                        <ThemedText
                          style={[
                            styles.chipText,
                            { color: c.secondaryText },
                            active && { color: c.activeText, fontWeight: '600' },
                          ]}
                        >
                          {pos}
                        </ThemedText>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              {/* Sort section */}
              <View style={styles.section}>
                <ThemedText style={[styles.sectionLabel, { color: c.secondaryText }]}>Sort By</ThemedText>
                <View style={styles.chipGrid}>
                  {SORT_OPTIONS.map(opt => {
                    const active = sortBy === opt;
                    return (
                      <TouchableOpacity
                        key={opt}
                        accessibilityRole="button"
                        accessibilityLabel={`Sort by ${opt}`}
                        accessibilityState={{ selected: active }}
                        style={[
                          styles.chip,
                          { borderColor: c.border },
                          active && { backgroundColor: c.activeCard, borderColor: c.activeBorder },
                        ]}
                        onPress={() => onSortChange(opt)}
                      >
                        <ThemedText
                          style={[
                            styles.chipText,
                            { color: c.secondaryText },
                            active && { color: c.activeText, fontWeight: '600' },
                          ]}
                        >
                          {opt}
                        </ThemedText>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            </ScrollView>

            {/* Done button */}
            <TouchableOpacity
              onPress={() => setModalVisible(false)}
              style={[styles.doneBtn, { backgroundColor: c.accent }]}
              accessibilityRole="button"
              accessibilityLabel="Close filters"
            >
              <ThemedText style={styles.doneBtnText}>Done</ThemedText>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 8,
    paddingTop: 8,
    paddingBottom: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  searchInput: {
    flex: 1,
    height: 36,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    fontSize: 14,
  },
  filterBtn: {
    width: 36,
    height: 36,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: -6,
    right: -6,
    backgroundColor: '#FF3B30',
    borderRadius: 8,
    minWidth: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  badgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
    lineHeight: 16,
    textAlign: 'center' as const,
  },
  // Modal
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modal: {
    width: '100%',
    maxHeight: '80%',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 20,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 18,
  },
  resetText: {
    fontSize: 14,
    fontWeight: '500',
  },
  section: {
    marginBottom: 18,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  chipGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
  },
  chipText: {
    fontSize: 13,
  },
  // Quick filter toggles — side by side
  toggleGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  toggleCompact: {
    flexBasis: '47%',
    flexGrow: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  toggleCompactLabel: {
    fontSize: 13,
    fontWeight: '500',
  },
  doneBtn: {
    marginTop: 12,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  doneBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
});
