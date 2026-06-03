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
import { getCurrentSeason, parseSeasonStartYear, type Sport } from '@/constants/LeagueDefaults';
import { useActiveLeagueSport } from '@/hooks/useActiveLeagueSport';
import { useColors } from '@/hooks/useColors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { getPositionFilters, InjuryFilter, SortKey, TimeRange } from '@/hooks/usePlayerFilter';
import { toDateStr } from '@/utils/dates';
import { getSportToday } from '@/utils/leagueTime';
import { ms, s } from '@/utils/scale';

const SORT_OPTIONS: SortKey[] = ['FPTS', 'PPG', 'RPG', 'APG', 'SPG', 'BPG', 'MPG', 'FG%', 'FT%', 'TO'];
const INJURY_OPTIONS: { key: InjuryFilter; label: string; icon: string }[] = [
  { key: 'all', label: 'All', icon: 'people-outline' },
  { key: 'healthy', label: 'Active / Probable', icon: 'checkmark-circle-outline' },
  { key: 'injured', label: 'Out / GTD / Doubtful', icon: 'medkit-outline' },
];

// Short label for the prior season — sport-aware. NBA: "'24-'25" (two-year
// span); WNBA: "'25" (single year).
function lastSeasonLabel(sport: Sport): string {
  const startYear = parseSeasonStartYear(getCurrentSeason(sport));
  const prevStart = String(startYear - 1).slice(-2);
  if (sport === 'wnba') return `'${prevStart}`;
  const prevEnd = String(startYear).slice(-2);
  return `'${prevStart}-'${prevEnd}`;
}

/** Labeled horizontal chip row that surfaces a right-aligned chevron hint only when its content overflows. */
function ChipScrollRow({
  label,
  goldColor,
  chevronColor,
  children,
}: {
  label: string;
  goldColor: string;
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
        <View style={[styles.sectionRule, { backgroundColor: goldColor }]} />
        <ThemedText
          type="varsitySmall"
          style={[styles.sectionLabel, { color: goldColor }]}
        >
          {label.toUpperCase()}
        </ThemedText>
        {overflows && (
          <Ionicons
            name="chevron-forward"
            size={12}
            color={chevronColor}
            style={{ marginLeft: 'auto' }}
          />
        )}
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
  /** Pro team tricodes (sorted alphabetically) available as filter chips; omit to hide the section */
  availableProTeams?: string[];
  selectedProTeam?: string;
  onProTeamChange?: (team: string) => void;
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
  showRookiesOnly?: boolean;
  onRookiesOnlyChange?: (show: boolean) => void;
  showFreeAgentsOnly?: boolean;
  onFreeAgentsOnlyChange?: (show: boolean) => void;
  hasRosteredData?: boolean;
  injuryFilter?: InjuryFilter;
  onInjuryFilterChange?: (filter: InjuryFilter) => void;
  /** Categories leagues have no fantasy points — hides the FPTS sort option */
  isCategories?: boolean;
}

/** Default sort key per scoring type — categories leagues can't sort by FPTS. */
function defaultSortKey(isCategories?: boolean): SortKey {
  return isCategories ? 'PPG' : 'FPTS';
}

/** Number of filters in non-default state — drives the header pip. */
export function countActiveFilters(args: {
  selectedPosition: string;
  selectedProTeam?: string;
  sortBy: string;
  showMinutesUp?: boolean;
  playingOnDate?: string | null;
  timeRange?: TimeRange;
  showWatchlistOnly?: boolean;
  showRookiesOnly?: boolean;
  injuryFilter?: InjuryFilter;
  isCategories?: boolean;
}): number {
  return (
    (args.selectedPosition !== 'All' ? 1 : 0) +
    (args.selectedProTeam && args.selectedProTeam !== 'All' ? 1 : 0) +
    (args.sortBy !== defaultSortKey(args.isCategories) ? 1 : 0) +
    (args.showMinutesUp ? 1 : 0) +
    (args.playingOnDate ? 1 : 0) +
    (args.timeRange && args.timeRange !== 'season' ? 1 : 0) +
    (args.showWatchlistOnly ? 1 : 0) +
    (args.showRookiesOnly ? 1 : 0) +
    (args.injuryFilter && args.injuryFilter !== 'all' ? 1 : 0)
  );
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
  availableProTeams,
  selectedProTeam,
  onProTeamChange,
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
  showRookiesOnly,
  onRookiesOnlyChange,
  showFreeAgentsOnly,
  onFreeAgentsOnlyChange,
  hasRosteredData,
  injuryFilter,
  onInjuryFilterChange,
  isCategories,
}: PlayerFilterBarProps) {
  const c = useColors();
  const scheme = useColorScheme() ?? 'light';
  const sport = useActiveLeagueSport();
  // Categories leagues have no fantasy points — drop FPTS from the sort chips.
  const sortOptions = isCategories ? SORT_OPTIONS.filter(o => o !== 'FPTS') : SORT_OPTIONS;
  const TIME_RANGE_OPTIONS: { key: TimeRange; label: string }[] = [
    { key: 'season', label: 'Season' },
    { key: '7d', label: '7D' },
    { key: '14d', label: '14D' },
    { key: '30d', label: '30D' },
    { key: 'lastSeason', label: lastSeasonLabel(sport) },
  ];
  const [modalVisible, setModalVisible] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const closeModal = () => {
    setShowDatePicker(false);
    setModalVisible(false);
  };
  const todayStr = getSportToday(sport);
  const showAvailableToday = playingOnDate === todayStr;
  const isCustomDate = !!playingOnDate && playingOnDate !== todayStr;

  const activeFilterCount = countActiveFilters({
    selectedPosition,
    selectedProTeam,
    sortBy,
    showMinutesUp,
    playingOnDate,
    timeRange,
    showWatchlistOnly,
    showRookiesOnly,
    injuryFilter,
    isCategories,
  });

  const resetFilters = () => {
    onPositionChange('All');
    onProTeamChange?.('All');
    onSortChange(defaultSortKey(isCategories));
    onMinutesUpChange?.(false);
    onPlayingOnDateChange?.(null);
    onTimeRangeChange?.('season');
    onWatchlistOnlyChange?.(false);
    onRookiesOnlyChange?.(false);
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
    <View style={[styles.container, { backgroundColor: c.background, borderBottomColor: c.border }]}>
      <View style={styles.searchRow}>
        <View
          style={[
            styles.searchField,
            { backgroundColor: c.input, borderColor: c.border },
          ]}
        >
          <Ionicons
            name="search"
            size={16}
            color={c.secondaryText}
            style={styles.searchFieldIcon}
            accessible={false}
          />
          <TextInput
            accessibilityLabel="Search players"
            style={[styles.searchFieldInput, { color: c.text }]}
            placeholder="Search players..."
            placeholderTextColor={c.secondaryText}
            value={searchText}
            onChangeText={onSearchChange}
            autoCorrect={false}
            returnKeyType="search"
          />
          <TouchableOpacity
            onPress={() => setModalVisible(true)}
            style={styles.searchFieldFilterBtn}
            accessibilityRole="button"
            accessibilityLabel={`Filters${activeFilterCount > 0 ? `, ${activeFilterCount} active` : ''}`}
            hitSlop={6}
          >
            <Ionicons
              name="options-outline"
              size={18}
              color={activeFilterCount > 0 ? c.gold : c.secondaryText}
              accessible={false}
            />
            {activeFilterCount > 0 && (
              <View style={[styles.badge, { backgroundColor: c.danger }]}>
                <Text style={[styles.badgeText, { color: c.statusText }]}>{activeFilterCount}</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>
        {onFreeAgentsOnlyChange && (
          <TouchableOpacity
            onPress={() => onFreeAgentsOnlyChange(!showFreeAgentsOnly)}
            style={[
              styles.filterBtn,
              { backgroundColor: c.input, borderColor: c.border },
              !showFreeAgentsOnly && { backgroundColor: c.gold + '20', borderColor: c.gold },
            ]}
            accessibilityRole="button"
            accessibilityLabel={showFreeAgentsOnly ? 'Show all players' : 'Show free agents only'}
            hitSlop={4}
          >
            <Ionicons name="people" size={18} color={!showFreeAgentsOnly ? c.gold : c.secondaryText} />
          </TouchableOpacity>
        )}
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
            <View style={styles.modalHeader}>
              <TouchableOpacity
                onPress={() => closeModal()}
                accessibilityRole="button"
                accessibilityLabel="Close filters"
                hitSlop={8}
              >
                <Ionicons name="close" size={22} color={c.secondaryText} />
              </TouchableOpacity>
              {activeFilterCount > 0 && (
                <TouchableOpacity
                  onPress={resetFilters}
                  accessibilityRole="button"
                  accessibilityLabel="Reset all filters"
                  hitSlop={8}
                >
                  <ThemedText
                    type="varsitySmall"
                    style={[styles.resetText, { color: c.gold }]}
                  >
                    Reset
                  </ThemedText>
                </TouchableOpacity>
              )}
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              {/* Quick Filters */}
              {(onWatchlistOnlyChange || onRookiesOnlyChange || hasMinutesData || hasScheduleData) && (
              <View style={styles.section}>
                <View style={styles.sectionLabelRow}>
                  <View style={[styles.sectionRule, { backgroundColor: c.gold }]} />
                  <ThemedText
                    type="varsitySmall"
                    style={[styles.sectionLabel, { color: c.gold }]}
                  >
                    QUICK FILTERS
                  </ThemedText>
                </View>
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
                  {onRookiesOnlyChange && (
                    <TouchableOpacity
                      accessibilityRole="button"
                      accessibilityLabel="Show only rookies"
                      accessibilityState={{ selected: showRookiesOnly }}
                      style={[
                        styles.toggleCompact,
                        { borderColor: c.border },
                        showRookiesOnly && { backgroundColor: c.gold + '20', borderColor: c.gold },
                      ]}
                      onPress={() => onRookiesOnlyChange(!showRookiesOnly)}
                    >
                      <Ionicons name={showRookiesOnly ? 'sparkles' : 'sparkles-outline'} size={14} color={showRookiesOnly ? c.gold : c.secondaryText} />
                      <ThemedText style={[styles.toggleCompactLabel, showRookiesOnly && { color: c.gold }]}>
                        Rookies
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
                          {isCustomDate ? formatGameDateLabel(playingOnDate!) : 'Date'}
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
                  <ChipScrollRow label="Injury Status" goldColor={c.gold} chevronColor={c.secondaryText}>
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
                  <ChipScrollRow label="Time Range" goldColor={c.gold} chevronColor={c.secondaryText}>
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
                <ChipScrollRow label="Position" goldColor={c.gold} chevronColor={c.secondaryText}>
                  {getPositionFilters(sport).map(pos => {
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

              {/* Pro Team section — alphabetical tricodes derived from the loaded player pool */}
              {availableProTeams && availableProTeams.length > 0 && onProTeamChange && (
                <View style={styles.section}>
                  <ChipScrollRow label="Pro Team" goldColor={c.gold} chevronColor={c.secondaryText}>
                    {['All', ...availableProTeams].map(team => {
                      const active = (selectedProTeam ?? 'All') === team;
                      return (
                        <TouchableOpacity
                          key={team}
                          accessibilityRole="button"
                          accessibilityLabel={`Pro team: ${team}`}
                          accessibilityState={{ selected: active }}
                          style={[
                            styles.chip,
                            { borderColor: c.border },
                            active && { backgroundColor: c.activeCard, borderColor: c.activeBorder },
                          ]}
                          onPress={() => onProTeamChange(team)}
                        >
                          <ThemedText
                            style={[
                              styles.chipText,
                              { color: c.secondaryText },
                              active && { color: c.activeText, fontWeight: '600' },
                            ]}
                          >
                            {team}
                          </ThemedText>
                        </TouchableOpacity>
                      );
                    })}
                  </ChipScrollRow>
                </View>
              )}

              {/* Sort section */}
              <View style={styles.section}>
                <ChipScrollRow label="Sort By" goldColor={c.gold} chevronColor={c.secondaryText}>
                  {sortOptions.map(opt => {
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
  searchField: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    height: s(36),
    borderRadius: 8,
    borderWidth: 1,
    paddingLeft: s(10),
    paddingRight: s(4),
  },
  searchFieldIcon: {
    marginRight: s(6),
  },
  searchFieldInput: {
    flex: 1,
    fontSize: ms(14),
    paddingVertical: 0,
  },
  searchFieldFilterBtn: {
    width: s(28),
    height: s(28),
    alignItems: 'center',
    justifyContent: 'center',
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
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginBottom: s(18),
  },
  modalTitleCol: {
    gap: s(6),
  },
  modalEyebrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(8),
  },
  modalRule: {
    height: 2,
    width: s(14),
  },
  modalEyebrow: {
    fontSize: ms(10),
    letterSpacing: 1.4,
  },
  modalTitle: {
    fontSize: ms(24),
    letterSpacing: -0.3,
  },
  resetText: {
    fontSize: ms(11),
    letterSpacing: 1.2,
  },
  section: {
    marginBottom: s(18),
  },
  sectionRule: {
    height: 2,
    width: s(14),
  },
  sectionLabel: {
    fontSize: ms(10),
    letterSpacing: 1.4,
  },
  // Label + chevron row — chevron (when present) is pushed to the right to hint at horizontal overflow
  sectionLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(8),
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
