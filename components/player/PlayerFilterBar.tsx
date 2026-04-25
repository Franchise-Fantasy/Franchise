import { Ionicons } from '@expo/vector-icons';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { ReactNode, useRef, useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { ThemedText } from '@/components/ui/ThemedText';
import { Colors } from '@/constants/Colors';
import { CURRENT_NBA_SEASON } from '@/constants/LeagueDefaults';
import { useColorScheme } from '@/hooks/useColorScheme';
import { InjuryFilter, POSITIONS, SortKey, TimeRange } from '@/hooks/usePlayerFilter';
import { toDateStr } from '@/utils/dates';
import { ms, s } from '@/utils/scale';

const SORT_OPTIONS: SortKey[] = ['FPTS', 'PPG', 'RPG', 'APG', 'SPG', 'BPG', 'MPG', 'FG%', 'FT%', 'TO'];
const INJURY_OPTIONS: { key: InjuryFilter; label: string; icon: string }[] = [
  { key: 'all', label: 'All', icon: 'people-outline' },
  { key: 'healthy', label: 'Active / Probable', icon: 'checkmark-circle-outline' },
  { key: 'injured', label: 'Out / GTD / Doubtful', icon: 'medkit-outline' },
];

// Short label for last season, e.g. "'24-'25" when current season is "2025-26"
const LAST_SEASON_LABEL = (() => {
  const startYear = Number(CURRENT_NBA_SEASON.split('-')[0]);
  const prevStart = String(startYear - 1).slice(-2);
  const prevEnd = String(startYear).slice(-2);
  return `'${prevStart}-'${prevEnd}`;
})();

const TIME_RANGE_OPTIONS: { key: TimeRange; label: string }[] = [
  { key: 'season', label: 'Season' },
  { key: '7d', label: '7D' },
  { key: '14d', label: '14D' },
  { key: '30d', label: '30D' },
  { key: 'lastSeason', label: LAST_SEASON_LABEL },
];

/** Labeled horizontal chip row that surfaces a right-aligned chevron hint only when its content overflows. */
function ChipScrollRow({
  label,
  labelColor,
  chevronColor,
  children,
}: {
  label: string;
  labelColor: string;
  chevronColor: string;
  children: ReactNode;
}) {
  const [overflows, setOverflows] = useState(false);
  const containerWidth = useRef(0);
  const contentWidth = useRef(0);
  // Require a meaningful overflow (≈ at least half a chip hidden) before surfacing the chevron —
  // avoids a flicker hint when content is only clipped by a few pixels.
  const OVERFLOW_THRESHOLD = 24;
  const recomputeOverflow = () => {
    const next = contentWidth.current - containerWidth.current > OVERFLOW_THRESHOLD;
    setOverflows(prev => (prev !== next ? next : prev));
  };
  return (
    <>
      <View style={styles.sectionLabelRow}>
        <ThemedText style={[styles.sectionLabel, { color: labelColor }]}>{label}</ThemedText>
        {overflows && <Ionicons name="chevron-forward" size={12} color={chevronColor} />}
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipRow}
        onLayout={e => {
          containerWidth.current = e.nativeEvent.layout.width;
          recomputeOverflow();
        }}
        onContentSizeChange={w => {
          contentWidth.current = w;
          recomputeOverflow();
        }}
      >
        {children}
      </ScrollView>
    </>
  );
}

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
  /** YYYY-MM-DD string when the "playing on date" filter is active, null when off */
  playingOnDate?: string | null;
  onPlayingOnDateChange?: (date: string | null) => void;
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

function formatGameDateLabel(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (date.getTime() === today.getTime()) return 'Today';
  if (date.getTime() === tomorrow.getTime()) return 'Tomorrow';
  return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
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
  playingOnDate,
  onPlayingOnDateChange,
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
  const [showDatePicker, setShowDatePicker] = useState(false);
  const closeModal = () => {
    setShowDatePicker(false);
    setModalVisible(false);
  };
  const todayStr = toDateStr(new Date());
  const showAvailableToday = playingOnDate === todayStr;
  const isCustomDate = !!playingOnDate && playingOnDate !== todayStr;

  // Count active filters (non-default) — excludes "All Players" toggle which is inline
  const activeFilterCount =
    (selectedPosition !== 'All' ? 1 : 0) +
    (sortBy !== 'FPTS' ? 1 : 0) +
    (showMinutesUp ? 1 : 0) +
    (playingOnDate ? 1 : 0) +
    (timeRange && timeRange !== 'season' ? 1 : 0) +
    (showWatchlistOnly ? 1 : 0) +
    (injuryFilter && injuryFilter !== 'all' ? 1 : 0);

  const resetFilters = () => {
    onPositionChange('All');
    onSortChange('FPTS');
    onMinutesUpChange?.(false);
    onPlayingOnDateChange?.(null);
    onTimeRangeChange?.('season');
    onWatchlistOnlyChange?.(false);
    onFreeAgentsOnlyChange?.(true);
    onInjuryFilterChange?.('all');
  };

  const pickerInitialDate = (() => {
    const src = playingOnDate ?? todayStr;
    const [y, m, d] = src.split('-').map(Number);
    return new Date(y, m - 1, d);
  })();

  // Android: system dialog auto-dismisses and passes the selected date in a single event.
  // iOS: picker is inline inside our overlay modal — commit on "Done" tap instead.
  const handleDatePicked = (event: DateTimePickerEvent, date?: Date) => {
    if (Platform.OS === 'android') {
      setShowDatePicker(false);
      if (event.type === 'dismissed' || !date) return;
      date.setHours(0, 0, 0, 0);
      onPlayingOnDateChange?.(toDateStr(date));
      return;
    }
    // iOS: stash the in-flight selection; user confirms via Done
    if (date) {
      date.setHours(0, 0, 0, 0);
      setIosPendingDate(date);
    }
  };

  const [iosPendingDate, setIosPendingDate] = useState<Date | null>(null);
  const confirmIosDate = () => {
    const picked = iosPendingDate ?? pickerInitialDate;
    onPlayingOnDateChange?.(toDateStr(picked));
    setIosPendingDate(null);
    setShowDatePicker(false);
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
        onRequestClose={() => closeModal()}
      >
        <View style={styles.backdrop}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => closeModal()}
            accessibilityRole="button"
            accessibilityLabel="Close filters"
          />
          <View style={[styles.modal, { backgroundColor: c.card, borderColor: c.border }]}>
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
                <ThemedText style={[styles.sectionLabel, { color: c.secondaryText, marginBottom: s(8) }]}>Quick Filters</ThemedText>
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
                      accessibilityLabel="Show players with rising minutes over the last 5 games"
                      accessibilityState={{ selected: showMinutesUp }}
                      style={[
                        styles.toggleCompact,
                        styles.toggleCompactStacked,
                        { borderColor: c.border },
                        showMinutesUp && { backgroundColor: c.warningMuted, borderColor: c.warning },
                      ]}
                      onPress={() => onMinutesUpChange(!showMinutesUp)}
                    >
                      <View style={styles.toggleCompactRow}>
                        <Ionicons name="trending-up" size={14} color={showMinutesUp ? c.warning : c.secondaryText} />
                        <ThemedText style={[styles.toggleCompactLabel, showMinutesUp && { color: c.warning }]}>
                          Minutes Rising
                        </ThemedText>
                      </View>
                      <ThemedText style={[styles.toggleCompactSubLabel, { color: c.secondaryText }]}>
                        Last 5 games
                      </ThemedText>
                    </TouchableOpacity>
                  )}
                  {hasScheduleData && onPlayingOnDateChange && (
                    <>
                      <TouchableOpacity
                        accessibilityRole="button"
                        accessibilityLabel="Show only players with a game today"
                        accessibilityState={{ selected: showAvailableToday }}
                        style={[
                          styles.toggleHalf,
                          { borderColor: c.border },
                          showAvailableToday && { backgroundColor: c.successMuted, borderColor: c.success },
                        ]}
                        onPress={() => onPlayingOnDateChange(showAvailableToday ? null : todayStr)}
                      >
                        <Ionicons name="basketball-outline" size={14} color={showAvailableToday ? c.success : c.secondaryText} />
                        <ThemedText style={[styles.toggleCompactLabel, showAvailableToday && { color: c.success }]} numberOfLines={1}>
                          Today
                        </ThemedText>
                      </TouchableOpacity>
                      <TouchableOpacity
                        accessibilityRole="button"
                        accessibilityLabel={isCustomDate ? `Game date: ${formatGameDateLabel(playingOnDate!)}. Tap to change.` : 'Pick a game date'}
                        onPress={() => setShowDatePicker(true)}
                        style={[
                          styles.toggleHalf,
                          { borderColor: c.border },
                          isCustomDate && { backgroundColor: c.successMuted, borderColor: c.success },
                        ]}
                      >
                        <Ionicons name="calendar-outline" size={14} color={isCustomDate ? c.success : c.secondaryText} />
                        <ThemedText style={[styles.toggleCompactLabel, isCustomDate && { color: c.success }]} numberOfLines={1}>
                          {isCustomDate ? formatGameDateLabel(playingOnDate!) : 'Pick date'}
                        </ThemedText>
                      </TouchableOpacity>
                    </>
                  )}
                </View>
              </View>
              )}

              {/* Injury Status section */}
              {onInjuryFilterChange && (
                <View style={styles.section}>
                  <ChipScrollRow label="Injury Status" labelColor={c.secondaryText} chevronColor={c.secondaryText}>
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
                  </ChipScrollRow>
                </View>
              )}

              {/* Time Range section */}
              {onTimeRangeChange && (
                <View style={styles.section}>
                  <ChipScrollRow label="Time Range" labelColor={c.secondaryText} chevronColor={c.secondaryText}>
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
                  </ChipScrollRow>
                </View>
              )}

              {/* Position section */}
              <View style={styles.section}>
                <ChipScrollRow label="Position" labelColor={c.secondaryText} chevronColor={c.secondaryText}>
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
                </ChipScrollRow>
              </View>

              {/* Sort section */}
              <View style={styles.section}>
                <ChipScrollRow label="Sort By" labelColor={c.secondaryText} chevronColor={c.secondaryText}>
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
                </ChipScrollRow>
              </View>
            </ScrollView>

            {/* Done button */}
            <TouchableOpacity
              onPress={() => closeModal()}
              style={[styles.doneBtn, { backgroundColor: c.accent }]}
              accessibilityRole="button"
              accessibilityLabel="Close filters"
            >
              <ThemedText style={[styles.doneBtnText, { color: c.statusText }]}>Done</ThemedText>
            </TouchableOpacity>
          </View>

          {/* Date picker overlay — rendered inside the same Modal to avoid nested-Modal bugs.
              Android uses the system dialog (mounted conditionally); everything else uses an inline overlay sheet. */}
          {showDatePicker && Platform.OS === 'android' && (
            <DateTimePicker
              value={pickerInitialDate}
              mode="date"
              display="default"
              onChange={handleDatePicked}
            />
          )}
          {showDatePicker && Platform.OS !== 'android' && (
            <View style={[StyleSheet.absoluteFill, styles.iosPickerOverlay]}>
              <Pressable
                style={StyleSheet.absoluteFill}
                onPress={() => {
                  setIosPendingDate(null);
                  setShowDatePicker(false);
                }}
                accessibilityLabel="Dismiss date picker"
              />
              <View style={[styles.iosPickerSheet, { backgroundColor: c.card, borderTopColor: c.border }]}>
                <View style={styles.iosPickerBar}>
                  <TouchableOpacity
                    onPress={() => {
                      setIosPendingDate(null);
                      setShowDatePicker(false);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel="Cancel"
                    hitSlop={8}
                  >
                    <ThemedText style={[styles.iosPickerBtn, { color: c.secondaryText }]}>Cancel</ThemedText>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={confirmIosDate}
                    accessibilityRole="button"
                    accessibilityLabel="Confirm date"
                    hitSlop={8}
                  >
                    <ThemedText style={[styles.iosPickerBtn, { color: c.accent }]}>Done</ThemedText>
                  </TouchableOpacity>
                </View>
                <DateTimePicker
                  value={iosPendingDate ?? pickerInitialDate}
                  mode="date"
                  display="inline"
                  onChange={handleDatePicked}
                  themeVariant={scheme}
                />
              </View>
            </View>
          )}
        </View>
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
  },
  // Label + chevron row — chevron (when present) is pushed to the right to hint at horizontal overflow
  sectionLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: s(8),
  },
  chipGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: s(6),
  },
  // Single-line horizontal scroll row for chip groups
  chipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(5),
    paddingRight: s(8),
  },
  chip: {
    paddingHorizontal: s(10),
    paddingVertical: s(5),
    borderRadius: 14,
    borderWidth: 1,
  },
  chipText: {
    fontSize: ms(12),
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
    borderRadius: 10,
    borderWidth: 1,
    height: s(48),
  },
  toggleCompactLabel: {
    fontSize: ms(13),
    fontWeight: '500',
  },
  // Two-line variant used by the "Minutes Rising" pill — padding/gap tuned to fit the
  // 48px fixed pill height along with the other single-line pills
  toggleCompactStacked: {
    flexDirection: 'column',
    gap: 0,
  },
  toggleCompactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(6),
  },
  toggleCompactSubLabel: {
    fontSize: ms(10),
    lineHeight: ms(13),
    fontWeight: '400',
  },
  // Half-width quick-filter pill — Playing Today and Pick Date sit side-by-side in one slot
  toggleHalf: {
    flexBasis: '22%',
    flexGrow: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: s(4),
    paddingHorizontal: s(6),
    borderRadius: 10,
    borderWidth: 1,
    height: s(48),
  },
  iosPickerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  iosPickerSheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: s(16),
    paddingTop: s(8),
    paddingBottom: s(20),
    alignItems: 'center',
  },
  iosPickerBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    alignSelf: 'stretch',
    paddingVertical: s(8),
  },
  iosPickerBtn: {
    fontSize: ms(15),
    fontWeight: '600',
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
