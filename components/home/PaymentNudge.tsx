import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef } from 'react';
import { Alert, Animated, StyleSheet, Text, TouchableOpacity } from 'react-native';

import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { PaymentStatus, usePaymentLedger, useSelfReportPayment } from '@/hooks/usePaymentLedger';
import { openPaymentConfirmed } from '@/utils/paymentLinks';
import { ms, s } from '@/utils/scale';

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

  // Glow animation
  const glowAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(glowAnim, { toValue: 1, duration: 1400, useNativeDriver: false }),
        Animated.timing(glowAnim, { toValue: 0, duration: 1400, useNativeDriver: false }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [glowAnim]);

  const borderColor = glowAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [c.warning + '40', c.warning],
  });

  const shadowOpacity = glowAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.05, 0.25],
  });

  if (isLoading) return null;
  if (status === 'confirmed') return null;
  if (!hasPaymentMethods && status !== 'self_reported') return null;

  function handlePress() {
    if (status === 'self_reported') return; // nothing actionable

    const buttons: { text: string; onPress?: () => void; style?: 'cancel' | 'destructive' }[] =
      [];

    if (hasPaymentMethods) {
      if (venmoUsername) {
        buttons.push({
          text: 'Pay via Venmo',
          onPress: () =>
            openPaymentConfirmed('venmo', venmoUsername, {
              amount: buyInAmount,
              note: `${leagueName} buy-in`,
            }),
        });
      }
      if (paypalUsername) {
        buttons.push({
          text: 'Pay via PayPal',
          onPress: () => openPaymentConfirmed('paypal', paypalUsername, { amount: buyInAmount }),
        });
      }
      if (cashappTag) {
        buttons.push({
          text: 'Pay via Cash App',
          onPress: () => openPaymentConfirmed('cashapp', cashappTag),
        });
      }
    }

    buttons.push({
      text: 'I Already Paid',
      onPress: () =>
        Alert.alert(
          'Mark as Paid?',
          'The commissioner will be notified to confirm your payment.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'I Paid', onPress: () => selfReport.mutate({ teamId }) },
          ],
        ),
    });

    buttons.push({ text: 'Cancel', style: 'cancel' });

    Alert.alert(`$${buyInAmount} Buy-In`, 'Choose a payment option', buttons);
  }

  const isPending = status === 'self_reported';
  const label = isPending
    ? `$${buyInAmount} buy-in · pending confirmation`
    : `$${buyInAmount} buy-in · tap to pay`;

  return (
    <TouchableOpacity
      onPress={handlePress}
      activeOpacity={isPending ? 1 : 0.7}
      accessibilityRole="button"
      accessibilityLabel={
        isPending
          ? `Buy-in ${buyInAmount} dollars, waiting for commissioner confirmation`
          : `Pay ${buyInAmount} dollar buy-in`
      }
    >
      <Animated.View
        style={[
          styles.pill,
          {
            backgroundColor: c.warningMuted,
            borderColor,
            shadowColor: c.warning,
            shadowOpacity,
          },
        ]}
      >
        <Ionicons
          name={isPending ? 'time-outline' : 'cash-outline'}
          size={ms(14)}
          color={c.warning}
          accessible={false}
        />
        <Text style={[styles.pillText, { color: c.warning }]}>{label}</Text>
        {!isPending && (
          <Ionicons name="chevron-forward" size={ms(12)} color={c.warning} accessible={false} />
        )}
      </Animated.View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: s(6),
    paddingHorizontal: s(14),
    paddingVertical: s(8),
    borderRadius: 20,
    borderWidth: 1.5,
    marginBottom: s(12),
    shadowOffset: { width: 0, height: 0 },
    shadowRadius: 8,
    elevation: 3,
  },
  pillText: {
    fontSize: ms(13),
    fontWeight: '700',
  },
});
