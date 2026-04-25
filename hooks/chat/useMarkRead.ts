import { useAppState } from '@/context/AppStateProvider';
import { queryKeys } from '@/constants/queryKeys';
import { posthog } from '@/lib/posthog';
import { supabase } from '@/lib/supabase';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

// ─── Mark read ───────────────────────────────────────────────

export function useMarkRead(
  conversationId: string | null,
  teamId: string | null,
  newestMessageId: string | null,
  /** Server-generated created_at of the newest message — used as last_read_at to avoid client/server clock skew. */
  newestMessageCreatedAt: string | null,
  /** Callback to broadcast updated read position via presence */
  onReadUpdate?: ((messageId: string) => void) | null,
) {
  const queryClient = useQueryClient();
  const { leagueId } = useAppState();
  const lastMarkedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!conversationId || !teamId || !newestMessageId || !newestMessageCreatedAt) return;
    if (newestMessageId.startsWith('temp-')) return;
    // Don't re-mark the same message
    if (lastMarkedRef.current === newestMessageId) return;
    lastMarkedRef.current = newestMessageId;

    let cancelled = false;

    // Persist to DB. Use the message's own server timestamp for last_read_at so
    // unread comparisons (msg.created_at > last_read_at) are not thrown off by
    // client/server clock skew — without this, a newly arrived message can stay
    // flagged as unread even after the user has clearly seen it.
    supabase
      .from('chat_members')
      .update({
        last_read_at: newestMessageCreatedAt,
        last_read_message_id: newestMessageId,
      })
      .eq('conversation_id', conversationId)
      .eq('team_id', teamId)
      .then((res) => {
        if (cancelled) return;
        if (res.error) throw res.error;
        queryClient.invalidateQueries({ queryKey: queryKeys.conversations(leagueId!) });
        queryClient.invalidateQueries({ queryKey: queryKeys.chatUnread(leagueId!) });
      }, (err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        console.warn('useMarkRead update failed:', message);
        posthog.capture('$exception', {
          $exception_message: message,
          $exception_type: 'ChatMarkReadError',
          source: 'useMarkRead',
        });
      });

    // Broadcast via presence channel for instant updates
    onReadUpdate?.(newestMessageId);

    return () => {
      cancelled = true;
    };
    // queryClient is a stable singleton; onReadUpdate should be memoized upstream.
    // newestMessageCreatedAt is intentionally omitted: it's deterministically tied to
    // newestMessageId, and including it would re-fire the effect if a server-clamped
    // timestamp ever shifted on refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, teamId, newestMessageId, leagueId, onReadUpdate]);
}
