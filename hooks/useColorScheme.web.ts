import { useEffect, useState } from 'react';
import { useColorScheme as useRNColorScheme } from 'react-native';

// Module-scoped, NOT per-component state. The guard below exists so the first
// client render matches the statically-rendered light markup — that's a
// one-time, app-wide condition. Tracking it per hook instance meant every
// component mounted AFTER hydration also started at light and corrected on its
// first effect, so anything appearing later (menus, modals, badges in a panel
// that just opened) flashed light-mode colors for a frame in dark mode.
let hasHydratedApp = false;

/**
 * To support static rendering, this value needs to be re-calculated on the client side for web
 */
export function useColorScheme(): 'light' | 'dark' {
  const [hasHydrated, setHasHydrated] = useState(hasHydratedApp);

  useEffect(() => {
    hasHydratedApp = true;
    setHasHydrated(true);
  }, []);

  const colorScheme = useRNColorScheme();

  if (hasHydrated) {
    return colorScheme === 'dark' ? 'dark' : 'light';
  }

  return 'light';
}
