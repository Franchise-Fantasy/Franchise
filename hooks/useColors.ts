import { useMemo } from 'react';
import { Colors, SPORT_THEMES } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useActiveLeagueSport } from '@/hooks/useActiveLeagueSport';

/**
 * Returns the active palette for the current color scheme + active league
 * sport. NBA is the baseline (returns Colors[scheme] verbatim, same
 * reference); other sports merge in their accent overrides from
 * SPORT_THEMES.
 *
 * Drop-in replacement for `Colors[scheme]` in any component that wants
 * sport-aware tinting. Components used outside league context (auth,
 * setup, league switcher) can keep using `Colors[scheme]` directly —
 * they fall back to NBA gold there because no league is active.
 */
export function useColors(): typeof Colors.light {
  const scheme = useColorScheme() ?? 'light';
  const sport = useActiveLeagueSport();

  return useMemo(() => {
    const base = Colors[scheme];
    const overrides = SPORT_THEMES[sport]?.[scheme];
    if (!overrides) return base;
    return { ...base, ...overrides };
  }, [scheme, sport]);
}
