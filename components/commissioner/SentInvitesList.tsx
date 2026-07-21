import { useQueryClient } from '@tanstack/react-query';
import { StyleSheet, TouchableOpacity, View } from 'react-native';

import { ThemedText } from '@/components/ui/ThemedText';
import { queryKeys } from '@/constants/queryKeys';
import { useConfirm } from '@/context/ConfirmProvider';
import { useToast } from '@/context/ToastProvider';
import { type InviteStatus, type LeagueInvite, useLeagueInvites } from '@/hooks/invites/useLeagueInvites';
import { useColors } from '@/hooks/useColors';
import { supabase } from '@/lib/supabase';
import { sendLeagueInvite } from '@/utils/league/sendLeagueInvite';
import { ms, s } from '@/utils/scale';

const STATUS_LABEL: Record<InviteStatus, string> = {
  pending: 'Pending',
  accepted: 'Joined',
  declined: 'Declined',
  cancelled: 'Cancelled',
};

/**
 * Commissioner's view of invites sent for a league: who was invited and whether
 * they've joined, with resend + cancel on the pending ones. RLS
 * (`is_league_commissioner`) grants the read; the two actions go through the
 * edge fn (resend) and `cancel_league_invite` RPC (cancel).
 */
export function SentInvitesList({ leagueId }: { leagueId: string }) {
  const c = useColors();
  const confirm = useConfirm();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const { invites, isLoading } = useLeagueInvites(leagueId);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.leagueInvites(leagueId) });

  const statusColor = (status: InviteStatus): string => {
    if (status === 'accepted') return c.success;
    if (status === 'declined') return c.secondaryText;
    return c.accent; // pending
  };

  const handleResend = async (invite: LeagueInvite) => {
    const result = await sendLeagueInvite({
      leagueId,
      email: invite.invited_email,
      teamId: invite.team_id ?? undefined,
    });
    if (result.status === 'error') {
      showToast('error', 'Could not resend the invite.');
      return;
    }
    if (result.status === 'no_account') {
      showToast('error', 'That email no longer has an account.');
      return;
    }
    showToast('success', `Invite resent to ${invite.invited_email}`);
    invalidate();
  };

  const handleCancel = (invite: LeagueInvite) => {
    confirm({
      title: 'Cancel invite?',
      message: `Cancel the invitation to ${invite.invited_email}?`,
      action: {
        label: 'Cancel Invite',
        destructive: true,
        onPress: async () => {
          const { data, error } = await supabase.rpc('cancel_league_invite', {
            p_invite_id: invite.id,
          });
          if (error || (data as { error?: string } | null)?.error) {
            showToast('error', 'Could not cancel the invite.');
            return;
          }
          invalidate();
        },
      },
    });
  };

  if (isLoading) return null;
  if (invites.length === 0) {
    return (
      <ThemedText style={[styles.empty, { color: c.secondaryText }]}>
        No invites sent yet.
      </ThemedText>
    );
  }

  return (
    <View accessibilityRole="list">
      {invites.map((invite, idx) => (
        <View
          key={invite.id}
          style={[styles.row, { borderTopColor: c.border }, idx === 0 && styles.firstRow]}
        >
          <View style={styles.info}>
            <ThemedText style={styles.email} numberOfLines={1}>
              {invite.invited_email}
            </ThemedText>
            <ThemedText style={[styles.status, { color: statusColor(invite.status) }]}>
              {STATUS_LABEL[invite.status]}
            </ThemedText>
          </View>
          {invite.status === 'pending' && (
            <View style={styles.actions}>
              <TouchableOpacity
                onPress={() => handleResend(invite)}
                style={[styles.actionBtn, { borderColor: c.border }]}
                accessibilityRole="button"
                accessibilityLabel={`Resend invite to ${invite.invited_email}`}
              >
                <ThemedText style={[styles.actionText, { color: c.accent }]}>Resend</ThemedText>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => handleCancel(invite)}
                style={[styles.actionBtn, { borderColor: c.border }]}
                accessibilityRole="button"
                accessibilityLabel={`Cancel invite to ${invite.invited_email}`}
              >
                <ThemedText style={[styles.actionText, { color: c.danger }]}>Cancel</ThemedText>
              </TouchableOpacity>
            </View>
          )}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  empty: {
    fontSize: ms(13),
    paddingVertical: s(10),
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: s(10),
    paddingVertical: s(12),
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  firstRow: {
    borderTopWidth: 0,
  },
  info: {
    flex: 1,
    minWidth: 0,
  },
  email: {
    fontSize: ms(14),
    fontWeight: '500',
  },
  status: {
    fontSize: ms(11),
    fontWeight: '600',
    letterSpacing: 0.4,
    marginTop: s(2),
    textTransform: 'uppercase',
  },
  actions: {
    flexDirection: 'row',
    gap: s(6),
  },
  actionBtn: {
    paddingHorizontal: s(10),
    paddingVertical: s(6),
    borderRadius: 7,
    borderWidth: 1,
  },
  actionText: {
    fontSize: ms(12),
    fontWeight: '600',
  },
});
