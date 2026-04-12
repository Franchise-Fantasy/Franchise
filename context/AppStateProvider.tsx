import { useAuthInitialized, useSession } from '@/context/AuthProvider';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
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

  const switchLeague = useCallback((leagueId: string, teamId: string) => {
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

    const fetchTeam = async () => {
      const { data: profile } = await supabase
        .from('profiles')
        .select('favorite_league_id')
        .eq('id', session.user.id)
        .maybeSingle();

      if (profile?.favorite_league_id) {
        const { data: favTeam } = await supabase
          .from('teams')
          .select('id, league_id')
          .eq('user_id', session.user.id)
          .eq('league_id', profile.favorite_league_id)
          .maybeSingle();

        if (favTeam) {
          setState({ teamId: favTeam.id, leagueId: favTeam.league_id, loading: false, resolvedUserId: session.user.id });
          return;
        }
      }

      const { data } = await supabase
        .from('teams')
        .select('id, league_id')
        .eq('user_id', session.user.id)
        .limit(1)
        .maybeSingle();

      setState({
        teamId: data?.id ?? null,
        leagueId: data?.league_id ?? null,
        loading: false,
        resolvedUserId: session.user.id,
      });
    };

    fetchTeam();
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
