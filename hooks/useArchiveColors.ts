import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';

/**
 * Returns the NBA-baseline palette regardless of the user's active league
 * sport. Used by the NBA Playoff Archive feature: that screen renders real
 * NBA history and should keep the turfGreen / vintageGold / heritageGold
 * branding even when the user's active league is WNBA / NFL / etc.
 *
 * Drop-in replacement for `useColors()` inside the playoff-archive folder.
 */
export function useArchiveColors(): typeof Colors.light {
  const scheme = useColorScheme() ?? 'light';
  return Colors[scheme];
}
