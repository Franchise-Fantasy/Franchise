import { ThemedText } from '@/components/ui/ThemedText';
import { ThemedView } from '@/components/ui/ThemedView';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { PaymentStatus, usePaymentLedger, useSelfReportPayment } from '@/hooks/usePaymentLedger';
import { openPaymentConfirmed } from '@/utils/paymentLinks';
import { ms, s } from '@/utils/scale';
import { Ionicons } from '@expo/vector-icons';
import { Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

interface PaymentNudgeProps {
  leagueId: string;
  leagueName: string;
  season: string;
  teamId: string;
  buyInAmount: number;
  venmoUsername: string | null;
  cashappTag: string | null;
  paypalUsername: string | null;
}

export function PaymentNudge({
  leagueId,
  leagueName,
  season,
  teamId,
  buyInAmount,
  venmoUsername,
  cashappTag,
  paypalUsername,
}: PaymentNudgeProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  const { data: payments, isLoading } = usePaymentLedger(leagueId, season);
  const selfReport = useSelfReportPayment(leagueId, season);

  const myPayment = payments?.find((p) => p.team_id === teamId);
  const status: PaymentStatus = myPayment?.status ?? 'unpaid';

  const hasPaymentMethods = !!(venmoUsername || cashappTag || paypalUsername);

  // Don't render while loading (prevents flash when status resolves to confirmed)
  if (isLoading) return null;
  // Don't render if confirmed or no buy-in configured
  if (status === 'confirmed') return null;
  // Don't render if no payment methods and not self-reported (nothing to show)
  if (!hasPaymentMethods && status !== 'self_reported') return null;

  function handlePayNow() {
    const methods: Array<{ text: string; onPress: () => void }> = [];

    if (venmoUsername) {
      methods.push({
        text: 'Venmo',
        onPress: () =>
          openPaymentConfirmed('venmo', venmoUsername, {
            amount: buyInAmount,
            note: `${leagueName} buy-in`,
          }),
      });
    }
    if (paypalUsername) {
      methods.push({
        text: 'PayPal',
        onPress: () => openPaymentConfirmed('paypal', paypalUsername, { amount: buyInAmount }),
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
    Alert.alert('Mark as Paid?', 'The commissioner will be notified to confirm your payment.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'I Paid', onPress: () => selfReport.mutate({ teamId }) },
    ]);
  }

  return (
    <ThemedView style={styles.section}>
      <View style={[styles.card, { backgroundColor: c.cardAlt }]}>
        <View style={styles.info}>
          <Ionicons name="cash-outline" size={20} color={c.warning} accessible={false} />
          <View style={{ flex: 1, marginLeft: s(10) }}>
            <ThemedText style={styles.title}>
              Buy-In: <Text style={{ fontWeight: '700', color: c.warning }}>${buyInAmount}</Text>
            </ThemedText>
            {status === 'self_reported' ? (
              <ThemedText style={[styles.subtitle, { color: c.secondaryText }]}>
                Waiting for commissioner to confirm
              </ThemedText>
            ) : (
              <ThemedText style={[styles.subtitle, { color: c.secondaryText }]}>
                Payment not yet received
              </ThemedText>
            )}
          </View>
        </View>

        {status === 'unpaid' && (
          <View style={styles.buttons}>
            {hasPaymentMethods && (
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Pay now"
                style={[styles.btn, { backgroundColor: c.success }]}
                onPress={handlePayNow}
              >
                <Ionicons name="card" size={14} color="#fff" accessible={false} />
                <Text style={styles.btnText}>Pay Now</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Report that you paid"
              style={[styles.btn, { backgroundColor: c.warning }]}
              onPress={handleSelfReport}
            >
              <Text style={styles.btnText}>I Paid</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  section: { marginBottom: s(16) },
  card: { borderRadius: 10, padding: s(14) },
  info: { flexDirection: 'row', alignItems: 'center' },
  title: { fontSize: ms(15), fontWeight: '600' },
  subtitle: { fontSize: ms(13), marginTop: s(2) },
  buttons: { flexDirection: 'row', gap: s(8), marginTop: s(12) },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(5),
    paddingHorizontal: s(14),
    paddingVertical: s(8),
    borderRadius: 8,
  },
  btnText: { color: '#fff', fontSize: ms(14), fontWeight: '600' },
});
