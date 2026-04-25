import { useCallback, useEffect, useRef } from 'react';
import { NativeModules, NativeEventEmitter, Platform, AppState, Alert, Linking } from 'react-native';

import { supabase } from '../lib/supabase';

const { FranchiseLiveActivityModule } = NativeModules;

const LIVE_ACTIVITIES_SUPPORTED =
  Platform.OS === 'ios' && parseInt(String(Platform.Version), 10) >= 16;

interface ActivityResult {
  activityId: string;
  pushToken: string | null;
}

interface ActiveActivity {
  activityId: string;
  type: 'matchup' | 'auction_draft';
  pushToken?: string;
}

interface MatchupActivityParams {
  myTeamName: string;
  opponentTeamName: string;
  myTeamTricode: string;
  opponentTeamTricode: string;
  matchupId: string;
  leagueId: string;
  scheduleId: string;
  teamId: string;
  initialState: {
    myScore: number;
    opponentScore: number;
    scoreGap: number;
    winProbability?: number;
    biggestContributor: string;
    myActivePlayers: number;
    opponentActivePlayers: number;
    players: {
      name: string;
      statLine: string;
      fantasyPoints: number;
      gameStatus: string;
      isOnCourt: boolean;
    }[];
  };
}

/**
 * Hook for managing iOS Live Activities (Dynamic Island + Lock Screen).
 * Handles starting/ending activities and registering push tokens with Supabase.
 */
export function useLiveActivity(userId?: string) {
  const activeActivityRef = useRef<string | null>(null);

  // Listen for push token updates from the native module
  useEffect(() => {
    if (!LIVE_ACTIVITIES_SUPPORTED || !FranchiseLiveActivityModule) return;

    const emitter = new NativeEventEmitter(FranchiseLiveActivityModule);
    const sub = emitter.addListener('LiveActivityTokenUpdate', async (event) => {
      const { activityId, pushToken } = event;
      if (!pushToken || !userId) return;

      // Upsert the new token for this activity
      await supabase
        .from('activity_tokens')
        .update({ push_token: pushToken })
        .eq('user_id', userId)
        .match({ stale: false })
        .neq('push_token', pushToken);
    });

    return () => sub.remove();
  }, [userId]);

  // Reconcile on app foreground: clean up stale tokens for ended activities
  useEffect(() => {
    if (!LIVE_ACTIVITIES_SUPPORTED || !FranchiseLiveActivityModule || !userId) return;

    const sub = AppState.addEventListener('change', async (state) => {
      if (state !== 'active') return;

      try {
        const activities: ActiveActivity[] =
          await FranchiseLiveActivityModule.getActiveActivities();
        const activeIds = new Set(activities.map((a) => a.activityId));

        // If our tracked activity is no longer active, clean it up
        if (activeActivityRef.current && !activeIds.has(activeActivityRef.current)) {
          await supabase
            .from('activity_tokens')
            .delete()
            .eq('user_id', userId);
          activeActivityRef.current = null;
        }
      } catch {
        // Non-critical — just log
      }
    });

    return () => sub.remove();
  }, [userId]);

  const startMatchupActivity = useCallback(
    async (params: MatchupActivityParams): Promise<ActivityResult | null> => {
      if (!LIVE_ACTIVITIES_SUPPORTED || !FranchiseLiveActivityModule || !userId) {
        return null;
      }

      try {
        const result: ActivityResult =
          await FranchiseLiveActivityModule.startMatchupActivity(
            {
              myTeamName: params.myTeamName,
              opponentTeamName: params.opponentTeamName,
              myTeamTricode: params.myTeamTricode,
              opponentTeamTricode: params.opponentTeamTricode,
              matchupId: params.matchupId,
              leagueId: params.leagueId,
            },
            params.initialState,
          );

        activeActivityRef.current = result.activityId;

        // Register the push token in Supabase
        if (result.pushToken) {
          await supabase.from('activity_tokens').insert({
            user_id: userId,
            team_id: params.teamId,
            activity_type: 'matchup' as const,
            push_token: result.pushToken,
            matchup_id: params.matchupId,
            schedule_id: params.scheduleId,
            league_id: params.leagueId,
          });
        }

        return result;
      } catch (err: any) {
        if (err?.code === 'DISABLED') {
          Alert.alert(
            'Live Activities Disabled',
            'Enable Live Activities for Franchise in your device settings to use this feature.',
            [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Open Settings', onPress: () => Linking.openSettings() },
            ],
          );
        } else {
          console.warn('Failed to start matchup activity:', err);
        }
        return null;
      }
    },
    [userId],
  );

  const endActivity = useCallback(
    async (activityId?: string) => {
      if (!LIVE_ACTIVITIES_SUPPORTED || !FranchiseLiveActivityModule || !userId) return;

      const id = activityId ?? activeActivityRef.current;
      if (!id) return;

      try {
        await FranchiseLiveActivityModule.endActivity(id);
        activeActivityRef.current = null;

        // Remove from Supabase
        await supabase
          .from('activity_tokens')
          .delete()
          .eq('user_id', userId);
      } catch {
        // Non-critical
      }
    },
    [userId],
  );

  const endAllActivities = useCallback(async () => {
    if (!LIVE_ACTIVITIES_SUPPORTED || !FranchiseLiveActivityModule || !userId) return;

    try {
      await FranchiseLiveActivityModule.endAllActivities();
      activeActivityRef.current = null;

      await supabase
        .from('activity_tokens')
        .delete()
        .eq('user_id', userId);
    } catch {
      // Non-critical
    }
  }, [userId]);

  const getActiveActivities = useCallback(async (): Promise<ActiveActivity[]> => {
    if (!LIVE_ACTIVITIES_SUPPORTED || !FranchiseLiveActivityModule) return [];

    try {
      return await FranchiseLiveActivityModule.getActiveActivities();
    } catch {
      return [];
    }
  }, []);

  return {
    isSupported: LIVE_ACTIVITIES_SUPPORTED && !!FranchiseLiveActivityModule,
    startMatchupActivity,
    endActivity,
    endAllActivities,
    getActiveActivities,
    activeActivityId: activeActivityRef.current,
  };
}
