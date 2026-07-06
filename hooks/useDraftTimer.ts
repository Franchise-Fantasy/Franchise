import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { formatClockRemaining } from '@/utils/draft/pickClock';

export const useDraftTimer = (
  pickStartedAt?: string,
  timeLimit?: number,
  /** When non-null the draft is paused: freeze the display at this many ms and
   *  stop ticking. resume-draft restores a live clock from the same value. */
  pausedRemainingMs?: number | null,
) => {
  const isPaused = pausedRemainingMs != null;

  // Store the RENDERED state (display string + expired flag), not raw ms, so a
  // tick that doesn't change what's on screen doesn't re-render the consumer.
  // The consumer is DraftOrder (the whole pick strip) — for a multi-hour slow
  // clock the display reads "5h 32m" and only changes once a minute, so gating
  // on the string avoids ~3600 pointless re-renders/hour while a 1s interval
  // still catches the sub-hour MM:SS ticks and the minute rollovers promptly.
  const compute = () => {
    const ms = pausedRemainingMs != null
      ? Math.max(0, pausedRemainingMs)
      : !pickStartedAt || !timeLimit
        ? 0
        : Math.max(0, new Date(pickStartedAt.replace(' ', 'T')).getTime() + timeLimit * 1000 - Date.now());
    return { display: formatClockRemaining(ms), expired: pausedRemainingMs == null && ms <= 0 };
  };
  const [state, setState] = useState(compute);

  useEffect(() => {
    const tick = () =>
      setState((prev) => {
        const next = compute();
        // Bail the re-render when nothing visible changed.
        return prev.display === next.display && prev.expired === next.expired ? prev : next;
      });

    tick();

    // Frozen while paused — no interval, no foreground recompute.
    if (isPaused) return;

    const interval = setInterval(tick, 1000);

    // Recalculate immediately when app comes back to foreground
    const subscription = AppState.addEventListener('change', (nextAppState) => {
      if (nextAppState === 'active') tick();
    });

    return () => {
      clearInterval(interval);
      subscription.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickStartedAt, timeLimit, isPaused, pausedRemainingMs]);

  // `expired` lets the consumer swap the bare "00:00" for a "Pick is in" label
  // during the brief window between server-side timer expiry and the realtime
  // pick-update arriving (~0.5–1.5s of QStash delivery + edge fn + broadcast).
  // A paused timer is never "expired" — it's frozen, not run out.
  return { display: state.display, expired: state.expired, paused: isPaused };
};