import { Ionicons } from '@expo/vector-icons';
import { useMemo, useRef, useState } from 'react';
import { FlatList, StyleSheet, TouchableOpacity, View } from 'react-native';

import { ArchiveTeamLogo } from '@/components/playoff-archive/ArchiveTeamLogo';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { ThemedText } from '@/components/ui/ThemedText';
import type { ArchiveSeasonRow } from '@/hooks/useArchivePlayoffs';
import { useArchiveColors } from '@/hooks/useArchiveColors';
import { ms, s } from '@/utils/scale';

interface Props {
  seasons: ArchiveSeasonRow[];
  selected: number | null;
  onSelect: (season: number) => void;
}

// "2024–25" for season=2025.
function seasonLabel(season: number): string {
  const endTwoDigit = String(season % 100).padStart(2, '0');
  return `${season - 1}–${endTwoDigit}`;
}

const ROW_HEIGHT = s(56);

// Header season pill with prev/next arrows. Tapping the label opens the
// BottomSheet picker (which auto-scrolls to the selected season and shows
// the champion in each row). Arrows step through seasons one at a time so
// the user doesn't have to open the sheet for adjacent years — useful when
// browsing surrounding seasons after looking at a specific bracket.
export function SeasonDropdown({ seasons, selected, onSelect }: Props) {
  const c = useArchiveColors();
  const [open, setOpen] = useState(false);

  const hasMany = seasons.length > 1;
  const selectedIdx = useMemo(
    () => (selected == null ? -1 : seasons.findIndex((s) => s.season === selected)),
    [seasons, selected],
  );

  const label = selected != null ? seasonLabel(selected) : '—';

  // seasons is ordered DESC (newest first), so "prev season" (older) is
  // selectedIdx + 1, "next season" (newer) is selectedIdx - 1. Disable each
  // arrow at the appropriate edge.
  const goNewer = () => {
    if (selectedIdx > 0) onSelect(seasons[selectedIdx - 1].season);
  };
  const goOlder = () => {
    if (selectedIdx >= 0 && selectedIdx < seasons.length - 1) {
      onSelect(seasons[selectedIdx + 1].season);
    }
  };
  const canGoNewer = selectedIdx > 0;
  const canGoOlder = selectedIdx >= 0 && selectedIdx < seasons.length - 1;

  return (
    <>
      <View style={styles.pillRow}>
        <TouchableOpacity
          onPress={goOlder}
          disabled={!canGoOlder}
          activeOpacity={0.5}
          accessibilityRole="button"
          accessibilityLabel="Previous season"
          accessibilityState={{ disabled: !canGoOlder }}
          hitSlop={8}
          style={[
            styles.arrowBtn,
            { backgroundColor: c.cardAlt, borderColor: c.border },
            !canGoOlder && styles.arrowBtnDisabled,
          ]}
        >
          <Ionicons
            name="chevron-back"
            size={ms(20)}
            color={canGoOlder ? c.text : c.secondaryText}
            accessible={false}
          />
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => hasMany && setOpen(true)}
          disabled={!hasMany}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={`Season: ${label}${hasMany ? '. Tap to switch.' : ''}`}
          accessibilityState={{ disabled: !hasMany }}
          hitSlop={8}
          style={styles.titleHit}
        >
          <ThemedText
            type="varsity"
            style={[styles.label, { color: c.text }]}
            numberOfLines={1}
          >
            {label}
          </ThemedText>
          {hasMany && (
            <Ionicons
              name="chevron-down"
              size={ms(12)}
              color={c.secondaryText}
              accessible={false}
              style={styles.dropIndicator}
            />
          )}
        </TouchableOpacity>

        <TouchableOpacity
          onPress={goNewer}
          disabled={!canGoNewer}
          activeOpacity={0.5}
          accessibilityRole="button"
          accessibilityLabel="Next season"
          accessibilityState={{ disabled: !canGoNewer }}
          hitSlop={8}
          style={[
            styles.arrowBtn,
            { backgroundColor: c.cardAlt, borderColor: c.border },
            !canGoNewer && styles.arrowBtnDisabled,
          ]}
        >
          <Ionicons
            name="chevron-forward"
            size={ms(20)}
            color={canGoNewer ? c.text : c.secondaryText}
            accessible={false}
          />
        </TouchableOpacity>
      </View>

      <SeasonPickerSheet
        visible={open}
        seasons={seasons}
        selected={selected}
        selectedIdx={selectedIdx}
        onClose={() => setOpen(false)}
        onSelect={(season) => {
          onSelect(season);
          setOpen(false);
        }}
      />
    </>
  );
}

interface SheetProps {
  visible: boolean;
  seasons: ArchiveSeasonRow[];
  selected: number | null;
  selectedIdx: number;
  onClose: () => void;
  onSelect: (season: number) => void;
}

// Pulled out into its own component so the FlatList ref can survive open/close
// cycles without remount. `initialScrollIndex` is honored on first mount, so
// re-opening the sheet auto-positions the user at the currently-selected row.
function SeasonPickerSheet({
  visible,
  seasons,
  selected,
  selectedIdx,
  onClose,
  onSelect,
}: SheetProps) {
  const listRef = useRef<FlatList<ArchiveSeasonRow>>(null);

  // When the user reopens the sheet after picking via arrows, the list
  // is no longer at the right offset. Scroll back to the selected row.
  const handleListLayout = () => {
    if (selectedIdx >= 0) {
      listRef.current?.scrollToIndex({
        index: selectedIdx,
        animated: false,
        viewPosition: 0.4,
      });
    }
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Season"
      subtitle={`${seasons.length} SEASONS · TAP TO JUMP`}
      height="70%"
      scrollableBody={false}
    >
      <FlatList
        ref={listRef}
        data={seasons}
        keyExtractor={(item) => String(item.season)}
        getItemLayout={(_, idx) => ({
          length: ROW_HEIGHT,
          offset: ROW_HEIGHT * idx,
          index: idx,
        })}
        initialScrollIndex={selectedIdx > 0 ? selectedIdx : 0}
        onLayout={handleListLayout}
        onScrollToIndexFailed={(info) => {
          // FlatList can't measure rows that aren't yet rendered. Retry
          // after the requested index has had a frame to render.
          setTimeout(() => {
            listRef.current?.scrollToIndex({
              index: info.index,
              animated: false,
              viewPosition: 0.4,
            });
          }, 50);
        }}
        showsVerticalScrollIndicator={false}
        renderItem={({ item }) => (
          <SeasonRow
            row={item}
            isSelected={item.season === selected}
            onPress={() => onSelect(item.season)}
          />
        )}
      />
    </BottomSheet>
  );
}

function SeasonRow({
  row,
  isSelected,
  onPress,
}: {
  row: ArchiveSeasonRow;
  isSelected: boolean;
  onPress: () => void;
}) {
  const c = useArchiveColors();
  const championLine = row.champion_tricode
    ? `${row.champion_city ?? ''} ${row.champion_name ?? ''}`.trim() || row.champion_tricode
    : 'Champion: —';

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.65}
      accessibilityRole="button"
      accessibilityState={{ selected: isSelected }}
      accessibilityLabel={`Season ${seasonLabel(row.season)}, champion ${row.champion_tricode ?? 'unknown'}`}
      style={[
        styles.row,
        { borderBottomColor: c.border, height: ROW_HEIGHT },
        isSelected && { backgroundColor: c.goldMuted },
      ]}
    >
      <ThemedText
        type="display"
        style={[styles.rowLabel, { color: isSelected ? c.gold : c.text }]}
      >
        {seasonLabel(row.season)}
      </ThemedText>

      <View style={styles.rowChampion}>
        {row.champion_franchise_id && row.champion_tricode ? (
          <ArchiveTeamLogo
            franchiseId={row.champion_franchise_id}
            tricode={row.champion_tricode}
            primaryColor={row.champion_primary_color}
            secondaryColor={row.champion_secondary_color}
            logoKey={row.champion_logo_key}
            size={s(22)}
          />
        ) : null}
        <ThemedText
          type="varsitySmall"
          style={[styles.rowChampionLabel, { color: c.secondaryText }]}
          numberOfLines={1}
        >
          {championLine}
        </ThemedText>
      </View>

      {isSelected && (
        <Ionicons
          name="checkmark-circle"
          size={ms(18)}
          color={c.gold}
          accessible={false}
        />
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  pillRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(8),
  },
  // Pill-shaped chevron buttons — bordered + filled so they read as proper
  // affordances instead of naked icons. hitSlop on the TouchableOpacity
  // makes the actual touch area larger than the visual.
  arrowBtn: {
    width: s(32),
    height: s(32),
    borderRadius: 6,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  arrowBtnDisabled: {
    opacity: 0.35,
  },
  titleHit: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(4),
    paddingHorizontal: s(4),
    paddingVertical: s(4),
  },
  label: {
    fontSize: ms(14),
    letterSpacing: 1,
  },
  dropIndicator: {
    marginTop: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: s(4),
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: s(10),
  },
  rowLabel: {
    fontSize: ms(16),
    letterSpacing: -0.2,
    minWidth: s(78),
  },
  rowChampion: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(8),
    minWidth: 0,
  },
  rowChampionLabel: {
    flex: 1,
    fontSize: ms(11),
    letterSpacing: 0.6,
    minWidth: 0,
  },
});
