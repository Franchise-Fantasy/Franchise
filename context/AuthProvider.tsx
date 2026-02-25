import { Session } from '@supabase/supabase-js'
import React, { createContext, useContext, useEffect, useState } from 'react'
import { Alert } from 'react-native'
import { hasBeenAsked, markAsAsked, registerPushToken, refreshPushToken } from '../lib/notifications'
import { supabase } from '../lib/supabase'

const AuthContext = createContext<Session | null>(null)
const AuthInitializedContext = createContext(false)

export function useSession() {
  return useContext(AuthContext)
}

export function useAuthInitialized() {
  return useContext(AuthInitializedContext)
}

async function promptNotificationsIfNeeded(userId: string) {
  if (await hasBeenAsked()) return;
  Alert.alert(
    'Stay in the Loop',
    'Get notified about draft picks, trades, matchup results, and more.',
    [
      {
        text: 'Enable',
        onPress: async () => {
          await registerPushToken(userId);
          await markAsAsked();
        },
      },
      {
        text: 'Not Now',
        style: 'cancel',
        onPress: markAsAsked,
      },
    ]
  );
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    // Get the initial session — only after this resolves do we know auth state for sure
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setInitialized(true);
      if (session?.user) {
        promptNotificationsIfNeeded(session.user.id);
        refreshPushToken(session.user.id);
      }
    });

    // Listen for changes
    const { data: authListener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      if (newSession?.user) promptNotificationsIfNeeded(newSession.user.id);
    });

    return () => {
      authListener.subscription.unsubscribe();
    };
  }, []);

  return (
    <AuthContext.Provider value={session}>
      <AuthInitializedContext.Provider value={initialized}>
        {children}
      </AuthInitializedContext.Provider>
    </AuthContext.Provider>
  );
}
