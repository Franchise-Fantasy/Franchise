import { useMemo } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';

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
import { useColorScheme } from '@/hooks/useColorScheme';
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
  const bypassOpenDate = canBypassCreationWindow(session?.user?.id);

  // Compute creation status per render — pure date math, cheap.
  const tiles = useMemo(() => {
    const today = new Date();
    return SPORT_OPTIONS.map((label) => {
      const sport = SPORT_TO_DB[label];
      // For imports, force the current season available — an existing league
      // isn't bound by the create-a-new-league window (see prop doc).
      const status: SeasonCreationStatus = ignoreCreationWindow
        ? { sport, season: getCurrentSeason(sport), defaultStartDate: null, available: true }
        : getCreationStatus(sport, today, { bypassOpenDate });
      return { sport, label, status };
    });
  }, [bypassOpenDate, ignoreCreationWindow]);

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

        return (
          <TouchableOpacity
            key={sport}
            onPress={() => !isGated && onSelect(sport)}
            disabled={isGated}
            activeOpacity={0.75}
            accessibilityRole="button"
            accessibilityState={{ selected: isSelected, disabled: isGated }}
            accessibilityLabel={`${label}, ${status.season} Season, ${statusText}`}
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
