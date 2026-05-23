import { usePathname, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { View } from 'react-native';

import Auth from '@/components/account/Auth';
import { useAppState } from '@/context/AppStateProvider';
import { useSession } from '@/context/AuthProvider';
import { hasPendingDeepLink } from '@/lib/pendingNav';

export default function IndexScreen() {
  const session = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const { leagueId, teamId, loading } = useAppState();

  useEffect(() => {
    if (loading || !session) return;
    // Only redirect from the index route itself — once a deep link or
    // notification tap has navigated elsewhere, don't yank the user back.
    if (pathname !== '/') return;
    // A notification tap owns the launch navigation; let it land first.
    if (hasPendingDeepLink()) return;

    if (leagueId) {
      router.replace('/(tabs)');
    } else {
      router.replace('/(setup)');
    }
  }, [session, leagueId, teamId, loading, pathname]);

  if (loading) {
    // Native splash is still visible; render nothing.
    return <View />;
  }

  if (!session) {
    return <Auth />;
  }

  return null;
}

export const options = {
  headerShown: false,
};
