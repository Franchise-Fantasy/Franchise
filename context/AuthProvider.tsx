import { Session } from '@supabase/supabase-js'
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react'

import { PushSoftPrompt } from '@/components/onboarding/PushSoftPrompt'
import { logger } from '@/utils/logger'

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

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [initialized, setInitialized] = useState(false);

  // Apple expects a contextual soft-prompt before the OS push permission
  // dialog. We surface this modal once per install on first sign-in (or
  // first session restore) when hasBeenAsked() is false.
  const [softPromptVisible, setSoftPromptVisible] = useState(false);
  const [softPromptUserId, setSoftPromptUserId] = useState<string | null>(null);

  const queueSoftPromptIfNeeded = useCallback(async (userId: string) => {
    if (await hasBeenAsked()) return;
    setSoftPromptUserId(userId);
    setSoftPromptVisible(true);
  }, []);

  const handleEnablePush = useCallback(async () => {
    const userId = softPromptUserId;
    setSoftPromptVisible(false);
    setSoftPromptUserId(null);
    if (!userId) return;
    try {
      await registerPushToken(userId);
    } catch (err) {
      logger.warn('registerPushToken from soft-prompt failed', err);
    } finally {
      await markAsAsked();
    }
  }, [softPromptUserId]);

  const handleDismissPush = useCallback(async () => {
    setSoftPromptVisible(false);
    setSoftPromptUserId(null);
    // Mark as asked so we don't badger the user every cold-start. They can
    // still opt in later via Profile → Push Notifications toggle.
    await markAsAsked();
  }, []);

  useEffect(() => {
    let cancelled = false;

    supabase.auth
      .getSession()
      .then(({ data: { session } }) => {
        if (cancelled) return;
        setSession(session);
        setInitialized(true);
        if (session?.user) {
          queueSoftPromptIfNeeded(session.user.id).catch((e) =>
            logger.warn('queueSoftPromptIfNeeded failed', e),
          );
          refreshPushToken(session.user.id).catch((e) =>
            logger.warn('refreshPushToken failed', e),
          );
          // Warm RevenueCat so the paywall doesn't pay the SDK-configure cost on first open.
          initPurchases(session.user.id).catch((e) =>
            logger.warn('initPurchases failed', e),
          );
        }
      })
      .catch(async (err) => {
        logger.warn('Initial getSession failed, clearing stored session', err);
        await supabase.auth.signOut().catch(() => {});
        if (cancelled) return;
        setSession(null);
        setInitialized(true);
      });

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (cancelled) return;
      setSession(newSession);
      if (newSession?.user) {
        queueSoftPromptIfNeeded(newSession.user.id).catch((e) =>
          logger.warn('queueSoftPromptIfNeeded failed', e),
        );
        initPurchases(newSession.user.id).catch((e) =>
          logger.warn('initPurchases failed', e),
        );
      } else {
        logoutPurchases();
      }
    });

    return () => {
      cancelled = true;
      authListener.subscription.unsubscribe();
    };
  }, [queueSoftPromptIfNeeded]);

  return (
    <AuthContext.Provider value={session}>
      <AuthInitializedContext.Provider value={initialized}>
        {children}
        <PushSoftPrompt
          visible={softPromptVisible}
          onEnable={handleEnablePush}
          onDismiss={handleDismissPush}
        />
      </AuthInitializedContext.Provider>
    </AuthContext.Provider>
  );
}
