import { ThemedText } from "@/components/ui/ThemedText";
import { Colors } from "@/constants/Colors";
import { ms, s } from '@/utils/scale';
import {
  SubscriptionTier,
  TIER_COLORS,
  TIER_LABELS,
} from "@/constants/Subscriptions";
import { useColorScheme } from "@/hooks/useColorScheme";
import { initPurchases, getOfferings, purchasePackage, restorePurchases } from "@/lib/purchases";
import Purchases, { PurchasesPackage } from "react-native-purchases";
import { useSession } from "@/context/AuthProvider";
import { useSubscription } from "@/hooks/useSubscription";
import { useQueryClient } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
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
  const { tier: currentTier } = useSubscription();
  const session = useSession();

  const [packages, setPackages] = useState<PurchasesPackage[]>([]);
  const [loadingOfferings, setLoadingOfferings] = useState(false);

  // Init RevenueCat then fetch offerings — sequential, no race condition
  useEffect(() => {
    if (!visible || !session?.user?.id) return;
    let cancelled = false;

    (async () => {
      setLoadingOfferings(true);
      await initPurchases(session.user.id);
      const offering = await getOfferings();
      if (!cancelled) {
        setPackages(offering?.availablePackages ?? []);
        setLoadingOfferings(false);
      }
    })();

    return () => { cancelled = true; };
  }, [visible, session?.user?.id]);

  const findPkg = (id: string) => packages.find(p => p.identifier === id) ?? null;

  const [annual, setAnnual] = useState(true);
  const [purchasing, setPurchasing] = useState<SubscriptionTier | null>(null);

  const proPackage = leagueMode
    ? annual
      ? findPkg("league_pro_annual")
      : findPkg("league_pro_monthly")
    : annual
      ? findPkg("pro_annual")
      : findPkg("pro_monthly");

  const premiumPackage = leagueMode
    ? annual
      ? findPkg("league_premium_annual")
      : findPkg("league_premium_monthly")
    : annual
      ? findPkg("premium_annual")
      : findPkg("premium_monthly");

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

    setPurchasing(tier);
    try {
      await purchasePackage(pkg);
      // Give the webhook a moment to write to DB before refetching
      await new Promise(resolve => setTimeout(resolve, 2000));
      await queryClient.invalidateQueries({ queryKey: ["userSubscription"] });
      await queryClient.invalidateQueries({ queryKey: ["leagueSubscription"] });
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
      const restored = await restorePurchases();
      queryClient.invalidateQueries({ queryKey: ["userSubscription"] });
      queryClient.invalidateQueries({ queryKey: ["leagueSubscription"] });
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

  const proPrice = proPackage?.product?.priceString;
  const premiumPrice = premiumPackage?.product?.priceString;


  // Fallback prices when RevenueCat isn't configured yet
  const proDisplay = proPrice ?? (annual ? "$34.99/yr" : "$4.99/mo");
  const premiumDisplay =
    premiumPrice ?? (annual ? "$59.99/yr" : "$9.99/mo");

  const leagueLabel = leagueMode ? "League " : "";

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
            {leagueMode
              ? "Upgrade Your League"
              : currentTier === "free"
                ? "Upgrade to Pro"
                : "Manage Plan"}
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
              <Text style={[styles.planPrice, { color: c.text }]}>
                {proDisplay}
              </Text>
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
                  backgroundColor: currentTier === "pro"
                    ? isDark ? "rgba(0,122,255,0.15)" : "rgba(0,122,255,0.1)"
                    : TIER_COLORS.pro,
                },
              ]}
              onPress={() => currentTier === "pro" ? handleManage() : handlePurchase("pro")}
              disabled={!!purchasing}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={
                currentTier === "pro"
                  ? "Current plan: Pro. Tap to manage."
                  : `Upgrade to ${leagueLabel}Pro for ${proDisplay}`
              }
            >
              {purchasing === "pro" ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <Text
                  style={[
                    styles.purchaseButtonText,
                    currentTier === "pro" && { color: TIER_COLORS.pro },
                  ]}
                >
                  {currentTier === "pro" ? "Current Plan — Manage" : `Get ${leagueLabel}Pro`}
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
              <Text style={[styles.planPrice, { color: c.text }]}>
                {premiumDisplay}
              </Text>
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
                  backgroundColor: currentTier === "premium"
                    ? isDark ? "rgba(255,184,0,0.15)" : "rgba(255,184,0,0.1)"
                    : TIER_COLORS.premium,
                },
              ]}
              onPress={() => currentTier === "premium" ? handleManage() : handlePurchase("premium")}
              disabled={!!purchasing}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={
                currentTier === "premium"
                  ? "Current plan: Premium. Tap to manage."
                  : `Upgrade to ${leagueLabel}Premium for ${premiumDisplay}`
              }
            >
              {purchasing === "premium" ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <Text
                  style={[
                    styles.purchaseButtonText,
                    currentTier === "premium" && { color: TIER_COLORS.premium },
                  ]}
                >
                  {currentTier === "premium" ? "Current Plan — Manage" : `Get ${leagueLabel}Premium`}
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
