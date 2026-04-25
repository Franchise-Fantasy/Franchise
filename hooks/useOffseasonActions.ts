import { queryKeys } from '@/constants/queryKeys';
import { supabase } from '@/lib/supabase';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';

type Args = {
  leagueId: string;
  season: string;
  isDynasty: boolean;
};

/**
 * Offseason action handlers — drives the home hero's contextual action
 * pill (Enter Lottery / Finalize Keepers / Create Draft / Start Season).
 * Each handler manages its own Alert flow + Supabase mutation + query
 * invalidation. The returned `loading` flag reflects whichever action
 * is in flight.
 */
export function useOffseasonActions({ leagueId, season, isDynasty }: Args) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const goToLotteryRoom = () => {
    router.push('/lottery-room' as never);
  };

  // Transition from the regular season into the offseason. Fires the
  // `advance-season` edge function which archives stats, clears pending
  // moves, and flips `offseason_step` to 'season_complete'.
  const advanceSeason = () => {
    Alert.alert(
      'Advance to Offseason',
      "This will:\n\n- Archive this season's stats\n- Reset W/L records\n- Cancel pending trades, waivers, & queued moves\n- Begin the offseason process\n\nThis cannot be undone. Continue?",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Advance',
          style: 'destructive',
          onPress: async () => {
            setLoading(true);
            try {
              const { error } = await supabase.functions.invoke('advance-season', {
                body: { league_id: leagueId },
              });
              if (error) throw error;
              queryClient.invalidateQueries({ queryKey: queryKeys.league(leagueId) });
              Alert.alert('Season Advanced', 'The offseason has begun!');
            } catch (err: unknown) {
              Alert.alert(
                'Error',
                (err instanceof Error && err.message) || 'Failed to advance season',
              );
            } finally {
              setLoading(false);
            }
          },
        },
      ],
    );
  };

  const handleCreateRookieDraft = async () => {
    setLoading(true);
    try {
      const { error } = await supabase.functions.invoke('create-rookie-draft', {
        body: { league_id: leagueId },
      });
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: queryKeys.league(leagueId) });
      queryClient.invalidateQueries({ queryKey: ['rookieDraft', leagueId] });
      queryClient.invalidateQueries({ queryKey: queryKeys.activeDraft(leagueId) });
      Alert.alert('Rookie Draft Created', 'Schedule the date to begin.');
    } catch (err: unknown) {
      Alert.alert(
        'Error',
        (err instanceof Error && err.message) || 'Failed to create rookie draft',
      );
    } finally {
      setLoading(false);
    }
  };

  const handleFinalizeKeepers = () => {
    Alert.alert(
      'Finalize Keepers',
      'This will release all non-kept players to free agency. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Finalize',
          style: 'destructive',
          onPress: async () => {
            setLoading(true);
            try {
              const { error } = await supabase.functions.invoke('finalize-keepers', {
                body: { league_id: leagueId },
              });
              if (error) throw error;
              queryClient.invalidateQueries({ queryKey: queryKeys.league(leagueId) });
              queryClient.invalidateQueries({ queryKey: ['keeperDeclarations'] });
              Alert.alert('Keepers Finalized', 'Non-kept players have been released.');
            } catch (err: unknown) {
              Alert.alert(
                'Error',
                (err instanceof Error && err.message) || 'Failed to finalize keepers',
              );
            } finally {
              setLoading(false);
            }
          },
        },
      ],
    );
  };

  const handleCreateSeasonDraft = async () => {
    setLoading(true);
    try {
      const [teamsRes, prevDraftRes] = await Promise.all([
        supabase.from('teams').select('id', { count: 'exact', head: true }).eq('league_id', leagueId),
        supabase
          .from('drafts')
          .select('draft_type, time_limit')
          .eq('league_id', leagueId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      const teamCount = teamsRes.count ?? 10;
      const draftType = prevDraftRes.data?.draft_type ?? 'snake';
      const timeLimit = prevDraftRes.data?.time_limit ?? 120;

      const { error } = await supabase.from('drafts').insert({
        league_id: leagueId,
        season,
        type: 'initial',
        status: 'unscheduled',
        draft_type: draftType,
        rounds: teamCount,
        time_limit: timeLimit,
      });
      if (error) throw error;

      queryClient.invalidateQueries({ queryKey: ['seasonDraft', leagueId] });
      queryClient.invalidateQueries({ queryKey: queryKeys.activeDraft(leagueId) });
      Alert.alert('Draft Created', 'Schedule the date to begin.');
    } catch (err: unknown) {
      Alert.alert(
        'Error',
        (err instanceof Error && err.message) || 'Failed to create draft',
      );
    } finally {
      setLoading(false);
    }
  };

  const handleStartNewSeason = async () => {
    // Dynasty-only pre-check: every team must be at or below the roster
    // limit before we generate the new schedule, or rookie-draft overage
    // bleeds into regular-season matchups.
    if (isDynasty) {
      const { data: teams } = await supabase
        .from('teams')
        .select('id, name')
        .eq('league_id', leagueId);

      const { data: league } = await supabase
        .from('leagues')
        .select('roster_size')
        .eq('id', leagueId)
        .single();

      if (teams && league) {
        const overTeams: string[] = [];
        for (const team of teams) {
          const { count } = await supabase
            .from('league_players')
            .select('id', { count: 'exact', head: true })
            .eq('league_id', leagueId)
            .eq('team_id', team.id);
          if ((count ?? 0) > league.roster_size) {
            overTeams.push(team.name);
          }
        }
        if (overTeams.length > 0) {
          Alert.alert(
            'Roster Overage',
            `These teams are over the roster limit and need to make cuts before the season can start:\n\n${overTeams.join('\n')}`,
          );
          return;
        }
      }
    }

    Alert.alert(
      'Start New Season',
      `This will generate the schedule for ${season} and begin the new season. Continue?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Start Season',
          onPress: async () => {
            setLoading(true);
            try {
              const { error } = await supabase.functions.invoke('generate-schedule', {
                body: { league_id: leagueId },
              });
              if (error) throw error;
              queryClient.invalidateQueries({ queryKey: queryKeys.league(leagueId) });
            } catch (err: unknown) {
              Alert.alert(
                'Error',
                (err instanceof Error && err.message) || 'Failed to start season',
              );
            } finally {
              setLoading(false);
            }
          },
        },
      ],
    );
  };

  return {
    loading,
    goToLotteryRoom,
    advanceSeason,
    handleCreateRookieDraft,
    handleFinalizeKeepers,
    handleCreateSeasonDraft,
    handleStartNewSeason,
  };
}
