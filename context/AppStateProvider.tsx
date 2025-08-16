import { useSession } from '@/context/AuthProvider';
import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

interface AppState {
  leagueId: string | null;
  teamId: string | null;
  loading: boolean;
  setTeamId: (id: string | null) => void;
  setLeagueId: (id: string | null) => void;
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
  const [state, setState] = useState({
    leagueId: null as string | null,
    teamId: null as string | null,
    loading: true
  });

  const setTeamId = (id: string | null) => {
    setState(prev => ({ ...prev, teamId: id }));
  };

  const setLeagueId = (id: string | null) => {
    setState(prev => ({ ...prev, leagueId: id }));
  };

  useEffect(() => {
    if (!session?.user) {
      setState(s => ({ ...s, loading: false }));
      return;
    }

    const fetchTeam = async () => {
      const { data } = await supabase
        .from('teams')
        .select('id, league_id')
        .eq('user_id', session.user.id)
        .limit(1)
        .single();

      setState({
        teamId: data?.id ?? null,
        leagueId: data?.league_id ?? null,
        loading: false
      });
    };

    fetchTeam();
  }, [session?.user?.id]);

  const value = {
    ...state,
    setTeamId,
    setLeagueId
  };

  return (
    <AppStateContext.Provider value={value}>
      {children}
    </AppStateContext.Provider>
  );
};
