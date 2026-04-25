import { usePathname, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { View } from 'react-native';

import Auth from '@/components/account/Auth';
import { useAppState } from '@/context/AppStateProvider';
import { useSession } from '@/context/AuthProvider';

export default function IndexScreen() {
  const session = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const { leagueId, teamId, loading } = useAppState();

  useEffect(() => {
    if (loading || !session) return;
    if (pathname === '/reset-password') return;

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
