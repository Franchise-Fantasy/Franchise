import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';

import { UpgradeModal } from '@/components/account/UpgradeModal';
import { ThemedText } from '@/components/ui/ThemedText';
import { Brand, Colors } from '@/constants/Colors';
import {
  SubscriptionTier,
  TIER_LABELS,
  TIER_COLORS,
  featureTier,
} from '@/constants/Subscriptions';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useSubscription } from '@/hooks/useSubscription';
import { ms, s } from '@/utils/scale';

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

        {/* Lock overlay — gold-rule eyebrow + tier-colored Unlock pill */}
        <View
          style={[
            styles.teaserOverlay,
            {
              backgroundColor: scheme === 'dark'
                ? 'rgba(0,0,0,0.65)'
                : 'rgba(233, 226, 203, 0.85)', // ecru wash
            },
          ]}
          accessibilityRole="summary"
          accessibilityLabel={`${label ?? 'This feature'} requires ${TIER_LABELS[requiredTier]}`}
        >
          <View style={styles.eyebrowRow}>
            <View style={[styles.eyebrowRule, { backgroundColor: c.gold }]} />
            <ThemedText
              type="varsitySmall"
              style={[styles.eyebrowText, { color: c.gold }]}
            >
              {`${TIER_LABELS[requiredTier]} Required`}
            </ThemedText>
          </View>
          <Ionicons
            name="lock-closed"
            size={20}
            color={tierColor}
            accessible={false}
            style={styles.teaserLock}
          />
          <TouchableOpacity
            style={[styles.teaserButton, { backgroundColor: tierColor }]}
            activeOpacity={0.85}
            onPress={() => setUpgradeVisible(true)}
            accessibilityRole="button"
            accessibilityLabel={`Upgrade to ${TIER_LABELS[requiredTier]}`}
          >
            <ThemedText type="varsity" style={styles.teaserButtonText}>
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

  // Block mode (default) — full card with eyebrow + display title + tier-colored CTA
  return (
    <>
      <View style={styles.blockWrap}>
        <View style={styles.eyebrowRow}>
          <View style={[styles.eyebrowRule, { backgroundColor: c.gold }]} />
          <ThemedText
            type="varsitySmall"
            style={[styles.eyebrowText, { color: c.gold }]}
          >
            {`${TIER_LABELS[requiredTier]} Required`}
          </ThemedText>
        </View>
        <View
          style={[styles.blockCard, { backgroundColor: c.card, borderColor: c.border }]}
          accessibilityRole="summary"
          accessibilityLabel={`${label ?? 'This feature'} requires ${TIER_LABELS[requiredTier]}`}
        >
          {/* Tier accent rule — full-width top edge in the tier color */}
          <View style={[styles.blockAccent, { backgroundColor: tierColor }]} />

          <View style={styles.blockBody}>
            <Ionicons
              name="lock-closed"
              size={28}
              color={tierColor}
              accessible={false}
            />
            <ThemedText
              type="display"
              style={[styles.blockTitle, { color: c.text }]}
              accessibilityRole="header"
            >
              {label ?? 'Premium Feature'}
            </ThemedText>
            <ThemedText style={[styles.blockSubtitle, { color: c.secondaryText }]}>
              Unlock with {TIER_LABELS[requiredTier]} to dig in.
            </ThemedText>
            <TouchableOpacity
              style={[styles.blockButton, { backgroundColor: tierColor }]}
              activeOpacity={0.85}
              onPress={() => setUpgradeVisible(true)}
              accessibilityRole="button"
              accessibilityLabel={`Upgrade to ${TIER_LABELS[requiredTier]}`}
            >
              <ThemedText type="varsity" style={styles.blockButtonText}>
                Upgrade to {TIER_LABELS[requiredTier]}
              </ThemedText>
            </TouchableOpacity>
          </View>
        </View>
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
  // Eyebrow — same gold-rule + varsity caps pattern as Section primitive
  eyebrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(10),
    marginBottom: s(8),
  },
  eyebrowRule: { height: 2, width: s(18) },
  eyebrowText: { fontSize: ms(10), letterSpacing: 1.4 },

  // Block mode — full lock card
  blockWrap: {
    paddingTop: s(4),
  },
  blockCard: {
    borderWidth: 1,
    borderRadius: 14,
    overflow: 'hidden',
  },
  blockAccent: {
    height: s(4),
  },
  blockBody: {
    alignItems: 'center',
    paddingHorizontal: s(20),
    paddingVertical: s(24),
    gap: s(8),
  },
  blockTitle: {
    fontSize: ms(20),
    lineHeight: ms(24),
    letterSpacing: -0.3,
    textAlign: 'center',
    marginTop: s(4),
  },
  blockSubtitle: {
    fontSize: ms(13),
    textAlign: 'center',
    marginBottom: s(4),
  },
  blockButton: {
    marginTop: s(10),
    paddingHorizontal: s(20),
    paddingVertical: s(11),
    borderRadius: 10,
    alignItems: 'center',
  },
  blockButtonText: {
    color: Brand.ecru,
    fontSize: ms(12),
    letterSpacing: 1.0,
  },

  // Teaser mode — overlay on dimmed children
  teaserContainer: {
    position: 'relative',
    overflow: 'hidden',
    borderRadius: 12,
  },
  teaserContent: {
    opacity: 0.18,
  },
  teaserOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: s(16),
    paddingHorizontal: s(20),
    borderRadius: 12,
  },
  teaserLock: {
    marginVertical: s(6),
  },
  teaserButton: {
    marginTop: s(2),
    paddingHorizontal: s(18),
    paddingVertical: s(8),
    borderRadius: 8,
  },
  teaserButtonText: {
    color: Brand.ecru,
    fontSize: ms(11),
    letterSpacing: 1.0,
  },
});
