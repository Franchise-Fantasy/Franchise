import Auth from '@/components/Auth';
import { useAppState } from '@/context/AppStateProvider';
import { useSession } from '@/context/AuthProvider';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator } from 'react-native';

export default function IndexScreen() {
  const session = useSession();
  const router = useRouter();
  const { leagueId, teamId, loading } = useAppState();

  useEffect(() => {
    console.log('[Index] Current state:', { 
      hasSession: !!session, 
      leagueId, 
      teamId,
      loading 
    });
    
    if (!session) {
      console.log('[Index] No session, showing auth');
      return;
    }
    
    if (loading) {
      console.log('[Index] Still loading app state');
      return;
    }

    console.log('[Index] Making routing decision with leagueId:', leagueId);
    
    const timer = setTimeout(() => {
      if (leagueId) {
        console.log('[Index] Routing to tabs');
        router.replace('/(tabs)');
      } else {
        console.log('[Index] Routing to setup');
        router.replace('/(setup)');
      }
    }, 500); // Increased delay slightly

    return () => clearTimeout(timer);
  }, [session, leagueId, teamId, loading]);

  if (!session) {
    return <Auth />;
  }

  if (loading) {
    return <ActivityIndicator style={{ flex: 1 }} />;
  }

  return null;
}

export const options = { 
  headerShown: false,
};


