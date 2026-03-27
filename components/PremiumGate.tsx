import { ThemedText } from '@/components/ThemedText';
import { Colors } from '@/constants/Colors';
import {
  SubscriptionTier,
  TIER_LABELS,
  TIER_COLORS,
  featureTier,
} from '@/constants/Subscriptions';
import { useSubscription } from '@/hooks/useSubscription';
import { useColorScheme } from '@/hooks/useColorScheme';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, TouchableOpacity, View } from 'react-native';

interface PremiumGateProps {
  /** Feature key from FEATURE_TIERS */
  feature?: string;
  /** Minimum tier required (alternative to feature key) */
  tier?: SubscriptionTier;
  /** Label shown in the locked overlay */
  label?: string;
  children: React.ReactNode;
}

export function PremiumGate({ feature, tier: minTier, label, children }: PremiumGateProps) {
  const { canAccess, meetsMinTier, isLoading } = useSubscription();
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  const granted = feature
    ? canAccess(feature)
    : minTier
      ? meetsMinTier(minTier)
      : true;

  // Show children while loading (optimistic) or when access is granted
  if (isLoading || granted) return <>{children}</>;

  const requiredTier: SubscriptionTier = feature
    ? featureTier(feature)
    : minTier ?? 'pro';
  const tierColor = TIER_COLORS[requiredTier];

  return (
    <View
      style={[styles.container, { backgroundColor: c.card, borderColor: c.border }]}
      accessibilityRole="summary"
      accessibilityLabel={`${label ?? 'This feature'} requires ${TIER_LABELS[requiredTier]}`}
    >
      <Ionicons name="lock-closed" size={28} color={tierColor} accessible={false} />
      <ThemedText type="defaultSemiBold" style={styles.title}>
        {label ?? 'Premium Feature'}
      </ThemedText>
      <ThemedText style={[styles.subtitle, { color: c.secondaryText }]}>
        Upgrade to {TIER_LABELS[requiredTier]} to unlock
      </ThemedText>
      <TouchableOpacity
        style={[styles.button, { backgroundColor: tierColor }]}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={`Upgrade to ${TIER_LABELS[requiredTier]}`}
      >
        <ThemedText style={[styles.buttonText, { color: c.statusText }]}>
          Upgrade to {TIER_LABELS[requiredTier]}
        </ThemedText>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 24,
    alignItems: 'center',
    gap: 8,
  },
  title: {
    fontSize: 17,
    marginTop: 4,
  },
  subtitle: {
    fontSize: 14,
    textAlign: 'center',
  },
  button: {
    marginTop: 8,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  buttonText: {
    fontSize: 15,
    fontWeight: '600',
  },
});
