import { LogoSpinner } from "@/components/ui/LogoSpinner";
import { ThemedText } from "@/components/ui/ThemedText";
import { Colors } from "@/constants/Colors";
import { ms, s } from '@/utils/scale';
import {
  SubscriptionTier,
  TIER_COLORS,
  TIER_LABELS,
  TIER_RANK,
} from "@/constants/Subscriptions";
import { useColorScheme } from "@/hooks/useColorScheme";
import {
  purchasePackage,
  restorePurchases,
  syncSubscriptionFromRC,
} from "@/lib/purchases";
import Purchases from "react-native-purchases";
import { useAppState } from "@/context/AppStateProvider";
import { useSession } from "@/context/AuthProvider";
import { useSubscription, waitForSubscriptionChange } from "@/hooks/useSubscription";
import { useOfferings } from "@/hooks/useOfferings";
import { useQueryClient } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import {
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

interface UpgradeModalProps {
  visible: boolean;
  onClose: () => void;
  /** Feature key that triggered the modal — highlights relevant tier */
  highlightFeature?: string;
  /** Show league-wide pricing instead of individual */
  leagueMode?: boolean;
}

const PRO_FEATURES = [
  "Deep Player Insights",
  "Age Curve & League Comparison",
  "Roster Efficiency Score",
  "Luck Index & All-Play Record",
  "Strength of Schedule",
  "Contender Score",
  "Category Punt Analyzer",
  "Team Needs Report",
  "Advanced Schedule Grid",
  "Enhanced Trade Analysis",
  "Playoff Probability",
];

const PREMIUM_FEATURES = [
  "Everything in Pro",
  "AI Trade Advisor",
  "Draft Value Tracker",
  "Dynasty Trade Value Chart",
  "Collusion Detection",
  "AI Weekly Digest",
];

export function UpgradeModal({
  visible,
  onClose,
  highlightFeature,
  leagueMode = false,
}: UpgradeModalProps) {
  const scheme = useColorScheme() ?? "light";
  const c = Colors[scheme];
  const isDark = scheme === "dark";
  const queryClient = useQueryClient();
  const {
    individualTier,
    individualPeriod,
    leagueTier,
    leaguePeriod,
  } = useSubscription();
  const { leagueId } = useAppState();
  // Scope "current plan" to the subscription type the modal is showing.
  // Personal Pro must NOT mark the League Pro card as owned, and vice versa.
  const currentTier: SubscriptionTier = leagueMode
    ? (leagueTier ?? "free")
    : (individualTier ?? "free");
  const currentPeriod: string | null = leagueMode
    ? (leaguePeriod ?? null)
    : (individualPeriod ?? null);
  const session = useSession();

  const { data: offerings, isLoading: loadingOfferings } = useOfferings();

  const [annual, setAnnual] = useState(true);
  const [purchasing, setPurchasing] = useState<SubscriptionTier | null>(null);

  const proPackage = !offerings
    ? null
    : leagueMode
      ? annual ? offerings.leagueProAnnual : offerings.leagueProMonthly
      : annual ? offerings.proAnnual : offerings.proMonthly;

  const premiumPackage = !offerings
    ? null
    : leagueMode
      ? annual ? offerings.leaguePremiumAnnual : offerings.leaguePremiumMonthly
      : annual ? offerings.premiumAnnual : offerings.premiumMonthly;

  async function handleManage() {
    try {
      await Purchases.showManageSubscriptions();
    } catch {
      // Fallback to Apple's subscription URL
      const { Linking } = require("react-native");
      Linking.openURL("https://apps.apple.com/account/subscriptions");
    }
  }

  async function handlePurchase(tier: SubscriptionTier) {
    const pkg = tier === "pro" ? proPackage : premiumPackage;
    if (!pkg) {
      Alert.alert("Unavailable", "This plan is not available yet.");
      return;
    }
    const expectedPeriod = annual ? "annual" : "monthly";

    setPurchasing(tier);
    try {
      await purchasePackage(pkg);
      // Poll the subscriptions table until the RevenueCat webhook has written
      // the new tier or period. Without this, invalidating too early races the
      // webhook and the UI flickers back to the paywall (or still shows
      // "Switch to Annual" after a monthly→annual swap).
      let synced = await waitForSubscriptionChange({
        userId: session?.user?.id,
        leagueId,
        leagueMode,
        expectedTier: tier,
        expectedPeriod,
        previousPeriod: currentTier === tier ? (currentPeriod ?? undefined) : undefined,
      });
      // Webhook didn't land in time — pull authoritative state from RC ourselves
      // so the user isn't stuck staring at "Purchase Processing" forever.
      if (!synced) {
        await syncSubscriptionFromRC();
        synced = await waitForSubscriptionChange({
          userId: session?.user?.id,
          leagueId,
          leagueMode,
          expectedTier: tier,
          expectedPeriod,
          previousPeriod: currentTier === tier ? (currentPeriod ?? undefined) : undefined,
          timeoutMs: 4000,
        });
      }
      await queryClient.invalidateQueries({ queryKey: ["userSubscription"] });
      await queryClient.invalidateQueries({ queryKey: ["leagueSubscription"] });
      if (!synced) {
        Alert.alert(
          "Purchase Processing",
          "Your payment went through but we're still syncing. Your new plan will unlock shortly.",
        );
      }
      onClose();
    } catch (err: any) {
      // User cancelled is not an error
      if (!err?.userCancelled) {
        Alert.alert("Purchase Failed", err?.message ?? "Please try again.");
      }
    } finally {
      setPurchasing(null);
    }
  }

  async function handleRestore() {
    setPurchasing("pro"); // just show loading
    try {
      // restorePurchases() already calls the server-side sync, which writes the
      // row directly. No webhook race to wait out — just invalidate and read.
      const restored = await restorePurchases();
      await queryClient.invalidateQueries({ queryKey: ["userSubscription"] });
      await queryClient.invalidateQueries({ queryKey: ["leagueSubscription"] });
      if (restored) {
        Alert.alert("Restored", "Your subscription has been restored.");
        onClose();
      } else {
        Alert.alert(
          "No Subscription Found",
          "We couldn't find an active subscription for this account.",
        );
      }
    } catch (err: any) {
      Alert.alert("Restore Failed", err?.message ?? "Please try again.");
    } finally {
      setPurchasing(null);
    }
  }

  // Only show real store prices. Showing placeholder prices that later "change"
  // when offerings load confuses users and looks like a bait-and-switch.
  const proDisplay = proPackage?.product?.priceString ?? null;
  const premiumDisplay = premiumPackage?.product?.priceString ?? null;

  const leagueLabel = leagueMode ? "League " : "";
  const selectedPeriod = annual ? "annual" : "monthly";

  /**
   * What the CTA on each plan card should do based on current tier vs target.
   * - "owned": exact match (same tier and period) — sends to Apple manage screen.
   * - "switch": same tier, different period — native purchase triggers Apple's swap.
   * - "upgrade" / "buy": higher tier than current — standard purchase.
   * - "downgrade": lower tier than current — must go through Apple's manage screen.
   */
  type PlanCtaKind = "owned" | "switch" | "upgrade" | "buy" | "downgrade";
  function ctaFor(targetTier: SubscriptionTier): {
    kind: PlanCtaKind;
    label: string;
    a11yLabel: string;
  } {
    const tierLabel = `${leagueLabel}${TIER_LABELS[targetTier]}`;
    if (currentTier === targetTier) {
      if (!currentPeriod || currentPeriod === selectedPeriod) {
        return {
          kind: "owned",
          label: "Current Plan — Manage",
          a11yLabel: `Current plan: ${tierLabel}. Tap to manage.`,
        };
      }
      const switchTo = annual ? "Annual" : "Monthly";
      return {
        kind: "switch",
        label: annual ? `Switch to Annual — save 40%` : `Switch to Monthly`,
        a11yLabel: `Switch ${tierLabel} to ${switchTo}`,
      };
    }
    if (TIER_RANK[targetTier] > TIER_RANK[currentTier]) {
      const kind: PlanCtaKind = currentTier === "free" ? "buy" : "upgrade";
      return {
        kind,
        label: currentTier === "free" ? `Get ${tierLabel}` : `Upgrade to ${tierLabel}`,
        a11yLabel: `${currentTier === "free" ? "Purchase" : "Upgrade to"} ${tierLabel}`,
      };
    }
    return {
      kind: "downgrade",
      label: `Downgrade — Manage`,
      a11yLabel: `Downgrade to ${tierLabel} via the App Store`,
    };
  }

  const proCta = ctaFor("pro");
  const premiumCta = ctaFor("premium");

  /** owned/downgrade go to Apple's screen; switch/upgrade/buy trigger purchase. */
  const runCta = (kind: PlanCtaKind, tier: SubscriptionTier) => {
    if (kind === "owned" || kind === "downgrade") return handleManage();
    return handlePurchase(tier);
  };

  const headerTitle = leagueMode
    ? currentTier === "free" ? "Upgrade Your League" : "Manage League Plan"
    : currentTier === "free"
      ? "Upgrade to Pro"
      : currentTier === "pro"
        ? "Upgrade to Premium"
        : "Manage Plan";

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={[styles.container, { backgroundColor: c.background }]}>
        {/* Header */}
        <View style={styles.header}>
          <ThemedText type="title" style={styles.headerTitle}>
            {headerTitle}
          </ThemedText>
          <TouchableOpacity
            onPress={onClose}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel="Close"
          >
            <Ionicons name="close" size={24} color={c.text} />
          </TouchableOpacity>
        </View>

        {leagueMode && (
          <Text style={[styles.leagueSubtitle, { color: c.secondaryText }]}>
            Every team in your league gets access. One purchase, whole league.
          </Text>
        )}

        {/* Period Toggle */}
        <View
          style={[
            styles.toggleRow,
            {
              backgroundColor: isDark
                ? "rgba(255,255,255,0.06)"
                : "rgba(0,0,0,0.04)",
            },
          ]}
        >
          <TouchableOpacity
            style={[
              styles.toggleButton,
              !annual && {
                backgroundColor: isDark
                  ? "rgba(255,255,255,0.12)"
                  : "#FFFFFF",
              },
            ]}
            onPress={() => setAnnual(false)}
            accessibilityRole="button"
            accessibilityLabel="Monthly pricing"
            accessibilityState={{ selected: !annual }}
          >
            <Text
              style={[
                styles.toggleText,
                { color: !annual ? c.text : c.secondaryText },
              ]}
            >
              Monthly
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.toggleButton,
              annual && {
                backgroundColor: isDark
                  ? "rgba(255,255,255,0.12)"
                  : "#FFFFFF",
              },
            ]}
            onPress={() => setAnnual(true)}
            accessibilityRole="button"
            accessibilityLabel="Annual pricing, save 42%"
            accessibilityState={{ selected: annual }}
          >
            <Text
              style={[
                styles.toggleText,
                { color: annual ? c.text : c.secondaryText },
              ]}
            >
              Annual
            </Text>
            {annual && (
              <View style={styles.saveBadge}>
                <Text style={styles.saveBadgeText}>Save 40%</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>

        <ScrollView
          style={styles.scrollArea}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Pro Card */}
          <View
            style={[
              styles.planCard,
              {
                borderColor: TIER_COLORS.pro,
                backgroundColor: isDark
                  ? "rgba(0,122,255,0.06)"
                  : "rgba(0,122,255,0.04)",
              },
            ]}
          >
            <View style={styles.planHeader}>
              <View>
                <Text style={[styles.planName, { color: TIER_COLORS.pro }]}>
                  {leagueLabel}Pro
                </Text>
                <Text style={[styles.planTagline, { color: c.secondaryText }]}>
                  The Analyst
                </Text>
              </View>
              {proDisplay ? (
                <Text style={[styles.planPrice, { color: c.text }]}>
                  {proDisplay}
                </Text>
              ) : (
                <View style={[styles.pricePlaceholder, { backgroundColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)" }]} />
              )}
            </View>

            {PRO_FEATURES.map((feature) => (
              <View style={styles.featureRow} key={feature}>
                <Ionicons
                  name="checkmark-circle"
                  size={18}
                  color={TIER_COLORS.pro}
                  accessible={false}
                />
                <Text style={[styles.featureText, { color: c.text }]}>
                  {feature}
                </Text>
              </View>
            ))}

            <TouchableOpacity
              style={[
                styles.purchaseButton,
                {
                  backgroundColor: proCta.kind === "owned"
                    ? isDark ? "rgba(0,122,255,0.15)" : "rgba(0,122,255,0.1)"
                    : TIER_COLORS.pro,
                  opacity: (!proPackage && proCta.kind !== "owned" && proCta.kind !== "downgrade") ? 0.6 : 1,
                },
              ]}
              onPress={() => runCta(proCta.kind, "pro")}
              disabled={
                !!purchasing
                || loadingOfferings
                || (!proPackage && proCta.kind !== "owned" && proCta.kind !== "downgrade")
              }
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={proCta.a11yLabel}
            >
              {purchasing === "pro" || (loadingOfferings && proCta.kind !== "owned") ? (
                <LogoSpinner size={18} />
              ) : (
                <Text
                  style={[
                    styles.purchaseButtonText,
                    proCta.kind === "owned" && { color: TIER_COLORS.pro },
                  ]}
                >
                  {proCta.label}
                </Text>
              )}
            </TouchableOpacity>
          </View>

          {/* Premium Card */}
          <View
            style={[
              styles.planCard,
              {
                borderColor: TIER_COLORS.premium,
                backgroundColor: isDark
                  ? "rgba(255,184,0,0.06)"
                  : "rgba(255,184,0,0.04)",
              },
            ]}
          >
            <View style={styles.planHeader}>
              <View>
                <Text
                  style={[styles.planName, { color: TIER_COLORS.premium }]}
                >
                  {leagueLabel}Premium
                </Text>
                <Text style={[styles.planTagline, { color: c.secondaryText }]}>
                  The Edge
                </Text>
              </View>
              {premiumDisplay ? (
                <Text style={[styles.planPrice, { color: c.text }]}>
                  {premiumDisplay}
                </Text>
              ) : (
                <View style={[styles.pricePlaceholder, { backgroundColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)" }]} />
              )}
            </View>

            {PREMIUM_FEATURES.map((feature) => (
              <View style={styles.featureRow} key={feature}>
                <Ionicons
                  name="checkmark-circle"
                  size={18}
                  color={TIER_COLORS.premium}
                  accessible={false}
                />
                <Text style={[styles.featureText, { color: c.text }]}>
                  {feature}
                </Text>
              </View>
            ))}

            <TouchableOpacity
              style={[
                styles.purchaseButton,
                {
                  backgroundColor: premiumCta.kind === "owned"
                    ? isDark ? "rgba(255,184,0,0.15)" : "rgba(255,184,0,0.1)"
                    : TIER_COLORS.premium,
                  opacity: (!premiumPackage && premiumCta.kind !== "owned" && premiumCta.kind !== "downgrade") ? 0.6 : 1,
                },
              ]}
              onPress={() => runCta(premiumCta.kind, "premium")}
              disabled={
                !!purchasing
                || loadingOfferings
                || (!premiumPackage && premiumCta.kind !== "owned" && premiumCta.kind !== "downgrade")
              }
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={premiumCta.a11yLabel}
            >
              {purchasing === "premium" || (loadingOfferings && premiumCta.kind !== "owned") ? (
                <LogoSpinner size={18} />
              ) : (
                <Text
                  style={[
                    styles.purchaseButtonText,
                    premiumCta.kind === "owned" && { color: TIER_COLORS.premium },
                  ]}
                >
                  {premiumCta.label}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </ScrollView>

        {/* Restore link */}
        <TouchableOpacity
          style={styles.restoreButton}
          onPress={handleRestore}
          disabled={!!purchasing}
          accessibilityRole="button"
          accessibilityLabel="Restore purchases"
        >
          <Text style={[styles.restoreText, { color: c.secondaryText }]}>
            Restore Purchases
          </Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: s(16),
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: s(20),
    paddingBottom: s(8),
  },
  headerTitle: {
    fontSize: ms(22),
  },
  leagueSubtitle: {
    fontSize: ms(13),
    paddingHorizontal: s(20),
    marginBottom: s(8),
  },
  toggleRow: {
    flexDirection: "row",
    marginHorizontal: s(20),
    borderRadius: 10,
    padding: s(3),
    marginBottom: s(16),
  },
  toggleButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: s(8),
    borderRadius: 8,
    gap: s(6),
  },
  toggleText: {
    fontSize: ms(14),
    fontWeight: "600",
  },
  saveBadge: {
    backgroundColor: "#34C759",
    paddingHorizontal: s(6),
    paddingVertical: s(2),
    borderRadius: 4,
  },
  saveBadgeText: {
    color: "#FFFFFF",
    fontSize: ms(10),
    fontWeight: "700",
  },
  scrollArea: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: s(20),
    paddingBottom: s(16),
    gap: s(16),
  },
  planCard: {
    borderWidth: 1.5,
    borderRadius: 16,
    padding: s(18),
    gap: s(10),
  },
  planHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: s(4),
  },
  planName: {
    fontSize: ms(20),
    fontWeight: "700",
  },
  planTagline: {
    fontSize: ms(12),
    fontWeight: "500",
    marginTop: s(2),
  },
  planPrice: {
    fontSize: ms(18),
    fontWeight: "700",
  },
  pricePlaceholder: {
    width: s(72),
    height: ms(18),
    borderRadius: 4,
    marginTop: s(2),
  },
  featureRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: s(8),
  },
  featureText: {
    fontSize: ms(14),
    flex: 1,
  },
  purchaseButton: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: s(14),
    borderRadius: 10,
    marginTop: s(6),
  },
  purchaseButtonText: {
    color: "#FFFFFF",
    fontSize: ms(16),
    fontWeight: "700",
  },
  restoreButton: {
    alignItems: "center",
    paddingVertical: s(14),
    paddingBottom: s(24),
  },
  restoreText: {
    fontSize: ms(13),
    fontWeight: "500",
  },
});
