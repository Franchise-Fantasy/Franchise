import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

const DISMISSED_KEY = '@dismissed_home_announcements';
const MAX_KEPT = 20; // cap growth — old dismissed banners age out of the CMS anyway

/**
 * Per-device dismissal state for homepage announcement banners. Loads the
 * dismissed entry-id list from AsyncStorage on mount and persists on dismiss.
 * Reactive, so dismissing a banner immediately drops it from the carousel.
 * Mirrors the AsyncStorage pattern in the older commissioner banner.
 */
export function useDismissedAnnouncements() {
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(DISMISSED_KEY)
      .then((raw) => {
        if (cancelled || !raw) return;
        try {
          const ids: string[] = JSON.parse(raw);
          setDismissedIds(new Set(ids));
        } catch {
          // corrupt value — start fresh
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const dismiss = useCallback((id: string) => {
    setDismissedIds((prev) => {
      if (prev.has(id)) return prev;
      const arr = [...prev, id].slice(-MAX_KEPT);
      AsyncStorage.setItem(DISMISSED_KEY, JSON.stringify(arr)).catch(() => {});
      return new Set(arr);
    });
  }, []);

  return { dismissedIds, dismiss };
}
