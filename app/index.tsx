import Auth from '@/components/Auth';
import LoadingScreen from '@/components/LoadingScreen';
import { useAppState } from '@/context/AppStateProvider';
import { useSession } from '@/context/AuthProvider';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';

const MIN_SPLASH_MS = 2000;

export default function IndexScreen() {
  const session = useSession();
  const router = useRouter();
  const { leagueId, teamId, loading } = useAppState();
  const [minDone, setMinDone] = useState(false);

  // Enforce a minimum splash duration so there's no jarring skip.
  useEffect(() => {
    const t = setTimeout(() => setMinDone(true), MIN_SPLASH_MS);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!minDone || loading || !session) return;

    if (leagueId) {
      router.replace('/(tabs)');
    } else {
      router.replace('/(setup)');
    }
  }, [session, leagueId, teamId, loading, minDone]);

  if (loading || !minDone) {
    return <LoadingScreen />;
  }

  if (!session) {
    return <Auth />;
  }

  return null;
}

export const options = {
  headerShown: false,
};
