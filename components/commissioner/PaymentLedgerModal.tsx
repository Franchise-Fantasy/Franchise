import { ThemedText } from '@/components/ThemedText';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { usePaymentLedger, useTogglePayment } from '@/hooks/usePaymentLedger';
import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

interface Props {
  visible: boolean;
  leagueId: string;
  season: string;
  buyInAmount: number | null;
  teams: Array<{ id: string; name: string }>;
  onClose: () => void;
}

export function PaymentLedgerModal({ visible, leagueId, season, buyInAmount, teams, onClose }: Props) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  const { data: payments, isLoading } = usePaymentLedger(visible ? leagueId : null, season);
  const togglePayment = useTogglePayment(leagueId, season);

  const paymentMap = new Map((payments ?? []).map((p) => [p.team_id, p]));
  const paidCount = (payments ?? []).filter((p) => p.paid).length;

  function handleToggle(teamId: string, currentPaid: boolean) {
    togglePayment.mutate({ teamId, paid: !currentPaid });
  }

  function formatDate(dateStr: string | null) {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={[styles.content, { backgroundColor: c.card }]} accessibilityViewIsModal={true}>
          <View style={styles.header}>
            <ThemedText accessibilityRole="header" type="subtitle">Payment Ledger</ThemedText>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Close" onPress={onClose}>
              <Ionicons name="close" size={24} color={c.text} />
            </TouchableOpacity>
          </View>

          {/* Summary */}
          <View style={[styles.summary, { backgroundColor: c.cardAlt, borderColor: c.border }]}>
            {buyInAmount ? (
              <ThemedText style={styles.summaryText}>
                Buy-In: <Text style={{ fontWeight: '700', color: '#34C759' }}>${buyInAmount}</Text>
                {'  ·  '}
                {paidCount}/{teams.length} paid
              </ThemedText>
            ) : (
              <ThemedText style={styles.summaryText}>
                {paidCount}/{teams.length} paid
              </ThemedText>
            )}
          </View>

          {isLoading ? (
            <ActivityIndicator style={{ marginTop: 20 }} />
          ) : (
            <FlatList
              data={teams}
              keyExtractor={(item) => item.id}
              renderItem={({ item, index }) => {
                const payment = paymentMap.get(item.id);
                const paid = payment?.paid ?? false;
                return (
                  <View style={[styles.row, { borderBottomColor: c.border }, index === teams.length - 1 && { borderBottomWidth: 0 }]}>
                    <View style={{ flex: 1 }}>
                      <ThemedText style={{ fontWeight: '500' }}>{item.name}</ThemedText>
                      {paid && payment?.paid_at && (
                        <ThemedText style={[styles.paidDate, { color: c.secondaryText }]}>
                          Paid {formatDate(payment.paid_at)}
                          {payment.notes ? ` · ${payment.notes}` : ''}
                        </ThemedText>
                      )}
                    </View>
                    <Switch
                      accessibilityLabel={`${item.name} payment status`}
                      value={paid}
                      onValueChange={() => handleToggle(item.id, paid)}
                      trackColor={{ false: c.border, true: '#34C759' }}
                    />
                  </View>
                );
              }}
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
    padding: 20,
    paddingBottom: 32,
    minHeight: '50%',
    maxHeight: '85%',
    overflow: 'hidden' as const,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  summary: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
    alignItems: 'center',
  },
  summaryText: { fontSize: 15 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  paidDate: { fontSize: 12, marginTop: 2 },
});
