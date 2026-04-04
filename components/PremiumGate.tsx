import { ThemedText } from '@/components/ui/ThemedText';
import { UpgradeModal } from '@/components/UpgradeModal';
import { Colors } from '@/constants/Colors';
import {
  SubscriptionTier,
  TIER_LABELS,
  TIER_COLORS,
  featureTier,
} from '@/constants/Subscriptions';
import { useSubscription } from '@/hooks/useSubscription';
import { useColorScheme } from '@/hooks/useColorScheme';
import { ms, s } from '@/utils/scale';
import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';

interface PremiumGateProps {
  /** Feature key from FEATURE_TIERS */
  feature?: string;
  /** Minimum tier required (alternative to feature key) */
  tier?: SubscriptionTier;
  /** Label shown in the locked overlay */
  label?: string;
  /**
   * "block" — replaces children with lock card (default)
   * "teaser" — renders children blurred/dimmed with lock overlay on top
   */
  mode?: 'block' | 'teaser';
  children: React.ReactNode;
}

export function PremiumGate({
  feature,
  tier: minTier,
  label,
  mode = 'block',
  children,
}: PremiumGateProps) {
  const { canAccess, meetsMinTier, isLoading } = useSubscription();
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const [upgradeVisible, setUpgradeVisible] = useState(false);

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

  if (mode === 'teaser') {
    return (
      <View style={styles.teaserContainer}>
        {/* Blurred/dimmed children — not interactive */}
        <View style={styles.teaserContent} pointerEvents="none">
          {children}
        </View>

        {/* Lock overlay */}
        <View
          style={[
            styles.teaserOverlay,
            {
              backgroundColor: scheme === 'dark'
                ? 'rgba(0,0,0,0.6)'
                : 'rgba(255,255,255,0.7)',
            },
          ]}
          accessibilityRole="summary"
          accessibilityLabel={`${label ?? 'This feature'} requires ${TIER_LABELS[requiredTier]}`}
        >
          <Ionicons name="lock-closed" size={22} color={tierColor} accessible={false} />
          <ThemedText type="defaultSemiBold" style={styles.teaserLabel}>
            {TIER_LABELS[requiredTier]}
          </ThemedText>
          <TouchableOpacity
            style={[styles.teaserButton, { borderColor: tierColor }]}
            activeOpacity={0.7}
            onPress={() => setUpgradeVisible(true)}
            accessibilityRole="button"
            accessibilityLabel={`Upgrade to ${TIER_LABELS[requiredTier]}`}
          >
            <ThemedText style={[styles.teaserButtonText, { color: tierColor }]}>
              Unlock
            </ThemedText>
          </TouchableOpacity>
        </View>

        <UpgradeModal
          visible={upgradeVisible}
          onClose={() => setUpgradeVisible(false)}
          highlightFeature={feature}
        />
      </View>
    );
  }

  // Block mode (default)
  return (
    <>
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
          onPress={() => setUpgradeVisible(true)}
          accessibilityRole="button"
          accessibilityLabel={`Upgrade to ${TIER_LABELS[requiredTier]}`}
        >
          <ThemedText style={[styles.buttonText, { color: c.statusText }]}>
            Upgrade to {TIER_LABELS[requiredTier]}
          </ThemedText>
        </TouchableOpacity>
      </View>

      <UpgradeModal
        visible={upgradeVisible}
        onClose={() => setUpgradeVisible(false)}
        highlightFeature={feature}
      />
    </>
  );
}

const styles = StyleSheet.create({
  // Block mode
  container: {
    borderWidth: 1,
    borderRadius: 12,
    padding: s(24),
    alignItems: 'center',
    gap: s(8),
  },
  title: {
    fontSize: ms(17),
    marginTop: s(4),
  },
  subtitle: {
    fontSize: ms(14),
    textAlign: 'center',
  },
  button: {
    marginTop: s(8),
    paddingHorizontal: s(20),
    paddingVertical: s(10),
    borderRadius: 8,
  },
  buttonText: {
    fontSize: ms(15),
    fontWeight: '600',
  },

  // Teaser mode
  teaserContainer: {
    position: 'relative',
    overflow: 'hidden',
    borderRadius: 12,
  },
  teaserContent: {
    opacity: 0.15,
  },
  teaserOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    gap: s(6),
    borderRadius: 12,
  },
  teaserLabel: {
    fontSize: ms(14),
  },
  teaserButton: {
    marginTop: s(4),
    paddingHorizontal: s(16),
    paddingVertical: s(6),
    borderRadius: 8,
    borderWidth: 1.5,
  },
  teaserButtonText: {
    fontSize: ms(13),
    fontWeight: '600',
  },
});
