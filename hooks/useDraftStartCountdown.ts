import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { queryKeys } from '@/constants/queryKeys';
import { supabase } from '@/lib/supabase';
import { DraftState } from '@/types/draft';
import { formatClockRemaining } from '@/utils/draft/pickClock';

/**
 * Live countdown to a pending draft's scheduled start, plus the client-side
 * kickoff. When the clock reaches `draft_date` any league member present fires
 * `start-draft` (the per-minute `auto-start-pending-drafts` cron is the safety
 * net for an empty room). A draft can ONLY begin at/after `draft_date` — the
 * edge fn rejects an early start — so every client's local expiry converges on
 * the same wall-clock moment, and the following `draftState` invalidation is
 * what swaps the pending lobby / board over to `in_progress`.
 *
 * Owned by the draft room's pre-draft lobby (the only phase where the trigger
 * must fire) and kept out of the render tree as a hook so the lobby's static
 * chrome doesn't re-render on the per-second tick.
 *
 * Returns the formatted remaining time (`"58:12"`, `"1h 04m"`) while pending,
 * or null once the draft is live/past.
 */
export function useDraftStartCountdown(
  draftState: DraftState | undefined,
  draftId: string,
): { timeUntilDraft: string | null } {
  const queryClient = useQueryClient();
  const [timeUntilDraft, setTimeUntilDraft] = useState<string | null>(null);
  const startDraftCalledRef = useRef(false);

  useEffect(() => {
    if (draftState?.status !== 'pending' || !draftState?.draft_date) {
      setTimeUntilDraft(null);
      return;
    }

    const tick = async () => {
      const remaining = new Date(draftState.draft_date!).getTime() - Date.now();
      if (remaining <= 0) {
        setTimeUntilDraft(null);
        if (startDraftCalledRef.current) return;
        startDraftCalledRef.current = true;
        await supabase.auth.refreshSession();
        await supabase.functions.invoke('start-draft', { body: { draft_id: draftId } });
        queryClient.invalidateQueries({ queryKey: queryKeys.draftState(draftId) });
      } else {
        setTimeUntilDraft(formatClockRemaining(remaining));
      }
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => {
      clearInterval(interval);
      startDraftCalledRef.current = false;
    };
  }, [draftState?.status, draftState?.draft_date, draftId, queryClient]);

  return { timeUntilDraft };
}
