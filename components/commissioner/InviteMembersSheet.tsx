import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { SentInvitesList } from '@/components/commissioner/SentInvitesList';
import { AppTextInput } from '@/components/ui/AppTextInput';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { LogoSpinner } from '@/components/ui/LogoSpinner';
import { ThemedText } from '@/components/ui/ThemedText';
import { queryKeys } from '@/constants/queryKeys';
import { useToast } from '@/context/ToastProvider';
import { useColors } from '@/hooks/useColors';
import { sendLeagueInvite } from '@/utils/league/sendLeagueInvite';
import { ms, s } from '@/utils/scale';

interface Props {
  leagueId: string;
  visible: boolean;
  onClose: () => void;
}

/**
 * Commissioner surface to invite members by email to any league. Invokes the
 * generalized send-league-invite edge fn (no team_id → open-league invite),
 * which persists an `invitations` record the invitee's home card reads and fires
 * a best-effort push. The persisted record is what makes the invite survive a
 * missed push. Also embeds the sent-invites list (resend / cancel).
 */
export function InviteMembersSheet({ leagueId, visible, onClose }: Props) {
  const c = useColors();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);

  const handleSend = async () => {
    const trimmed = email.trim();
    if (!trimmed || sending) return;
    setSending(true);
    try {
      const result = await sendLeagueInvite({ leagueId, email: trimmed });
      if (result.status === 'error') {
        showToast('error', result.message);
        return;
      }
      if (result.status === 'no_account') {
        showToast('error', `No Franchise account for ${trimmed} yet — share your invite code so they can sign up.`);
        return;
      }
      showToast('success', `Invite sent to ${trimmed}`);
      setEmail('');
      queryClient.invalidateQueries({ queryKey: queryKeys.leagueInvites(leagueId) });
    } finally {
      setSending(false);
    }
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Invite Members"
      subtitle="INVITE BY EMAIL"
      keyboardAvoiding
    >
      <ThemedText style={[styles.desc, { color: c.secondaryText }]}>
        Invite someone who already has a Franchise account. They'll get a
        notification and an invite card on their home screen.
      </ThemedText>

      <View style={styles.inviteRow}>
        <AppTextInput
          style={[styles.emailInput, { color: c.text, borderColor: c.border, backgroundColor: c.cardAlt }]}
          value={email}
          onChangeText={setEmail}
          placeholder="name@email.com"
          placeholderTextColor={c.secondaryText}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          editable={!sending}
          returnKeyType="send"
          onSubmitEditing={handleSend}
          accessibilityLabel="Invitee email address"
        />
        <TouchableOpacity
          style={[styles.sendBtn, { backgroundColor: c.accent }, (!email.trim() || sending) && styles.sendBtnDisabled]}
          onPress={handleSend}
          disabled={!email.trim() || sending}
          accessibilityRole="button"
          accessibilityLabel="Send invite"
        >
          {sending ? (
            <LogoSpinner size={16} />
          ) : (
            <Text style={[styles.sendBtnText, { color: c.statusText }]}>Send</Text>
          )}
        </TouchableOpacity>
      </View>

      <ThemedText style={[styles.listHeader, { color: c.secondaryText }]} accessibilityRole="header">
        SENT INVITES
      </ThemedText>
      <SentInvitesList leagueId={leagueId} />
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  desc: {
    fontSize: ms(13),
    lineHeight: ms(18),
    marginBottom: s(14),
  },
  inviteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(8),
  },
  emailInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: s(12),
    paddingVertical: s(10),
    fontSize: ms(14),
  },
  sendBtn: {
    paddingHorizontal: s(16),
    paddingVertical: s(11),
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: s(60),
  },
  sendBtnDisabled: {
    opacity: 0.5,
  },
  sendBtnText: {
    fontSize: ms(14),
    fontWeight: '600',
  },
  listHeader: {
    fontSize: ms(11),
    letterSpacing: 1,
    fontWeight: '600',
    marginTop: s(22),
    marginBottom: s(4),
  },
});
