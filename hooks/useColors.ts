import { createContext, createElement, useContext, useMemo, type ReactNode } from 'react';

import { Colors, SPORT_THEMES } from '@/constants/Colors';
import type { Sport } from '@/constants/LeagueDefaults';
import { useActiveLeagueSport } from '@/hooks/useActiveLeagueSport';
import { useColorScheme } from '@/hooks/useColorScheme';

/**
 * Optional sport-theme override context. Wrap a subtree in
 * `SportThemeProvider` to force `useColors()` (and anything reading
 * through it — BrandButton, StepIndicator, etc.) to render with a
 * specific sport's palette regardless of the active league context.
 *
 * Use case: create-league wizard, where the user is *picking* a sport
 * via StepBasics. The picked sport should drive the wizard's chrome
 * (primary buttons, indicator dots), not the sport of whatever league
 * the user arrived from.
 */
const SportThemeContext = createContext<Sport | null>(null);

export function SportThemeProvider({
  sport,
  children,
}: {
  sport: Sport;
  children: ReactNode;
}) {
  // createElement (not JSX) so this file stays .ts — useColors is imported
  // by ~hundreds of components and renaming it would churn the lint cache.
  return createElement(SportThemeContext.Provider, { value: sport }, children);
}

/**
 * Returns the active palette for the current color scheme + active sport.
 * Sport priority: explicit `SportThemeProvider` override (if any) →
 * `useActiveLeagueSport()` (the user's currently-active league) → 'nba'.
 *
 * NBA is the baseline (returns Colors[scheme] verbatim, same reference);
 * other sports merge in their accent overrides from SPORT_THEMES.
 */
export function useColors(): typeof Colors.light {
  const scheme = useColorScheme() ?? 'light';
  const activeLeagueSport = useActiveLeagueSport();
  const override = useContext(SportThemeContext);
  const sport = override ?? activeLeagueSport;

  return useMemo(() => {
    const base = Colors[scheme];
    const overrides = SPORT_THEMES[sport]?.[scheme];
    if (!overrides) return base;
    return { ...base, ...overrides };
  }, [scheme, sport]);
}
