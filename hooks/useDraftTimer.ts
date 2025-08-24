import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

// Helper function to parse interval strings like "08:00:00" from Supabase
const parseIntervalToMilliseconds = (interval: string): number => {
  if (!interval) return 0;
  const parts = interval.split(':').map(Number);
  const minutes = parts[1] || 0;
  const seconds = parts[2] || 0;
  return ( minutes * 60 + seconds) * 1000;
};



export const useDraftTimer = (pickStartedAt?: string, timeLimit?: number) => {
  const [timeRemaining, setTimeRemaining] = useState(0);

  const calculateRemaining = () => {
    if (!pickStartedAt || !timeLimit) return 0;
    const now = Date.now();
    const start = new Date(pickStartedAt).getTime();
    const end = start + timeLimit * 1000;
    return Math.max(0, end - now);
  };

  useEffect(() => {
    setTimeRemaining(calculateRemaining());

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
  }, [pickStartedAt, timeLimit]);

  const formatTime = (ms: number) => {
    if (ms <= 0) return '00:00';
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
    const seconds = String(totalSeconds % 60).padStart(2, '0');
    return `${minutes}:${seconds}`;
  };

  return formatTime(timeRemaining);
};