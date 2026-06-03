import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery, useQueryClient } from '@tanstack/react-query';

const QUERY_KEY = ['projectionToggle'] as const;
const STORAGE_KEY = 'projections:enabled';

/** Client-side display preference: whether projections are surfaced in the UI
 *  (player detail, free agents / draft ranking, analytics). Defaults ON.
 *
 *  Backed by the React Query cache so every consumer shares one reactive value
 *  — flipping it in settings live-updates every mounted screen — and persisted
 *  to AsyncStorage across launches.
 *
 *  Note: this does NOT gate auto-lineup, which always uses projections when
 *  available (they replace the prev-season fallback there). */
export function useProjectionToggle() {
  const queryClient = useQueryClient();

  const { data: enabled = true } = useQuery<boolean>({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      return stored == null ? true : stored === '1';
    },
    staleTime: Infinity,
  });

  const setEnabled = (next: boolean) => {
    queryClient.setQueryData(QUERY_KEY, next);
    AsyncStorage.setItem(STORAGE_KEY, next ? '1' : '0').catch(() => {});
  };

  return { enabled, setEnabled, toggle: () => setEnabled(!enabled) };
}
