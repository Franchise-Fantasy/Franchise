import { ThemedText } from '@/components/ui/ThemedText';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { ms, s } from '@/utils/scale';
import { Ionicons } from '@expo/vector-icons';
import { Alert, StyleSheet, TouchableOpacity, View } from 'react-native';
import { LogoSpinner } from '@/components/ui/LogoSpinner';

interface TradeActionBarProps {
  processing: boolean;
  status: string;
  isInvolved: boolean;
  isProposer: boolean;
  isEditable: boolean;
  isCommissioner: boolean;
  myTeamStatus?: string;
  hasVoted: boolean;
  vetoType?: string | null;
  showDropPicker: boolean;
  dropsReady: boolean;
  needsMyDrop: boolean;
  canLeak: boolean;
  onAccept: () => void;
  onReject: () => void;
  onCancel: () => void;
  onEdit: (() => void) | undefined;
  onCounteroffer: (() => void) | undefined;
  onCommissionerApprove: () => void;
  onCommissionerVeto: () => void;
  onVoteToVeto: () => void;
  onSubmitDrop: () => void;
  onLeakToChat: () => void;
}

export function TradeActionBar({
  processing,
  status,
  isInvolved,
  isProposer,
  isEditable,
  isCommissioner,
  myTeamStatus,
  hasVoted,
  vetoType,
  showDropPicker,
  dropsReady,
  needsMyDrop,
  canLeak,
  onAccept,
  onReject,
  onCancel,
  onEdit,
  onCounteroffer,
  onCommissionerApprove,
  onCommissionerVeto,
  onVoteToVeto,
  onSubmitDrop,
  onLeakToChat,
}: TradeActionBarProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  if (processing) {
    return (
      <View style={[styles.bar, { borderTopColor: c.border }]}>
        <LogoSpinner size={18} />
      </View>
    );
  }

  // Pending drops: my team needs to select a drop
  if (needsMyDrop) {
    return (
      <View style={[styles.bar, { borderTopColor: c.border }]}>
        <ActionButton
          label="Confirm Drop"
          icon="checkmark-circle"
          color={dropsReady ? c.success : c.secondaryText}
          disabled={!dropsReady}
          onPress={() => Alert.alert(
            'Confirm Drop',
            'Drop the selected player and complete the trade?',
            [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Confirm', onPress: onSubmitDrop },
            ],
          )}
          primary
        />
      </View>
    );
  }

  // Pending: counterparty can accept/reject
  if (status === 'pending' && isInvolved && !isProposer && myTeamStatus === 'pending') {
    return (
      <View style={[styles.bar, { borderTopColor: c.border }]}>
        {/* Primary action: Accept */}
        {showDropPicker ? (
          <ActionButton
            label="Accept & Drop"
            icon="checkmark-circle"
            color={dropsReady ? c.success : c.secondaryText}
            disabled={!dropsReady}
            onPress={() => Alert.alert(
              'Accept Trade',
              'Accept this trade and drop the selected player?',
              [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Accept', onPress: onAccept },
              ],
            )}
            primary
          />
        ) : (
          <ActionButton
            label="Accept"
            icon="checkmark-circle"
            color={c.success}
            onPress={() => Alert.alert('Accept Trade', 'Accept this trade?', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Accept', onPress: onAccept },
            ])}
            primary
          />
        )}

        {/* Secondary row */}
        <View style={styles.secondaryRow}>
          {onCounteroffer && (
            <ActionButton
              label="Counter"
              icon="swap-horizontal"
              color={c.warning}
              onPress={onCounteroffer}
            />
          )}
          <ActionButton
            label="Decline"
            icon="close-circle"
            color={c.danger}
            onPress={() => Alert.alert('Decline Trade', 'Decline this trade?', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Decline', style: 'destructive', onPress: onReject },
            ])}
          />
        </View>

        {/* Leak button */}
        {canLeak && <LeakButton onPress={onLeakToChat} />}
      </View>
    );
  }

  // Pending: proposer can edit/cancel, or teams that already accepted can back out
  if (status === 'pending' && isInvolved && (isProposer || myTeamStatus === 'accepted')) {
    return (
      <View style={[styles.bar, { borderTopColor: c.border }]}>
        <View style={styles.secondaryRow}>
          {isEditable && onEdit && (
            <ActionButton
              label="Edit"
              icon="create-outline"
              color={c.link}
              onPress={onEdit}
            />
          )}
          <ActionButton
            label={isProposer ? 'Withdraw' : 'Back Out'}
            icon="arrow-undo"
            color={c.secondaryText}
            onPress={() => Alert.alert(
              isProposer ? 'Withdraw Trade' : 'Back Out',
              isProposer
                ? 'Withdraw this trade proposal?'
                : 'Back out and cancel this trade for all parties?',
              [
                { text: 'No', style: 'cancel' },
                { text: isProposer ? 'Withdraw' : 'Back Out', style: 'destructive', onPress: onCancel },
              ],
            )}
          />
        </View>

        {canLeak && <LeakButton onPress={onLeakToChat} />}
      </View>
    );
  }

  // In review: commissioner approve/veto
  if (status === 'in_review' && isCommissioner) {
    return (
      <View style={[styles.bar, { borderTopColor: c.border }]}>
        <View style={styles.secondaryRow}>
          <ActionButton
            label="Approve"
            icon="checkmark-circle"
            color={c.success}
            onPress={() => Alert.alert('Approve Trade', 'Approve and execute this trade now?', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Approve', onPress: onCommissionerApprove },
            ])}
          />
          <ActionButton
            label="Veto"
            icon="ban"
            color={c.danger}
            onPress={() => Alert.alert('Veto Trade', 'Veto this trade?', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Veto', style: 'destructive', onPress: onCommissionerVeto },
            ])}
          />
        </View>
      </View>
    );
  }

  // In review: league vote
  if (status === 'in_review' && vetoType === 'league_vote' && !isCommissioner && !isInvolved) {
    if (hasVoted) {
      return (
        <View style={[styles.bar, { borderTopColor: c.border }]}>
          <View style={[styles.votedBanner, { backgroundColor: c.cardAlt }]}>
            <Ionicons name="checkmark-circle" size={16} color={c.secondaryText} />
            <ThemedText style={[styles.votedText, { color: c.secondaryText }]}>You voted to veto</ThemedText>
          </View>
        </View>
      );
    }
    return (
      <View style={[styles.bar, { borderTopColor: c.border }]}>
        <ActionButton
          label="Vote to Veto"
          icon="ban"
          color={c.danger}
          onPress={() => Alert.alert('Vote to Veto', 'Cast a veto vote on this trade?', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Veto', style: 'destructive', onPress: onVoteToVeto },
          ])}
          primary
        />
      </View>
    );
  }

  // No actions to show
  return null;
}

// --- Sub-components ---

function ActionButton({
  label,
  icon,
  color,
  onPress,
  disabled,
  primary,
}: {
  label: string;
  icon: string;
  color: string;
  onPress: () => void;
  disabled?: boolean;
  primary?: boolean;
}) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      style={[
        primary ? styles.primaryBtn : styles.secondaryBtn,
        { backgroundColor: color },
        disabled && { opacity: 0.5 },
      ]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.7}
    >
      <Ionicons name={icon as any} size={primary ? 18 : 16} color={c.statusText} />
      <ThemedText style={[
        primary ? styles.primaryLabel : styles.secondaryLabel,
        { color: c.statusText },
      ]}>
        {label}
      </ThemedText>
    </TouchableOpacity>
  );
}

function LeakButton({ onPress }: { onPress: () => void }) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel="Leak trade negotiations to league chat"
      style={[styles.leakBtn, { borderColor: c.warning }]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <ThemedText style={[styles.leakLabel, { color: c.warning }]}>
        Leak to Chat
      </ThemedText>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  bar: {
    paddingHorizontal: s(16),
    paddingTop: s(12),
    paddingBottom: s(4),
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: s(8),
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: s(8),
    paddingVertical: s(14),
    borderRadius: 10,
  },
  primaryLabel: {
    fontSize: ms(16),
    fontWeight: '700',
  },
  secondaryRow: {
    flexDirection: 'row',
    gap: s(8),
  },
  secondaryBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: s(6),
    paddingVertical: s(11),
    borderRadius: 10,
  },
  secondaryLabel: {
    fontSize: ms(14),
    fontWeight: '600',
  },
  leakBtn: {
    alignSelf: 'center',
    paddingVertical: s(8),
    paddingHorizontal: s(16),
    borderRadius: 8,
    borderWidth: 1,
  },
  leakLabel: {
    fontSize: ms(13),
    fontWeight: '600',
  },
  votedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: s(6),
    paddingVertical: s(10),
    borderRadius: 8,
  },
  votedText: {
    fontSize: ms(13),
    fontWeight: '600',
  },
});
