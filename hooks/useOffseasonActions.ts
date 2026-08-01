import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';

import { queryKeys } from '@/constants/queryKeys';
import { useConfirm } from '@/context/ConfirmProvider';
import { supabase } from '@/lib/supabase';
import { fetchLeagueCutsPlans, type TeamCutsPlan } from '@/utils/roster/rosterCuts';

type Args = {
  leagueId: string;
  season: string;
  /** Drives the season-close copy — redraft/keeper go dormant rather than
   *  entering an offseason. Defaults to dynasty's wording. */
  leagueType?: string;
};

/**
 * Pull the real reason out of a FunctionsHttpError body (e.g. a stale season
 * start date, or the roster-cap 409) instead of the generic non-2xx message.
 */
async function functionErrorDetail(err: unknown, fallback: string): Promise<string> {
  let detail = (err instanceof Error && err.message) || fallback;
  try {
    const body = await (err as { context?: Response }).context?.json?.();
    if (body?.error) detail = body.error;
  } catch {
    // Body wasn't JSON or context unavailable — keep the fallback.
  }
  return detail;
}

/**
 * Offseason action handlers — drives the home hero's contextual action
 * pill (Enter Lottery / Finalize Keepers / Create Draft / Start Season).
 * Each handler manages its own Alert flow + Supabase mutation + query
 * invalidation. The returned `loading` flag reflects whichever action
 * is in flight.
 */
export function useOffseasonActions({ leagueId, season, leagueType }: Args) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const confirm = useConfirm();
  const [loading, setLoading] = useState(false);
  // Drives the full-screen BusyOverlay so commissioner actions (which fire slow
  // edge functions) give unmissable feedback instead of a silent corner pill.
  const [loadingLabel, setLoadingLabel] = useState<string | null>(null);

  const goToLotteryRoom = () => {
    router.push('/lottery-room' as never);
  };

  // Close out the season. Fires the `advance-season` edge function, which
  // archives stats, clears pending moves, and sets `offseason_step`.
  //
  // Redraft/keeper get different copy because they get a different outcome:
  // rosters are cleared and the league goes dormant until its rookie class
  // lands, rather than entering an offseason with work to do.
  const isRedraftLike = leagueType === 'redraft' || leagueType === 'keeper';
  const advanceSeason = () => {
    confirm({
      title: isRedraftLike ? 'Close Out the Season' : 'Advance to Offseason',
      message: isRedraftLike
        ? "This will:\n\n- Archive this season's stats\n- Reset W/L records\n- Clear every roster\n- Cancel pending trades, waivers, & queued moves\n\nThe league then sits between seasons — history stays viewable — and reopens on its own for the next draft.\n\nThis cannot be undone. Continue?"
        : "This will:\n\n- Archive this season's stats\n- Reset W/L records\n- Cancel pending trades, waivers, & queued moves\n- Begin the offseason process\n\nThis cannot be undone. Continue?",
      action: {
        label: isRedraftLike ? 'Close Out' : 'Advance',
        destructive: true,
        onPress: async () => {
          setLoading(true);
          setLoadingLabel(
            isRedraftLike ? 'Closing out the season…' : 'Starting the offseason…',
          );
          try {
            const { error } = await supabase.functions.invoke('advance-season', {
              body: { league_id: leagueId },
            });
            if (error) throw error;
            queryClient.invalidateQueries({ queryKey: queryKeys.league(leagueId) });
            // The offseason just opened: the draft hub + home lottery card read
            // the picks/standings advance-season just archived. Without these
            // they serve a stale per-league cache (e.g. last season's view).
            queryClient.invalidateQueries({ queryKey: queryKeys.draftHub(leagueId) });
            queryClient.invalidateQueries({ queryKey: ['offseasonLotteryOrder', leagueId] });
            // No success popup — the BusyOverlay carried the feedback and the
            // home now reflects the offseason. A native alert here just adds a
            // tap.
          } catch (err: unknown) {
            Alert.alert(
              'Error',
              (err instanceof Error && err.message) || 'Failed to advance season',
            );
          } finally {
            setLoading(false);
            setLoadingLabel(null);
          }
        },
      },
    });
  };

  const handleCreateRookieDraft = async () => {
    // Every team must have a roster before the rookie draft can be created.
    // Imported leagues can be created with "finish rosters later" placeholder
    // teams (0 league_players); seeding a rookie draft on top of empty rosters
    // produces a broken dynasty. Fast client pre-check for a clear message —
    // create-rookie-draft enforces the same gate authoritatively.
    const { data } = await supabase
      .from('teams')
      .select('name, league_players:league_players!league_players_team_id_fkey(count)')
      .eq('league_id', leagueId);
    const teams = (data ?? []) as { name: string; league_players?: { count: number }[] }[];
    const missing = teams
      .filter((t) => (t.league_players?.[0]?.count ?? 0) === 0)
      .map((t) => t.name);
    if (missing.length > 0) {
      Alert.alert(
        'Rosters Not Imported',
        `These teams still need their rosters imported before the rookie draft can be created:\n\n${missing.join('\n')}`,
      );
      return;
    }

    setLoading(true);
    setLoadingLabel('Creating the rookie draft…');
    try {
      const { error } = await supabase.functions.invoke('create-rookie-draft', {
        body: { league_id: leagueId },
      });
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: queryKeys.league(leagueId) });
      queryClient.invalidateQueries({ queryKey: ['rookieDraft', leagueId] });
      queryClient.invalidateQueries({ queryKey: queryKeys.activeDraft(leagueId) });
      // Flip the draft hub + home lottery card + resolution overview off the
      // cached pre-lottery "odds" view now that the resolution is committed.
      queryClient.invalidateQueries({ queryKey: queryKeys.draftHub(leagueId) });
      queryClient.invalidateQueries({ queryKey: ['offseasonLotteryOrder', leagueId] });
      queryClient.invalidateQueries({ queryKey: ['lotteryResolution', leagueId] });
      Alert.alert('Rookie Draft Created', 'Schedule the date to begin.');
    } catch (err: unknown) {
      Alert.alert(
        'Error',
        (err instanceof Error && err.message) || 'Failed to create rookie draft',
      );
    } finally {
      setLoading(false);
      setLoadingLabel(null);
    }
  };

  const handleFinalizeKeepers = () => {
    confirm({
      title: 'Finalize Keepers',
      message: 'This will release all non-kept players to free agency. This cannot be undone.',
      action: {
        label: 'Finalize',
        destructive: true,
        onPress: async () => {
          setLoading(true);
          setLoadingLabel('Finalizing keepers…');
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
            setLoadingLabel(null);
          }
        },
      },
    });
  };

  // A redraft/keeper league's season draft is built server-side by
  // `open-draft-season` when the incoming rookie class lands — the commissioner
  // has no Create Draft step. The old client-side version inserted a bare
  // `drafts` row with no draft_picks, `rounds` set to the team count, and a
  // null `picks_per_round`, which made every pick fail with "Draft is already
  // complete." Don't reintroduce it.

  const startSeason = async () => {
    setLoading(true);
    setLoadingLabel('Starting the season…');
    try {
      const { error } = await supabase.functions.invoke('generate-schedule', {
        body: { league_id: leagueId },
      });
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: queryKeys.league(leagueId) });
    } catch (err: unknown) {
      Alert.alert('Error', await functionErrorDetail(err, 'Failed to start season'));
    } finally {
      setLoading(false);
      setLoadingLabel(null);
    }
  };

  const handleStartNewSeason = async () => {
    // Starting the season NEVER blocks on roster size and never cuts anyone.
    // Rookie drafts don't enforce the cap, so teams can cross into the season
    // over it — the app already tolerates that state (the over-cap lock gates
    // their adds and lineup edits until they fix it), and the cuts deadline is
    // the one thing that resolves it, on its own date, season or not.
    //
    // So the only job here is to tell the commissioner what's outstanding.
    let overCapPlans: TeamCutsPlan[] = [];
    try {
      overCapPlans = await fetchLeagueCutsPlans(leagueId);
    } catch (err) {
      // Advisory only — never let a failed roster read block the season.
      console.warn('roster cuts pre-check failed:', err);
    }

    const overCapNote =
      overCapPlans.length > 0
        ? `\n\n${overCapPlans.length} team${overCapPlans.length === 1 ? ' is' : 's are'} still over the roster cap:\n${overCapPlans
            .map((p) => `  ${p.teamName} (${p.activeCount}/${p.rosterSize})`)
            .join('\n')}\n\nThat's fine — they can start the season over the cap. Their roster moves stay locked until they trim, and anyone still over on the cuts deadline is trimmed automatically.`
        : '';

    confirm({
      title: 'Start New Season',
      message: `This will generate the schedule for ${season} and begin the new season.${overCapNote}\n\nContinue?`,
      action: { label: 'Start Season', onPress: startSeason },
    });
  };

  return {
    loading,
    loadingLabel,
    goToLotteryRoom,
    advanceSeason,
    handleCreateRookieDraft,
    handleFinalizeKeepers,
    handleStartNewSeason,
  };
}
