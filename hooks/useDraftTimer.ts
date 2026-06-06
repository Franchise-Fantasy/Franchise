import { useEffect, useState } from 'react';
import { AppState } from 'react-native';



export const useDraftTimer = (
  pickStartedAt?: string,
  timeLimit?: number,
  /** When non-null the draft is paused: freeze the display at this many ms and
   *  stop ticking. resume-draft restores a live clock from the same value. */
  pausedRemainingMs?: number | null,
) => {
  const [timeRemaining, setTimeRemaining] = useState(0);
  const isPaused = pausedRemainingMs != null;

  useEffect(() => {
    const calculateRemaining = () => {
      if (isPaused) return Math.max(0, pausedRemainingMs);
      if (!pickStartedAt || !timeLimit) return 0;
      const now = Date.now();
      const start = new Date(pickStartedAt.replace(' ', 'T')).getTime();
      const end = start + timeLimit * 1000;
      return Math.max(0, end - now);
    };

    setTimeRemaining(calculateRemaining());

    // Frozen while paused — no interval, no foreground recompute.
    if (isPaused) return;

    const interval = setInterval(() => {
      setTimeRemaining(calculateRemaining());
    }, 1000);

    // Recalculate immediately when app comes back to foreground
    const subscription = AppState.addEventListener('change', (nextAppState) => {
      if (nextAppState === 'active') {
        setTimeRemaining(calculateRemaining());
      }
    });

    return () => {
      clearInterval(interval);
      subscription.remove();
    };
  }, [pickStartedAt, timeLimit, isPaused, pausedRemainingMs]);

  const formatTime = (ms: number) => {
    if (ms <= 0) return '00:00';
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
    const seconds = String(totalSeconds % 60).padStart(2, '0');
    return `${minutes}:${seconds}`;
  };

  // `expired` lets the consumer swap the bare "00:00" for a "Pick is in" label
  // during the brief window between server-side timer expiry and the realtime
  // pick-update arriving (~0.5–1.5s of QStash delivery + edge fn + broadcast).
  // A paused timer is never "expired" — it's frozen, not run out.
  return { display: formatTime(timeRemaining), expired: !isPaused && timeRemaining <= 0, paused: isPaused };
};