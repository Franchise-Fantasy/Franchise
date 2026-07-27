import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';

import { ThemedText } from '@/components/ui/ThemedText';
import { queryKeys } from '@/constants/queryKeys';
import { useSession } from '@/context/AuthProvider';
import { useConfirm } from '@/context/ConfirmProvider';
import { useToast } from '@/context/ToastProvider';
import { type MyInvite, useMyInvites } from '@/hooks/invites/useMyInvites';
import { useColors } from '@/hooks/useColors';
import { supabase } from '@/lib/supabase';
import { resolveJoinRoute } from '@/utils/league/resolveJoinRoute';
import { ms, s } from '@/utils/scale';

/**
 * Home-screen surface for league invitations addressed to the signed-in user.
 * Cross-league (the invitee isn't in these leagues yet), so it sits above the
 * single-league hero as its own card. This is the durable in-app record that
 * makes an invite recoverable when the best-effort push is missed.
 *
 * Join routes into the existing membership flow — the claim flow for imported
 * leagues (pick the reserved team) or create-team for open leagues. The
 * `teams_auto_accept_invite` trigger flips the invite to accepted the moment
 * the membership commits, so the card clears itself on the next refetch.
 */
export function PendingInvitesCard() {
  const c = useColors();
  const router = useRouter();
  const confirm = useConfirm();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const session = useSession();
  const { invites } = useMyInvites();
  // The preflight is a network round-trip, so without this a double-tap fires
  // two navigations and stacks the claim screen on itself.
  const [joiningId, setJoiningId] = useState<string | null>(null);

  if (invites.length === 0) return null;

  const handleJoin = async (invite: MyInvite) => {
    if (!session?.user?.id || joiningId) return;
    setJoiningId(invite.id);
    // Same preflight the invite-code screen runs — the card used to route on
    // `imported_from` alone, so a stale invite could land the user on an empty
    // claim list or in a league that had filled up since the invite was sent.
    // It also forwards the reserved team so they claim the right roster.
    try {
      const route = await resolveJoinRoute({
        leagueId: invite.league_id,
        userId: session.user.id,
        reservedTeamId: invite.team_id,
      });

      if (!route.ok) {
        showToast('error', route.message);
        // The invite may have been auto-accepted already (they joined by code
        // in the meantime), in which case a refetch clears the stale card.
        queryClient.invalidateQueries({ queryKey: queryKeys.myInvites(session.user.id) });
        return;
      }

      router.push({ pathname: route.pathname, params: route.params } as never);
    } finally {
      setJoiningId(null);
    }
  };

  const handleDecline = (invite: MyInvite) => {
    confirm({
      title: 'Decline invite?',
      message: `Decline your invitation to ${invite.league.name}?`,
      action: {
        label: 'Decline',
        destructive: true,
        onPress: async () => {
          const { data, error } = await supabase.rpc('respond_to_league_invite', {
            p_invite_id: invite.id,
            p_action: 'decline',
          });
          if (error || (data as { error?: string } | null)?.error) {
            showToast('error', 'Could not decline the invite. Try again.');
            return;
          }
          if (session?.user?.id) {
            queryClient.invalidateQueries({ queryKey: queryKeys.myInvites(session.user.id) });
          }
        },
      },
    });
  };

  return (
    <View
      style={[styles.card, { backgroundColor: c.card, borderColor: c.border, borderLeftColor: c.accent }]}
      accessibilityRole="summary"
    >
      <View style={styles.header}>
        <Ionicons name="mail-unread-outline" size={ms(18)} color={c.accent} accessible={false} />
        <ThemedText type="defaultSemiBold" style={styles.headerText} accessibilityRole="header">
          {invites.length === 1 ? "You're invited" : `${invites.length} league invites`}
        </ThemedText>
      </View>

      {invites.map((invite, idx) => (
        <View
          key={invite.id}
          style={[styles.row, { borderTopColor: c.border }, idx === 0 && styles.firstRow]}
        >
          <View style={styles.info}>
            <ThemedText type="defaultSemiBold" style={styles.leagueName} numberOfLines={1}>
              {invite.league.name}
            </ThemedText>
            <ThemedText style={[styles.sub, { color: c.secondaryText }]} numberOfLines={1}>
              {invite.team_id ? 'A team is reserved for you' : "You've been invited to join"}
            </ThemedText>
          </View>
          <View style={styles.actions}>
            <TouchableOpacity
              onPress={() => handleDecline(invite)}
              style={[styles.declineBtn, { borderColor: c.border }]}
              accessibilityRole="button"
              accessibilityLabel={`Decline invite to ${invite.league.name}`}
            >
              <ThemedText style={[styles.declineText, { color: c.secondaryText }]}>Decline</ThemedText>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => handleJoin(invite)}
              disabled={joiningId !== null}
              style={[
                styles.joinBtn,
                { backgroundColor: c.accent },
                joiningId !== null && styles.joinBtnDisabled,
              ]}
              accessibilityRole="button"
              accessibilityLabel={`Join ${invite.league.name}`}
              accessibilityState={{ disabled: joiningId !== null, busy: joiningId === invite.id }}
            >
              <ThemedText style={[styles.joinText, { color: c.statusText }]}>
                {joiningId === invite.id ? 'Joining…' : 'Join'}
              </ThemedText>
            </TouchableOpacity>
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
    borderWidth: 1,
    borderLeftWidth: 3,
    padding: s(14),
    marginBottom: s(16),
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(8),
    marginBottom: s(6),
  },
  headerText: {
    fontSize: ms(15),
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: s(10),
    paddingTop: s(12),
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: s(6),
  },
  firstRow: {
    borderTopWidth: 0,
    marginTop: s(2),
    paddingTop: s(6),
  },
  info: {
    flex: 1,
    minWidth: 0,
  },
  leagueName: {
    fontSize: ms(15),
  },
  sub: {
    fontSize: ms(12),
    marginTop: s(1),
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(8),
  },
  declineBtn: {
    paddingHorizontal: s(12),
    paddingVertical: s(8),
    borderRadius: 8,
    borderWidth: 1,
  },
  declineText: {
    fontSize: ms(13),
    fontWeight: '600',
  },
  joinBtn: {
    paddingHorizontal: s(16),
    paddingVertical: s(8),
    borderRadius: 8,
  },
  joinBtnDisabled: {
    opacity: 0.5,
  },
  joinText: {
    fontSize: ms(13),
    fontWeight: '700',
  },
});
