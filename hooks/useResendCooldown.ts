import { useCallback, useEffect, useState } from 'react';

/**
 * Countdown gate for "resend" buttons.
 *
 * Supabase rate-limits confirmation emails per address (60s on hosted
 * projects), so an ungated Resend button spends the user's taps producing
 * "For security purposes, you can only request this after N seconds." A
 * visible countdown says the same thing before they tap.
 *
 * Call `start()` after a send actually succeeds.
 */
export function useResendCooldown(durationSeconds = 60) {
  const [secondsLeft, setSecondsLeft] = useState(0);

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const timer = setTimeout(() => setSecondsLeft((n) => n - 1), 1000);
    return () => clearTimeout(timer);
  }, [secondsLeft]);

  const start = useCallback(() => setSecondsLeft(durationSeconds), [durationSeconds]);

  return { secondsLeft, canResend: secondsLeft === 0, start };
}
