import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

const SEEN_KEY = '@seen_coach_marks';

/**
 * Per-device "seen" state for a single one-time coach-mark (a hint for an
 * unintuitive gesture / info location). The hint shows once until the user
 * dismisses it, then never again on that device. `visible` stays false while
 * the stored set is loading so nothing flashes on mount. Mirrors the
 * AsyncStorage pattern in useDismissedAnnouncements.
 */
export function useCoachMark(id: string) {
  const [state, setState] = useState<'loading' | 'show' | 'hide'>('loading');

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(SEEN_KEY)
      .then((raw) => {
        if (cancelled) return;
        let seen = new Set<string>();
        if (raw) {
          try {
            seen = new Set(JSON.parse(raw) as string[]);
          } catch {
            // corrupt value — treat as nothing seen
          }
        }
        setState(seen.has(id) ? 'hide' : 'show');
      })
      .catch(() => {
        if (!cancelled) setState('hide');
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const dismiss = useCallback(() => {
    setState('hide');
    // Re-read before writing so we don't clobber ids other screens marked seen.
    AsyncStorage.getItem(SEEN_KEY)
      .then((raw) => {
        let arr: string[] = [];
        if (raw) {
          try {
            arr = JSON.parse(raw) as string[];
          } catch {
            arr = [];
          }
        }
        if (!arr.includes(id)) {
          arr.push(id);
          AsyncStorage.setItem(SEEN_KEY, JSON.stringify(arr)).catch(() => {});
        }
      })
      .catch(() => {});
  }, [id]);

  return { visible: state === 'show', dismiss };
}
