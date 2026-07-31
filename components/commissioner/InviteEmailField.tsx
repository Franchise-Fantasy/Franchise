/**
 * Email row that sends a league invite — the single entry point for
 * "invite <email> to this league" across every commissioner surface.
 *
 * Two shapes, distinguished only by `teamId`: without one it's an
 * open-league invite (the invitee creates a team); with one it reserves a
 * specific unclaimed team (the invitee lands in the claim flow and takes that
 * roster over). The second shape is what replaced the old instant
 * `transfer_team_ownership` RPC — same outcome, but the new owner has to
 * accept, and they get told it happened.
 *
 * Owns its own email + sending state so callers only supply the target and
 * react to `onSent`. The input opts out of AppTextInput's "Done" accessory:
 * its transparent band punches a visible hole between a raised BottomSheet and
 * the keyboard, and the "send" return key already dismisses.
 */
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Keyboard, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { AppTextInput } from '@/components/ui/AppTextInput';
import { LogoSpinner } from '@/components/ui/LogoSpinner';
import { queryKeys } from '@/constants/queryKeys';
import { useToast } from '@/context/ToastProvider';
import { useColors } from '@/hooks/useColors';
import { sendLeagueInvite } from '@/utils/league/sendLeagueInvite';
import { ms, s } from '@/utils/scale';

interface Props {
  leagueId: string;
  /** Reserve a specific unclaimed team. Omit for an open-league invite. */
  teamId?: string;
  /** Names the reservation target in the send button's accessibility label. */
  targetLabel?: string;
  /** Fired after a successful send — clear a selection, close a modal, etc. */
  onSent?: () => void;
}

export function InviteEmailField({ leagueId, teamId, targetLabel, onSent }: Props) {
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
      const result = await sendLeagueInvite({ leagueId, email: trimmed, teamId });
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
      onSent?.();
    } finally {
      setSending(false);
    }
  };

  // With no accessory bar the return key is the only keyboard-dismiss
  // affordance, so with nothing to send it has to put the keyboard away.
  const handleSubmitEditing = () => {
    if (email.trim()) handleSend();
    else Keyboard.dismiss();
  };

  return (
    <View style={styles.row}>
      <AppTextInput
        style={[styles.input, { color: c.text, borderColor: c.border, backgroundColor: c.cardAlt }]}
        value={email}
        onChangeText={setEmail}
        placeholder="name@email.com"
        placeholderTextColor={c.secondaryText}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        keyboardType="email-address"
        editable={!sending}
        returnKeyType="send"
        onSubmitEditing={handleSubmitEditing}
        hideAccessory
        accessibilityLabel="Invitee email address"
      />
      <TouchableOpacity
        style={[styles.sendBtn, { backgroundColor: c.accent }, (!email.trim() || sending) && styles.sendBtnDisabled]}
        onPress={handleSend}
        disabled={!email.trim() || sending}
        accessibilityRole="button"
        accessibilityLabel={targetLabel ? `Send invite for ${targetLabel}` : 'Send invite'}
      >
        {sending ? (
          <LogoSpinner size={16} />
        ) : (
          <Text style={[styles.sendBtnText, { color: c.statusText }]}>Send</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(8),
  },
  input: {
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
});
