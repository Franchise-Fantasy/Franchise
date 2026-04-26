import { Ionicons } from '@expo/vector-icons';
import {
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { BottomSheet } from '@/components/ui/BottomSheet';
import { type ModalAction } from '@/components/ui/InlineAction';
import { LogoSpinner } from '@/components/ui/LogoSpinner';
import { ThemedText } from '@/components/ui/ThemedText';
import { useActionPicker, useConfirm } from '@/context/ConfirmProvider';
import { useColors } from '@/hooks/useColors';
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
  const c = useColors();

  const { data: payments, isLoading } = usePaymentLedger(visible ? leagueId : null, season);
  const togglePayment = useTogglePayment(leagueId, season);
  const selfReport = useSelfReportPayment(leagueId, season);
  const pickAction = useActionPicker();
  const confirm = useConfirm();

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

  const payWithActions: ModalAction[] = [
    {
      id: 'venmo',
      label: 'Venmo',
      icon: 'wallet-outline',
      hidden: !venmoUsername,
      onPress: () =>
        openPaymentConfirmed('venmo', venmoUsername!, {
          amount: buyInAmount ?? undefined,
          note: leagueName ? `${leagueName} buy-in` : undefined,
        }),
    },
    {
      id: 'paypal',
      label: 'PayPal',
      icon: 'card-outline',
      hidden: !paypalUsername,
      onPress: () =>
        openPaymentConfirmed('paypal', paypalUsername!, { amount: buyInAmount ?? undefined }),
    },
    {
      id: 'cashapp',
      label: 'Cash App',
      icon: 'cash-outline',
      hidden: !cashappTag,
      onPress: () => openPaymentConfirmed('cashapp', cashappTag!),
    },
  ];

  function handlePayNow() {
    const visibleMethods = payWithActions.filter((m) => !m.hidden);
    if (visibleMethods.length === 1) {
      visibleMethods[0]!.onPress();
    } else {
      pickAction({
        title: 'Pay With',
        subtitle: 'CHOOSE A PAYMENT METHOD',
        actions: payWithActions,
      });
    }
  }

  function handleSelfReport() {
    if (!myTeamId) return;
    confirm({
      title: 'Mark as Paid?',
      message: 'The commissioner will be notified to confirm your payment.',
      action: {
        label: 'I Paid',
        onPress: () => selfReport.mutate({ teamId: myTeamId }),
      },
    });
  }

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

  const subtitle = buyInAmount
    ? `BUY-IN $${buyInAmount}  ·  ${confirmedCount}/${teams.length} PAID`
    : `${confirmedCount}/${teams.length} PAID`;

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Payment Ledger"
      subtitle={subtitle}
      height="85%"
      scrollableBody={false}
    >
      {isLoading ? (
        <View style={{ marginTop: s(20) }}><LogoSpinner /></View>
      ) : (
        <FlatList
          data={teams}
          keyExtractor={(item) => item.id}
          renderItem={renderRow}
        />
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
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
