import * as Crypto from 'expo-crypto';
import type { EventSubscription } from 'expo-modules-core';
import type { LiveActivity } from 'expo-widgets';
import { useCallback, useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';

import { logger } from '@/utils/logger';

import { supabase } from '../lib/supabase';
import { MatchupActivity, type MatchupActivityProps, type MatchupCategoryLine, type MatchupPlayerLine } from '../widgets/MatchupActivity';

const LIVE_ACTIVITIES_SUPPORTED =
  Platform.OS === 'ios' && parseInt(String(Platform.Version), 10) >= 16;

interface MatchupActivityParams {
  mode: 'points' | 'categories';
  myTeamName: string;
  opponentTeamName: string;
  myTeamTricode: string;
  opponentTeamTricode: string;
  matchupId: string;
  leagueId: string;
  scheduleId: string;
  teamId: string;
  myLogoPath?: string;
  opponentLogoPath?: string;
  appGroupPath?: string;
  initialState: {
    myScore: number;
    opponentScore: number;
    scoreGap: number;
    winProbability?: number;
    biggestContributor: string;
    myActivePlayers: number;
    opponentActivePlayers: number;
    players: MatchupPlayerLine[];
    categories?: MatchupCategoryLine[];
    catTies?: number;
  };
}

interface ActivityResult {
  activityId: string;
  pushToken: string | null;
}

/**
 * iOS Live Activities (Dynamic Island + Lock Screen) for the matchup screen.
 * Defines the UI in JS via expo-widgets — see widgets/MatchupActivity.tsx.
 *
 * The `activityId` returned to callers is a JS-generated UUID, not an iOS Activity.id.
 * Backend pushes are keyed by the APNs push_token stored in activity_tokens, not by
 * this id. The id only exists so callers can toggle / track open activities.
 */
export function useLiveActivity(userId?: string) {
  const activeInstanceRef = useRef<LiveActivity<MatchupActivityProps> | null>(null);
  const activeActivityIdRef = useRef<string | null>(null);
  const tokenSubscriptionRef = useRef<EventSubscription | null>(null);

  // Foreground reconcile — clean up DB row if the activity was dismissed externally
  useEffect(() => {
    if (!LIVE_ACTIVITIES_SUPPORTED || !userId) return;

    const sub = AppState.addEventListener('change', async (state) => {
      if (state !== 'active') return;
      if (!activeActivityIdRef.current) return;

      try {
        const instances = MatchupActivity.getInstances();
        if (instances.length === 0) {
          await supabase.from('activity_tokens').delete().eq('user_id', userId);
          activeInstanceRef.current = null;
          activeActivityIdRef.current = null;
          tokenSubscriptionRef.current?.remove();
          tokenSubscriptionRef.current = null;
        }
      } catch {
        // non-critical
      }
    });

    return () => sub.remove();
  }, [userId]);

  // Remove any push-token subscription on unmount
  useEffect(() => {
    return () => {
      tokenSubscriptionRef.current?.remove();
      tokenSubscriptionRef.current = null;
    };
  }, []);

  const startMatchupActivity = useCallback(
    async (params: MatchupActivityParams): Promise<ActivityResult | null> => {
      if (!LIVE_ACTIVITIES_SUPPORTED || !userId) return null;

      try {
        const initialProps: MatchupActivityProps = {
          mode: params.mode,
          myTeamName: params.myTeamName,
          opponentTeamName: params.opponentTeamName,
          myTeamTricode: params.myTeamTricode,
          opponentTeamTricode: params.opponentTeamTricode,
          myScore: params.initialState.myScore,
          opponentScore: params.initialState.opponentScore,
          scoreGap: params.initialState.scoreGap,
          winProbability: params.initialState.winProbability,
          biggestContributor: params.initialState.biggestContributor,
          myActivePlayers: params.initialState.myActivePlayers,
          opponentActivePlayers: params.initialState.opponentActivePlayers,
          players: params.initialState.players,
          categories: params.initialState.categories,
          catTies: params.initialState.catTies,
          myLogoPath: params.myLogoPath,
          opponentLogoPath: params.opponentLogoPath,
          appGroupPath: params.appGroupPath,
        };

        const instance = MatchupActivity.start(initialProps);
        const activityId = Crypto.randomUUID();
        activeInstanceRef.current = instance;
        activeActivityIdRef.current = activityId;

        const pushToken = await instance.getPushToken();
        if (pushToken) {
          await supabase.from('activity_tokens').insert({
            user_id: userId,
            team_id: params.teamId,
            activity_type: 'matchup',
            push_token: pushToken,
            matchup_id: params.matchupId,
            schedule_id: params.scheduleId,
            league_id: params.leagueId,
          });
        }

        // Apple may rotate the per-activity token; persist new value to keep APNs in sync.
        tokenSubscriptionRef.current?.remove();
        tokenSubscriptionRef.current = instance.addPushTokenListener(async ({ pushToken: nextToken }) => {
          if (!nextToken) return;
          try {
            await supabase
              .from('activity_tokens')
              .update({ push_token: nextToken })
              .eq('user_id', userId)
              .eq('matchup_id', params.matchupId)
              .eq('stale', false)
              .neq('push_token', nextToken);
          } catch (err) {
            logger.warn('Failed to persist rotated Live Activity token', err);
          }
        });

        return { activityId, pushToken };
      } catch (err) {
        logger.warn('Failed to start matchup activity', err);
        return null;
      }
    },
    [userId]
  );

  const endActivity = useCallback(
    async (_activityId?: string) => {
      if (!LIVE_ACTIVITIES_SUPPORTED || !userId) return;
      const instance = activeInstanceRef.current;
      if (!instance) return;

      try {
        await instance.end('immediate');
        activeInstanceRef.current = null;
        activeActivityIdRef.current = null;
        tokenSubscriptionRef.current?.remove();
        tokenSubscriptionRef.current = null;
        await supabase.from('activity_tokens').delete().eq('user_id', userId);
      } catch (err) {
        logger.warn('Failed to end matchup activity', err);
      }
    },
    [userId]
  );

  const endAllActivities = useCallback(async () => {
    if (!LIVE_ACTIVITIES_SUPPORTED || !userId) return;
    try {
      const instances = MatchupActivity.getInstances();
      await Promise.all(instances.map((inst) => inst.end('immediate')));
      activeInstanceRef.current = null;
      activeActivityIdRef.current = null;
      tokenSubscriptionRef.current?.remove();
      tokenSubscriptionRef.current = null;
      await supabase.from('activity_tokens').delete().eq('user_id', userId);
    } catch (err) {
      logger.warn('Failed to end all matchup activities', err);
    }
  }, [userId]);

  return {
    isSupported: LIVE_ACTIVITIES_SUPPORTED,
    startMatchupActivity,
    endActivity,
    endAllActivities,
    activeActivityId: activeActivityIdRef.current,
  };
}
