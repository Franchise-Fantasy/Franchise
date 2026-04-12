import { Session } from '@supabase/supabase-js'
import React, { createContext, useContext, useEffect, useState } from 'react'
import { hasBeenAsked, markAsAsked, registerPushToken, refreshPushToken } from '../lib/notifications'
// RevenueCat init is lazy — triggered when UpgradeModal opens, not on startup
// import { initPurchases, logoutPurchases } from '../lib/purchases'
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
  await registerPushToken(userId);
  await markAsAsked();
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
      if (newSession?.user) {
        promptNotificationsIfNeeded(newSession.user.id);
      }
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
