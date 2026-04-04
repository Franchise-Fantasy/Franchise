import { ThemedText } from '@/components/ui/ThemedText';
import { Colors } from '@/constants/Colors';
import { ms, s } from '@/utils/scale';
import { InjuryFilter, POSITIONS, SortKey, TimeRange } from '@/hooks/usePlayerFilter';
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
const INJURY_OPTIONS: { key: InjuryFilter; label: string; icon: string }[] = [
  { key: 'all', label: 'All', icon: 'people-outline' },
  { key: 'healthy', label: 'Active / Probable', icon: 'checkmark-circle-outline' },
  { key: 'injured', label: 'Out / GTD / Doubtful', icon: 'medkit-outline' },
];

const TIME_RANGE_OPTIONS: { key: TimeRange; label: string }[] = [
  { key: 'season', label: 'Season' },
  { key: '7d', label: '7D' },
  { key: '14d', label: '14D' },
  { key: '30d', label: '30D' },
  { key: 'lastSeason', label: "Last Season" },
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
  injuryFilter?: InjuryFilter;
  onInjuryFilterChange?: (filter: InjuryFilter) => void;
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
  injuryFilter,
  onInjuryFilterChange,
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
    (showWatchlistOnly ? 1 : 0) +
    (injuryFilter && injuryFilter !== 'all' ? 1 : 0);

  const resetFilters = () => {
    onPositionChange('All');
    onSortChange('FPTS');
    onMinutesUpChange?.(false);
    onAvailableTodayChange?.(false);
    onTimeRangeChange?.('season');
    onWatchlistOnlyChange?.(false);
    onFreeAgentsOnlyChange?.(true);
    onInjuryFilterChange?.('all');
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
              !showFreeAgentsOnly && { backgroundColor: c.link + '15', borderColor: c.link },
            ]}
            accessibilityRole="button"
            accessibilityLabel={showFreeAgentsOnly ? 'Show all players' : 'Show free agents only'}
            hitSlop={4}
          >
            <Ionicons name="people" size={18} color={!showFreeAgentsOnly ? c.link : c.secondaryText} />
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
            <View style={[styles.badge, { backgroundColor: c.danger }]}>
              <Text style={[styles.badgeText, { color: c.statusText }]}>{activeFilterCount}</Text>
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
                        showWatchlistOnly && { backgroundColor: c.link + '15', borderColor: c.link },
                      ]}
                      onPress={() => onWatchlistOnlyChange(!showWatchlistOnly)}
                    >
                      <Ionicons name={showWatchlistOnly ? 'eye' : 'eye-outline'} size={14} color={showWatchlistOnly ? c.link : c.secondaryText} />
                      <ThemedText style={[styles.toggleCompactLabel, showWatchlistOnly && { color: c.link }]}>
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
                        showMinutesUp && { backgroundColor: c.warningMuted, borderColor: c.warning },
                      ]}
                      onPress={() => onMinutesUpChange(!showMinutesUp)}
                    >
                      <Ionicons name="trending-up" size={14} color={showMinutesUp ? c.warning : c.secondaryText} />
                      <ThemedText style={[styles.toggleCompactLabel, showMinutesUp && { color: c.warning }]}>
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
                        showAvailableToday && { backgroundColor: c.successMuted, borderColor: c.success },
                      ]}
                      onPress={() => onAvailableTodayChange(!showAvailableToday)}
                    >
                      <Ionicons name="basketball-outline" size={14} color={showAvailableToday ? c.success : c.secondaryText} />
                      <ThemedText style={[styles.toggleCompactLabel, showAvailableToday && { color: c.success }]}>
                        Playing Today
                      </ThemedText>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
              )}

              {/* Injury Status section */}
              {onInjuryFilterChange && (
                <View style={styles.section}>
                  <ThemedText style={[styles.sectionLabel, { color: c.secondaryText }]}>Injury Status</ThemedText>
                  <View style={styles.chipGrid}>
                    {INJURY_OPTIONS.map(opt => {
                      const active = injuryFilter === opt.key;
                      return (
                        <TouchableOpacity
                          key={opt.key}
                          accessibilityRole="button"
                          accessibilityLabel={`Injury filter: ${opt.label}`}
                          accessibilityState={{ selected: active }}
                          style={[
                            styles.chip,
                            { borderColor: c.border, flexDirection: 'row', alignItems: 'center' },
                            active && { backgroundColor: c.activeCard, borderColor: c.activeBorder },
                          ]}
                          onPress={() => onInjuryFilterChange(opt.key)}
                        >
                          <Ionicons
                            name={opt.icon as any}
                            size={14}
                            color={active ? c.activeText : c.secondaryText}
                            style={{ marginRight: 4 }}
                          />
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
              <ThemedText style={[styles.doneBtnText, { color: c.statusText }]}>Done</ThemedText>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: s(8),
    paddingTop: s(8),
    paddingBottom: s(6),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(8),
  },
  searchInput: {
    flex: 1,
    height: s(36),
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: s(12),
    fontSize: ms(14),
  },
  filterBtn: {
    width: s(36),
    height: s(36),
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: s(-6),
    right: s(-6),
    borderRadius: 8,
    minWidth: s(16),
    height: s(16),
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: s(4),
  },
  badgeText: {
    fontSize: ms(10),
    fontWeight: '700',
    lineHeight: ms(16),
    textAlign: 'center' as const,
  },
  // Modal
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: s(24),
  },
  modal: {
    width: '100%',
    maxHeight: '80%',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: s(20),
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: s(16),
  },
  modalTitle: {
    fontSize: ms(18),
  },
  resetText: {
    fontSize: ms(14),
    fontWeight: '500',
  },
  section: {
    marginBottom: s(18),
  },
  sectionLabel: {
    fontSize: ms(12),
    fontWeight: '600',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: s(8),
  },
  chipGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: s(6),
  },
  chip: {
    paddingHorizontal: s(12),
    paddingVertical: s(6),
    borderRadius: 16,
    borderWidth: 1,
  },
  chipText: {
    fontSize: ms(13),
  },
  // Quick filter toggles — side by side
  toggleGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: s(8),
  },
  toggleCompact: {
    flexBasis: '47%',
    flexGrow: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: s(6),
    paddingVertical: s(10),
    borderRadius: 10,
    borderWidth: 1,
  },
  toggleCompactLabel: {
    fontSize: ms(13),
    fontWeight: '500',
  },
  doneBtn: {
    marginTop: s(12),
    paddingVertical: s(12),
    borderRadius: 10,
    alignItems: 'center',
  },
  doneBtnText: {
    fontSize: ms(15),
    fontWeight: '600',
  },
});
