import { useMemo } from 'react';
import { Pressable, StyleSheet, TouchableOpacity, View } from 'react-native';

import { ThemedText } from '@/components/ui/ThemedText';
import { Colors, SPORT_THEMES } from '@/constants/Colors';
import {
  canBypassCreationWindow,
  getCreationStatus,
  getCurrentSeason,
  type SeasonCreationStatus,
  SPORT_OPTIONS,
  SPORT_TO_DB,
  type Sport,
} from '@/constants/LeagueDefaults';
import { useSession } from '@/context/AuthProvider';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useIsAdmin } from '@/hooks/useIsAdmin';
import { ms, s } from '@/utils/scale';

interface SportSelectorProps {
  selected: Sport;
  onSelect: (sport: Sport) => void;
  /** Skip the season-creation window gate. Imports bring in an existing,
   *  already-running league, so the "create early enough in the season"
   *  cutoff doesn't apply — every implemented sport stays selectable for
   *  the current season. Defaults to false (normal create-league gating). */
  ignoreCreationWindow?: boolean;
}

/**
 * Two-up sport tile layout that replaces the SegmentedControl for sport
 * selection. Each tile shows the sport name, the season currently
 * creatable for it, and a status line. Gated sports render greyed-out
 * and non-tappable — except for allowlisted accounts (see
 * canBypassCreationWindow), who can create before a season's opening date.
 *
 * Visual rhythm: same chip/pill family as the rest of the wizard (matched
 * radius + 1.5px border + sport-theme tint for active state).
 */
export function SportSelector({ selected, onSelect, ignoreCreationWindow = false }: SportSelectorProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const session = useSession();
  const { isDesktop } = useBreakpoint();
  const { isAdmin } = useIsAdmin();
  const bypassOpenDate = canBypassCreationWindow(session?.user?.id);

  // Compute creation status per render — pure date math, cheap.
  const tiles = useMemo(() => {
    const today = new Date();
    return SPORT_OPTIONS.filter((label) => {
      // NFL is internal-test only: admin accounts see the tile in the create
      // wizard; imports never offer it (no NFL import path). This is UX-only —
      // the leagues_nfl_admin_gate DB trigger enforces the same server-side.
      if (label === 'NFL') return isAdmin && !ignoreCreationWindow;
      return true;
    }).map((label) => {
      const sport = SPORT_TO_DB[label];
      // For imports, force the current season available — an existing league
      // isn't bound by the create-a-new-league window (see prop doc).
      const status: SeasonCreationStatus = ignoreCreationWindow
        ? { sport, season: getCurrentSeason(sport), defaultStartDate: null, available: true }
        : getCreationStatus(sport, today, { bypassOpenDate });
      return { sport, label, status };
    });
  }, [bypassOpenDate, ignoreCreationWindow, isAdmin]);

  return (
    <View style={styles.row}>
      {tiles.map(({ sport, label, status }) => {
        const isSelected = selected === sport;
        const isGated = !status.available;

        // Sport-specific tint for the active border / text. NBA falls
        // through to the baseline accent, WNBA picks up merlot.
        const sportTheme = SPORT_THEMES[sport]?.[scheme];
        const tint = sportTheme?.tint ?? c.tint;
        const activeBorder = sportTheme?.activeBorder ?? c.activeBorder ?? tint;

        const borderColor = isSelected ? activeBorder : c.border;
        const tileBg = isSelected
          ? sportTheme?.activeCard ?? c.activeCard ?? 'transparent'
          : 'transparent';

        const nameColor = isGated ? c.secondaryText : isSelected ? tint : c.text;
        const seasonColor = isGated ? c.secondaryText : c.text;
        const statusColor = isGated ? c.secondaryText : isSelected ? tint : c.secondaryText;

        const statusText = status.available
          ? 'Active'
          : status.opensAt
            ? `Opens ${status.opensAt}`
            : 'Coming soon';

        const a11y = {
          accessibilityState: { selected: isSelected, disabled: isGated },
          accessibilityLabel: `${label}, ${status.season} Season, ${statusText}`,
        } as const;

        const tileFace = (
          <>
            <ThemedText
              type="varsity"
              style={[styles.sportName, { color: nameColor }]}
            >
              {label}
            </ThemedText>
            <ThemedText style={[styles.season, { color: seasonColor }]}>
              {status.season} Season
            </ThemedText>
            <ThemedText style={[styles.status, { color: statusColor }]}>
              {statusText}
            </ThemedText>
          </>
        );

        // Desktop: size to content instead of splitting the row into two
        // thumb-sized slabs, and answer the pointer on hover. Pressable is
        // web-only here — native keeps TouchableOpacity so the press-fade
        // stays exactly as it is on the phone.
        if (isDesktop) {
          return (
            <Pressable
              key={sport}
              onPress={() => !isGated && onSelect(sport)}
              disabled={isGated}
              accessibilityRole="radio"
              {...a11y}
              style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
                styles.tile,
                styles.tileDesktop,
                {
                  borderColor:
                    hovered && !isSelected && !isGated ? c.secondaryText : borderColor,
                  backgroundColor: tileBg,
                  opacity: isGated ? 0.55 : 1,
                  borderWidth: isSelected ? 1.5 : 1,
                },
                pressed && !isGated && { opacity: 0.75 },
              ]}
            >
              {tileFace}
            </Pressable>
          );
        }

        return (
          <TouchableOpacity
            key={sport}
            onPress={() => !isGated && onSelect(sport)}
            disabled={isGated}
            activeOpacity={0.75}
            accessibilityRole="button"
            {...a11y}
            style={[
              styles.tile,
              {
                borderColor,
                backgroundColor: tileBg,
                opacity: isGated ? 0.55 : 1,
                borderWidth: isSelected ? 1.5 : 1,
              },
            ]}
          >
            {tileFace}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: s(10),
  },
  tile: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: s(10),
    paddingHorizontal: s(12),
    alignItems: 'flex-start',
    gap: s(2),
  },
  // Same Yoga caveat as SegmentedControl: `flex: 0` would zero the flexBasis and
  // squeeze the tile down to its padding. Size to content instead.
  tileDesktop: {
    flexGrow: 0,
    flexShrink: 0,
    flexBasis: 'auto',
    minWidth: 150,
    paddingVertical: 9,
    paddingHorizontal: 14,
  },
  sportName: {
    fontSize: ms(15),
    letterSpacing: 1.0,
  },
  season: {
    fontSize: ms(12),
    fontWeight: '600',
    marginTop: s(1),
  },
  status: {
    fontSize: ms(10),
    lineHeight: ms(13),
    marginTop: s(1),
  },
});
