import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { useAuthInitialized, useSession } from '@/context/AuthProvider';
import { logger } from '@/utils/logger';

import { supabase } from '../lib/supabase';

interface AppState {
  leagueId: string | null;
  teamId: string | null;
  loading: boolean;
  setTeamId: (id: string | null) => void;
  setLeagueId: (id: string | null) => void;
  switchLeague: (leagueId: string, teamId: string) => void;
}

const AppStateContext = createContext<AppState | null>(null);

export const useAppState = () => {
  const context = useContext(AppStateContext);
  if (!context) {
    throw new Error('useAppState must be used within AppStateProvider');
  }
  return context;
};

/**
 * Non-throwing variant — returns null when consumed outside an
 * AppStateProvider. Use only for components that legitimately render
 * above the provider (e.g. PushSoftPrompt in AuthProvider) and whose
 * downstream hooks (useColors, useActiveLeagueSport) need to fall back
 * to a default rather than crash.
 */
export const useOptionalAppState = (): AppState | null => {
  return useContext(AppStateContext);
};

export const AppStateProvider = ({ children }: { children: React.ReactNode }) => {
  const session = useSession();
  const initialized = useAuthInitialized();
  const [state, setState] = useState({
    leagueId: null as string | null,
    teamId: null as string | null,
    loading: true,
    resolvedUserId: null as string | null,
  });

  const setTeamId = useCallback((id: string | null) => {
    setState(prev => ({ ...prev, teamId: id }));
  }, []);

  const setLeagueId = useCallback((id: string | null) => {
    setState(prev => ({ ...prev, leagueId: id }));
  }, []);

  // Bumped on every explicit league switch. The launch fetch below reads this
  // to detect a notification/deep-link tap that switched the league mid-fetch,
  // so it never clobbers the tap's target league back to the favorite.
  const switchSeqRef = useRef(0);

  const switchLeague = useCallback((leagueId: string, teamId: string) => {
    switchSeqRef.current += 1;
    setState(prev => ({ ...prev, leagueId, teamId, loading: false }));
  }, []);

  useEffect(() => {
    // Don't resolve loading until we know the auth state for certain.
    // This prevents index.tsx from routing before getSession() has returned.
    if (!initialized) return;

    if (!session?.user) {
      setState({ leagueId: null, teamId: null, loading: false, resolvedUserId: null });
      return;
    }

    setState(s => ({ ...s, loading: true }));

    let cancelled = false;
    const userId = session.user.id;
    // Snapshot the switch counter: if it moves while we're fetching, a
    // notification/deep-link tap has switched the league and owns the context.
    const seqAtStart = switchSeqRef.current;

    const fetchTeam = async () => {
      try {
        let resolved: { teamId: string | null; leagueId: string | null } | null = null;

        const { data: profile } = await supabase
          .from('profiles')
          .select('favorite_league_id')
          .eq('id', userId)
          .maybeSingle();

        if (profile?.favorite_league_id) {
          const { data: favTeam } = await supabase
            .from('teams')
            .select('id, league_id, leagues!teams_league_id_fkey!inner(id)')
            .eq('user_id', userId)
            .eq('league_id', profile.favorite_league_id)
            .maybeSingle();

          if (cancelled) return;
          if (favTeam) resolved = { teamId: favTeam.id, leagueId: favTeam.league_id };
        }

        if (!resolved) {
          // `leagues!inner` drops teams whose league is archived (RLS hides the
          // league row), so a member of a soft-deleted league doesn't resolve to a
          // dead league on launch — they fall back to no-league like a new user.
          const { data } = await supabase
            .from('teams')
            .select('id, league_id, leagues!teams_league_id_fkey!inner(id)')
            .eq('user_id', userId)
            .limit(1)
            .maybeSingle();

          if (cancelled) return;
          resolved = { teamId: data?.id ?? null, leagueId: data?.league_id ?? null };
        }

        // A notification tap switched the league while this fetch was in flight
        // (cold-start launch races both). The tap owns the league context — just
        // resolve loading; don't clobber its target back to the favorite league.
        if (switchSeqRef.current !== seqAtStart) {
          setState(s => ({ ...s, loading: false, resolvedUserId: userId }));
          return;
        }

        setState({ ...resolved, loading: false, resolvedUserId: userId });
      } catch (err) {
        if (cancelled) return;
        logger.warn('AppStateProvider fetchTeam failed', err);
        setState((s) => ({ ...s, loading: false }));
      }
    };

    fetchTeam();

    return () => {
      cancelled = true;
    };
  }, [initialized, session?.user?.id]);

  // Treat as loading if the session user hasn't been resolved yet
  // (prevents flash of setup screen before the team fetch effect fires)
  const isLoading = state.loading ||
    (!!session?.user?.id && state.resolvedUserId !== session.user.id);

  const value = useMemo(() => ({
    leagueId: state.leagueId,
    teamId: state.teamId,
    loading: isLoading,
    setTeamId,
    setLeagueId,
    switchLeague,
  }), [state.leagueId, state.teamId, isLoading, setTeamId, setLeagueId, switchLeague]);

  return (
    <AppStateContext.Provider value={value}>
      {children}
    </AppStateContext.Provider>
  );
};
