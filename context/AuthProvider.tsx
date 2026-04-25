import { Session } from '@supabase/supabase-js'
import React, { createContext, useContext, useEffect, useState } from 'react'
import { hasBeenAsked, markAsAsked, registerPushToken, refreshPushToken } from '../lib/notifications'
import { initPurchases, logoutPurchases } from '../lib/purchases'
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
    // Get the initial session — only after this resolves do we know auth state for sure.
    // If the stored refresh token is stale (e.g. after a long absence or backend rotation),
    // supabase-js throws AuthApiError. Treat that as "no session" and clear local storage so
    // the user can sign in fresh — never leave the app stuck on a loading screen.
    let cancelled = false;

    supabase.auth
      .getSession()
      .then(({ data: { session } }) => {
        if (cancelled) return;
        setSession(session);
        setInitialized(true);
        if (session?.user) {
          promptNotificationsIfNeeded(session.user.id).catch((e) =>
            console.warn('promptNotificationsIfNeeded failed:', e),
          );
          refreshPushToken(session.user.id).catch((e) =>
            console.warn('refreshPushToken failed:', e),
          );
          // Warm RevenueCat so the paywall doesn't pay the SDK-configure cost on first open.
          initPurchases(session.user.id).catch((e) =>
            console.warn('initPurchases failed:', e),
          );
        }
      })
      .catch(async (err) => {
        console.warn('Initial getSession failed, clearing stored session:', err);
        await supabase.auth.signOut().catch(() => {});
        if (cancelled) return;
        setSession(null);
        setInitialized(true);
      });

    // Listen for changes
    const { data: authListener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (cancelled) return;
      setSession(newSession);
      if (newSession?.user) {
        promptNotificationsIfNeeded(newSession.user.id).catch((e) =>
          console.warn('promptNotificationsIfNeeded failed:', e),
        );
        initPurchases(newSession.user.id).catch((e) =>
          console.warn('initPurchases failed:', e),
        );
      } else {
        logoutPurchases();
      }
    });

    return () => {
      cancelled = true;
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
