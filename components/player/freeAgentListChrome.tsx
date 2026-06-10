import { type ComponentProps } from 'react';
import { View } from 'react-native';

import { PlayerFilterBar } from '@/components/player/PlayerFilterBar';
import { RosterNeedsStrip } from '@/components/player/RosterNeedsStrip';
import { ThemedText } from '@/components/ui/ThemedText';
import { useColors } from '@/hooks/useColors';

import { freeAgentListStyles as styles } from './freeAgentListStyles';

/**
 * Presentational chrome extracted from FreeAgentList so the screen file stays
 * focused on data + interaction. These are pure (no state) pieces lifted out
 * verbatim: the slash-line column key, the offseason banner, and the
 * empty-results state.
 */

/** Stat-key labels above the slash-line column. */
export function FreeAgentColumnKey({ isCategories }: { isCategories: boolean }) {
  const c = useColors();
  return (
    <>
      <View style={[styles.colKeyStats, isCategories ? styles.statsCategories : styles.statsPoints]}>
        <ThemedText
          type="varsitySmall"
          style={[styles.colKeyText, { color: c.secondaryText }]}
          accessibilityLabel={
            isCategories
              ? 'Stat columns: points, rebounds, assists, steals, blocks'
              : 'Stat columns: points, rebounds, assists'
          }
        >
          {isCategories ? 'PTS · REB · AST · STL · BLK' : 'PTS · REB · AST'}
        </ThemedText>
      </View>
      <View style={styles.colKeyAddSpacer} />
    </>
  );
}

/** Closed-wire banner shown during the offseason. */
export function FreeAgentOffseasonBanner() {
  const c = useColors();
  return (
    <View style={[styles.offseasonBanner, { backgroundColor: c.cardAlt, borderColor: c.gold + '40' }]}>
      <View style={styles.offseasonEyebrowRow}>
        <View style={[styles.offseasonRule, { backgroundColor: c.gold }]} />
        <ThemedText type="varsitySmall" style={[styles.offseasonEyebrow, { color: c.gold }]}>
          OFFSEASON
        </ThemedText>
      </View>
      <ThemedText style={[styles.offseasonBody, { color: c.secondaryText }]}>
        The wire is closed. Reopens at season start.
      </ThemedText>
    </View>
  );
}

type FilterBarProps = ComponentProps<typeof PlayerFilterBar>;
type NeedsStripProps = ComponentProps<typeof RosterNeedsStrip>;

interface FreeAgentListHeaderProps {
  chipPositions: string[];
  rosterCounts: NeedsStripProps['counts'];
  rosterStates: NeedsStripProps['states'];
  openSlots: number;
  /** Fully-merged PlayerFilterBar props (filter state + extras). */
  filterBarProps: FilterBarProps;
}

/** Roster-needs strip + filter bar — rendered identically in the loading and
 *  loaded states, so it lives here once instead of being duplicated. */
export function FreeAgentListHeader({
  chipPositions,
  rosterCounts,
  rosterStates,
  openSlots,
  filterBarProps,
}: FreeAgentListHeaderProps) {
  return (
    <>
      {chipPositions.length > 0 && (
        <RosterNeedsStrip
          positions={chipPositions}
          counts={rosterCounts}
          states={rosterStates}
          openSlots={openSlots}
          selectedPosition={filterBarProps.selectedPosition}
          onPositionChange={filterBarProps.onPositionChange}
        />
      )}
      <PlayerFilterBar {...filterBarProps} />
    </>
  );
}

/** Empty-results state for the player list. */
export function FreeAgentEmptyState() {
  const c = useColors();
  return (
    <View style={styles.emptyState}>
      <View style={[styles.emptyRule, { backgroundColor: c.gold }]} />
      <ThemedText type="varsitySmall" style={[styles.emptyEyebrow, { color: c.gold }]}>
        NO PLAYERS MATCH.
      </ThemedText>
      <ThemedText style={[styles.emptyBody, { color: c.secondaryText }]}>
        Adjust the filters above to widen the search.
      </ThemedText>
    </View>
  );
}
