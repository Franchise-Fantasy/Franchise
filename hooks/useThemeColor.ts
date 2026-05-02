/**
 * Learn more about light and dark modes:
 * https://docs.expo.dev/guides/color-schemes/
 */

import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';

// Only string-valued tokens (i.e. plain colors) are valid here. Excludes
// composite-style tokens like `heroShadow`, which are objects.
type StringColorName = {
  [K in keyof typeof Colors.light & keyof typeof Colors.dark]:
    typeof Colors.light[K] extends string ? K : never
}[keyof typeof Colors.light & keyof typeof Colors.dark];

export function useThemeColor(
  props: { light?: string; dark?: string },
  colorName: StringColorName
): string {
  const theme = useColorScheme() ?? 'light';
  const colorFromProps = props[theme];

  if (colorFromProps) {
    return colorFromProps;
  } else {
    return Colors[theme][colorName];
  }
}
