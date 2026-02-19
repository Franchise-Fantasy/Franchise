import { Session } from '@supabase/supabase-js'
import React, { createContext, useContext, useEffect, useState } from 'react'
import { Alert } from 'react-native'
import { hasBeenAsked, markAsAsked, registerPushToken } from '../lib/notifications'
import { supabase } from '../lib/supabase'

const AuthContext = createContext<Session | null>(null)

export function useSession() {
  return useContext(AuthContext)
}

async function promptNotificationsIfNeeded(userId: string) {
  if (await hasBeenAsked()) return;
  Alert.alert(
    'Draft Notifications',
    "Get notified when it's your turn to pick, even when the app is closed.",
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

  useEffect(() => {
    // Get the initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      console.log( '[AuthProvider] Auth state changed:', session)
      setSession(session);
      if (session?.user) promptNotificationsIfNeeded(session.user.id);
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
      {children}
    </AuthContext.Provider>
  );
}
