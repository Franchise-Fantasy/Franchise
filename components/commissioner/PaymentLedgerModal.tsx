import { Ionicons } from '@expo/vector-icons';
import {
  Alert,
  FlatList,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { LogoSpinner } from '@/components/ui/LogoSpinner';
import { ThemedText } from '@/components/ui/ThemedText';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import {
  PaymentStatus,
  usePaymentLedger,
  useSelfReportPayment,
  useTogglePayment,
} from '@/hooks/usePaymentLedger';
import { openPaymentConfirmed } from '@/utils/league/paymentLinks';
import { ms, s } from '@/utils/scale';


interface Props {
  visible: boolean;
  leagueId: string;
  leagueName?: string;
  season: string;
  buyInAmount: number | null;
  venmoUsername: string | null;
  cashappTag: string | null;
  paypalUsername: string | null;
  teams: { id: string; name: string }[];
  myTeamId?: string;
  isCommissioner: boolean;
  onClose: () => void;
}

export function PaymentLedgerModal({
  visible,
  leagueId,
  leagueName,
  season,
  buyInAmount,
  venmoUsername,
  cashappTag,
  paypalUsername,
  teams,
  myTeamId,
  isCommissioner,
  onClose,
}: Props) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  const { data: payments, isLoading } = usePaymentLedger(visible ? leagueId : null, season);
  const togglePayment = useTogglePayment(leagueId, season);
  const selfReport = useSelfReportPayment(leagueId, season);

  const paymentMap = new Map((payments ?? []).map((p) => [p.team_id, p]));
  const confirmedCount = (payments ?? []).filter((p) => p.status === 'confirmed').length;

  const hasPaymentMethods = !!(venmoUsername || cashappTag || paypalUsername);

  function getStatus(teamId: string): PaymentStatus {
    return paymentMap.get(teamId)?.status ?? 'unpaid';
  }

  function formatDate(dateStr: string | null) {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  function handlePayNow() {
    const methods: { text: string; onPress: () => void }[] = [];

    if (venmoUsername) {
      methods.push({
        text: 'Venmo',
        onPress: () =>
          openPaymentConfirmed('venmo', venmoUsername, {
            amount: buyInAmount ?? undefined,
            note: leagueName ? `${leagueName} buy-in` : undefined,
          }),
      });
    }
    if (paypalUsername) {
      methods.push({
        text: 'PayPal',
        onPress: () =>
          openPaymentConfirmed('paypal', paypalUsername, { amount: buyInAmount ?? undefined }),
      });
    }
    if (cashappTag) {
      methods.push({
        text: 'Cash App',
        onPress: () => openPaymentConfirmed('cashapp', cashappTag),
      });
    }

    if (methods.length === 1) {
      methods[0].onPress();
    } else {
      Alert.alert('Pay With', 'Choose a payment method', [
        ...methods,
        { text: 'Cancel', style: 'cancel' },
      ]);
    }
  }

  function handleSelfReport() {
    if (!myTeamId) return;
    Alert.alert('Mark as Paid?', 'The commissioner will be notified to confirm your payment.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'I Paid', onPress: () => selfReport.mutate({ teamId: myTeamId }) },
    ]);
  }

  // ── Status badge ───────────────────────────────────────────────
  function StatusBadge({ status }: { status: PaymentStatus }) {
    const bg =
      status === 'confirmed'
        ? c.successMuted
        : status === 'self_reported'
          ? c.warningMuted
          : c.cardAlt;
    const fg =
      status === 'confirmed'
        ? c.success
        : status === 'self_reported'
          ? c.warning
          : c.secondaryText;
    const label =
      status === 'confirmed' ? 'Paid' : status === 'self_reported' ? 'Pending' : 'Unpaid';

    return (
      <View style={[styles.badge, { backgroundColor: bg }]} accessibilityLabel={`${label}`}>
        <Text style={[styles.badgeText, { color: fg }]}>{label}</Text>
      </View>
    );
  }

  // ── Row renderer ───────────────────────────────────────────────
  function renderRow({ item, index }: { item: { id: string; name: string }; index: number }) {
    const status = getStatus(item.id);
    const payment = paymentMap.get(item.id);
    const isMyTeam = item.id === myTeamId;
    const isLast = index === teams.length - 1;

    return (
      <View
        style={[styles.row, { borderBottomColor: c.border }, isLast && { borderBottomWidth: 0 }]}
      >
        <View style={{ flex: 1 }}>
          <ThemedText style={{ fontWeight: '500' }}>{item.name}</ThemedText>
          {status === 'confirmed' && payment?.paid_at && (
            <ThemedText style={[styles.subText, { color: c.secondaryText }]}>
              Paid {formatDate(payment.paid_at)}
              {payment.notes ? ` · ${payment.notes}` : ''}
            </ThemedText>
          )}
          {status === 'self_reported' && (
            <ThemedText style={[styles.subText, { color: c.warning }]}>
              Reported {formatDate(payment?.self_reported_at ?? null)}
            </ThemedText>
          )}
        </View>

        <View style={styles.actions}>
          <StatusBadge status={status} />

          {/* Commissioner: confirm/deny for self-reported, toggle for unpaid */}
          {isCommissioner && status === 'self_reported' && (
            <>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={`Confirm ${item.name} payment`}
                style={[styles.actionBtn, { backgroundColor: c.successMuted }]}
                onPress={() => togglePayment.mutate({ teamId: item.id, action: 'confirm' })}
              >
                <Ionicons name="checkmark" size={16} color={c.success} />
              </TouchableOpacity>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={`Deny ${item.name} payment`}
                style={[styles.actionBtn, { backgroundColor: c.dangerMuted }]}
                onPress={() => togglePayment.mutate({ teamId: item.id, action: 'deny' })}
              >
                <Ionicons name="close" size={16} color={c.danger} />
              </TouchableOpacity>
            </>
          )}
          {isCommissioner && status === 'unpaid' && (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={`Confirm ${item.name} payment`}
              style={[styles.actionBtn, { backgroundColor: c.successMuted }]}
              onPress={() => togglePayment.mutate({ teamId: item.id, action: 'confirm' })}
            >
              <Ionicons name="checkmark" size={16} color={c.success} />
            </TouchableOpacity>
          )}
          {isCommissioner && status === 'confirmed' && (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={`Undo ${item.name} payment`}
              style={[styles.actionBtn, { backgroundColor: c.cardAlt }]}
              onPress={() => togglePayment.mutate({ teamId: item.id, action: 'deny' })}
            >
              <Ionicons name="arrow-undo" size={14} color={c.secondaryText} />
            </TouchableOpacity>
          )}

          {/* Team owner: pay / self-report for own row */}
          {!isCommissioner && isMyTeam && status === 'unpaid' && (
            <>
              {hasPaymentMethods && (
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel="Pay now"
                  style={[styles.actionBtn, { backgroundColor: c.successMuted }]}
                  onPress={handlePayNow}
                >
                  <Ionicons name="card" size={14} color={c.success} />
                </TouchableOpacity>
              )}
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Report payment"
                style={[styles.actionBtn, { backgroundColor: c.warningMuted }]}
                onPress={handleSelfReport}
              >
                <Ionicons name="hand-left" size={14} color={c.warning} />
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>
    );
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={[styles.content, { backgroundColor: c.card }]} accessibilityViewIsModal>
          <View style={styles.header}>
            <ThemedText accessibilityRole="header" type="subtitle">
              Payment Ledger
            </ThemedText>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Close" onPress={onClose}>
              <Ionicons name="close" size={24} color={c.text} />
            </TouchableOpacity>
          </View>

          {/* Summary */}
          <View style={[styles.summary, { backgroundColor: c.cardAlt, borderColor: c.border }]}>
            {buyInAmount ? (
              <ThemedText style={styles.summaryText}>
                Buy-In: <Text style={{ fontWeight: '700', color: c.success }}>${buyInAmount}</Text>
                {'  ·  '}
                {confirmedCount}/{teams.length} paid
              </ThemedText>
            ) : (
              <ThemedText style={styles.summaryText}>
                {confirmedCount}/{teams.length} paid
              </ThemedText>
            )}
          </View>

          {isLoading ? (
            <View style={{ marginTop: s(20) }}><LogoSpinner /></View>
          ) : (
            <FlatList
              data={teams}
              keyExtractor={(item) => item.id}
              renderItem={renderRow}
            />
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  content: {
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    padding: s(20),
    paddingBottom: s(32),
    minHeight: '50%',
    maxHeight: '85%',
    overflow: 'hidden' as const,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: s(16),
  },
  summary: {
    borderWidth: 1,
    borderRadius: 8,
    padding: s(12),
    marginBottom: s(16),
    alignItems: 'center',
  },
  summaryText: { fontSize: ms(15) },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: s(12),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  subText: { fontSize: ms(12), marginTop: s(2) },
  actions: { flexDirection: 'row', alignItems: 'center', gap: s(6) },
  badge: { paddingHorizontal: s(8), paddingVertical: s(3), borderRadius: 6 },
  badgeText: { fontSize: ms(12), fontWeight: '600' },
  actionBtn: { width: s(30), height: s(30), borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
});
