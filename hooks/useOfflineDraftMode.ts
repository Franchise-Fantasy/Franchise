import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert } from 'react-native';

import { queryKeys } from '@/constants/queryKeys';
import { useConfirm } from '@/context/ConfirmProvider';
import { sendNotification } from '@/lib/notifications';
import { supabase } from '@/lib/supabase';

type Args = {
  leagueId: string;
  leagueName: string;
  draftId: string | null;
  /** Commissioner's team id — the announcement is attributed to it. */
  commissionerTeamId: string | null;
};

/**
 * Commissioner toggle between an in-app and an offline rookie draft.
 *
 * Switching to offline clears any scheduled date (an offline draft has no
 * clock), posts a persistent commissioner announcement, and push-notifies the
 * league so members know results will be entered by hand. Switching back to
 * in-app just restores the normal Schedule/Enter flow — no announcement, since
 * nothing member-facing changed yet.
 */
export function useOfflineDraftMode({ leagueId, leagueName, draftId, commissionerTeamId }: Args) {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);

  async function setMode(offline: boolean) {
    if (!draftId) return;
    setBusy(true);
    try {
      const { error } = await supabase
        .from('drafts')
        .update(
          offline
            ? { is_offline: true, status: 'unscheduled', draft_date: null }
            : { is_offline: false },
        )
        .eq('id', draftId);
      if (error) throw error;

      if (offline) {
        const content =
          'The rookie draft is being held offline. The commissioner will enter the results in the app.';
        // Announcement + push are best-effort: the mode flip already committed
        // above, so a failed announcement must NOT report the whole toggle as
        // failed (which would misleadingly suggest the switch didn't happen).
        try {
          // Attributed to the commissioner's team; skip if they have none (rare)
          // and rely on the push alone.
          if (commissionerTeamId) {
            await supabase
              .from('commissioner_announcements')
              .insert({ league_id: leagueId, team_id: commissionerTeamId, content });
          }
          sendNotification({
            league_id: leagueId,
            category: 'draft',
            title: `${leagueName} — Rookie Draft Going Offline`,
            body: content,
            data: { screen: 'home' },
          });
          queryClient.invalidateQueries({ queryKey: ['announcements', leagueId] });
          queryClient.invalidateQueries({ queryKey: ['latestAnnouncement', leagueId] });
        } catch (announceErr) {
          console.warn('Offline-draft announcement failed (non-fatal):', announceErr);
        }
      }

      queryClient.invalidateQueries({ queryKey: queryKeys.activeDraft(leagueId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.league(leagueId) });
    } catch (err) {
      Alert.alert('Error', (err instanceof Error && err.message) || 'Failed to update draft mode');
    } finally {
      setBusy(false);
    }
  }

  const runOffline = () =>
    confirm({
      title: 'Run Draft Offline',
      message:
        'The rookie draft will be run offline. Any scheduled date is cleared, and you’ll enter the results by hand. League members will be notified. Continue?',
      action: { label: 'Run Offline', onPress: () => setMode(true) },
    });

  const switchToInApp = () =>
    confirm({
      title: 'Switch to In-App Draft',
      message: 'Run this rookie draft live in the app instead. You can schedule a date afterward. Continue?',
      action: { label: 'Use App', onPress: () => setMode(false) },
    });

  return { runOffline, switchToInApp, busy };
}
