import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { ThemedText } from '@/components/ui/ThemedText';
import { Colors, Fonts, SPORT_THEMES } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { SPORT_DISPLAY, type Sport } from '@/constants/LeagueDefaults';
import { ms, s } from '@/utils/scale';

interface Props {
  sport: Sport;
  style?: StyleProp<ViewStyle>;
}

/**
 * Pill that surfaces a league's sport. The fill color comes directly from
 * SPORT_THEMES keyed on the prop — NOT from `useColors()` — so each league's
 * row in the LeagueSwitcher can render its own sport color regardless of
 * which league is active.
 *
 * Used in PageHeader (for the active league) and LeagueSwitcher (one per
 * row, each league's own sport color).
 */
export function SportBadge({ sport, style }: Props) {
  const scheme = useColorScheme() ?? 'light';
  // Resolve the accent for THIS sport (not the active league's). Falls back
  // to the NBA gold from the base palette when no theme override exists.
  const bg = SPORT_THEMES[sport]?.[scheme]?.gold ?? Colors[scheme].gold;
  const fg = Colors[scheme].statusText;

  return (
    <View
      style={[styles.badge, { backgroundColor: bg }, style]}
      accessibilityRole="text"
      accessibilityLabel={`${SPORT_DISPLAY[sport]} league`}
    >
      <ThemedText style={[styles.text, { color: fg }]}>
        {SPORT_DISPLAY[sport]}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: s(8),
    paddingVertical: s(3),
    borderRadius: 4,
    alignSelf: 'flex-start',
  },
  text: {
    fontFamily: Fonts.varsityBold,
    fontSize: ms(10),
    letterSpacing: 0.8,
    lineHeight: ms(12),
  },
});
