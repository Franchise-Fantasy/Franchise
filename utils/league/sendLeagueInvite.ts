import { supabase } from '@/lib/supabase';

/**
 * Normalized outcome of a send-league-invite call. Callers own the UI (toast vs
 * alert, close/clear/invalidate); this collapses the invoke + error-context
 * parsing that was duplicated across the invite entry points (TeamAssigner,
 * InviteMembersSheet, SentInvitesList resend).
 *
 * - `notified`   — account-holder invited; a row was persisted + push queued.
 * - `no_account` — no Franchise account for that email (share-the-code fallback).
 * - `error`      — surfaced with the edge fn's specific message when available.
 */
export type InviteOutcome =
  | { status: 'notified' }
  | { status: 'no_account' }
  | { status: 'error'; message: string };

export async function sendLeagueInvite(params: {
  leagueId: string;
  email: string;
  /** Reserve a specific unclaimed imported team; omit for an open-league invite. */
  teamId?: string;
}): Promise<InviteOutcome> {
  try {
    const { data, error } = await supabase.functions.invoke('send-league-invite', {
      body: {
        league_id: params.leagueId,
        email: params.email.trim(),
        ...(params.teamId ? { team_id: params.teamId } : {}),
      },
    });
    if (error) {
      // Prefer the edge fn's specific message (league full, already a member,
      // already claimed, …) over the generic non-2xx wrapper.
      let message = error.message ?? 'Something went wrong.';
      try {
        const body = await error.context?.json?.();
        if (body?.error) message = body.error;
      } catch {
        // fall through with the generic message
      }
      return { status: 'error', message };
    }
    if ((data as { status?: string } | null)?.status === 'no_account') {
      return { status: 'no_account' };
    }
    return { status: 'notified' };
  } catch (err: any) {
    return { status: 'error', message: err?.message ?? 'Something went wrong.' };
  }
}
