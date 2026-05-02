import { Ionicons } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";
import {
  Alert,
  Linking,
  Modal,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from "react-native";
import Purchases from "react-native-purchases";

import { LogoSpinner } from "@/components/ui/LogoSpinner";
import { ThemedText } from "@/components/ui/ThemedText";
import { Brand, Colors, Fonts } from "@/constants/Colors";
import {
  SubscriptionTier,
  TIER_COLORS,
  TIER_LABELS,
  TIER_RANK,
} from "@/constants/Subscriptions";
import { useAppState } from "@/context/AppStateProvider";
import { useSession } from "@/context/AuthProvider";
import { useColors } from "@/hooks/useColors";
import { useColorScheme } from "@/hooks/useColorScheme";
import { useOfferings } from "@/hooks/useOfferings";
import { useSubscription, waitForSubscriptionChange } from "@/hooks/useSubscription";
import {
  purchasePackage,
  restorePurchases,
  syncSubscriptionFromRC,
} from "@/lib/purchases";
import { ms, s } from '@/utils/scale';


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

const TIER_TAGLINE: Record<Exclude<SubscriptionTier, 'free'>, string> = {
  pro: "The Analyst",
  premium: "The Edge",
};

export function UpgradeModal({
  visible,
  onClose,
  highlightFeature,
  leagueMode = false,
}: UpgradeModalProps) {
  // `highlightFeature` is consumed by the caller's analytics tracking; the
  // modal itself doesn't currently scroll-to-tier on it. Keep the prop so
  // call sites stay typed correctly.
  void highlightFeature;
  const c = useColors();
  const queryClient = useQueryClient();
  const router = useRouter();
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
      let synced = await waitForSubscriptionChange({
        userId: session?.user?.id,
        leagueId,
        leagueMode,
        expectedTier: tier,
        expectedPeriod,
        previousPeriod: currentTier === tier ? (currentPeriod ?? undefined) : undefined,
      });
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
        label: annual ? `Switch to Annual — Save 40%` : `Switch to Monthly`,
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

  const runCta = (kind: PlanCtaKind, tier: SubscriptionTier) => {
    if (kind === "owned" || kind === "downgrade") return handleManage();
    return handlePurchase(tier);
  };

  const headerTitle = leagueMode
    ? currentTier === "free" ? "Upgrade Your League." : "League Plan."
    : currentTier === "free"
      ? "Build Your Edge."
      : currentTier === "pro"
        ? "Unlock Premium."
        : "Manage Plan.";

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={[styles.container, { backgroundColor: c.background }]}>
        {/* Header row — display title on the left, close button on the right.
            One row instead of stacking eyebrow + title + close. */}
        <View style={styles.headerRow}>
          <ThemedText
            type="display"
            style={[styles.heroTitle, { color: c.text }]}
            accessibilityRole="header"
            numberOfLines={1}
          >
            {headerTitle}
          </ThemedText>
          <TouchableOpacity
            onPress={onClose}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel="Close"
            style={[styles.closeBtn, { backgroundColor: c.cardAlt }]}
          >
            <Ionicons name="close" size={18} color={c.text} />
          </TouchableOpacity>
        </View>

        <ScrollView
          style={styles.scrollArea}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {leagueMode && (
            <ThemedText style={[styles.heroSubtitle, { color: c.secondaryText }]}>
              Every team in your league gets access. One purchase, whole league.
            </ThemedText>
          )}

          {/* Period toggle — brand-styled pill segmenter */}
          <View style={[styles.toggleRow, { backgroundColor: c.cardAlt, borderColor: c.border }]}>
            <TouchableOpacity
              style={[
                styles.toggleButton,
                !annual && [styles.toggleButtonActive, { backgroundColor: c.card, borderColor: c.border }],
              ]}
              onPress={() => setAnnual(false)}
              accessibilityRole="button"
              accessibilityLabel="Monthly pricing"
              accessibilityState={{ selected: !annual }}
              activeOpacity={0.8}
            >
              <ThemedText
                type="varsity"
                style={[
                  styles.toggleText,
                  { color: !annual ? c.text : c.secondaryText },
                ]}
              >
                Monthly
              </ThemedText>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.toggleButton,
                annual && [styles.toggleButtonActive, { backgroundColor: c.card, borderColor: c.border }],
              ]}
              onPress={() => setAnnual(true)}
              accessibilityRole="button"
              accessibilityLabel="Annual pricing, save 40%"
              accessibilityState={{ selected: annual }}
              activeOpacity={0.8}
            >
              <ThemedText
                type="varsity"
                style={[
                  styles.toggleText,
                  { color: annual ? c.text : c.secondaryText },
                ]}
              >
                Annual
              </ThemedText>
              {annual && (
                <View style={[styles.saveBadge, { backgroundColor: c.primary }]}>
                  <ThemedText type="varsitySmall" style={styles.saveBadgeText}>
                    Save 40%
                  </ThemedText>
                </View>
              )}
            </TouchableOpacity>
          </View>

          {/* Auto-renew disclosure — required by App Store Guideline 3.1.2.
              Apple wants this visible near the price selector, not buried. */}
          <ThemedText
            style={[styles.autoRenewText, { color: c.secondaryText }]}
            accessibilityLabel="Subscription auto-renews. Cancel anytime in your device settings."
          >
            Auto-renews until cancelled. Manage anytime in your device's subscription settings.
          </ThemedText>

          {/* Pro Card */}
          <PlanCard
            tierColor={TIER_COLORS.pro}
            label={`${leagueLabel}Pro`}
            tagline={TIER_TAGLINE.pro}
            price={proDisplay}
            features={PRO_FEATURES}
            cta={proCta}
            disabled={
              !!purchasing
              || loadingOfferings
              || (!proPackage && proCta.kind !== "owned" && proCta.kind !== "downgrade")
            }
            loading={purchasing === "pro" || (loadingOfferings && proCta.kind !== "owned")}
            onPress={() => runCta(proCta.kind, "pro")}
          />

          {/* Premium Card */}
          <PlanCard
            tierColor={TIER_COLORS.premium}
            label={`${leagueLabel}Premium`}
            tagline={TIER_TAGLINE.premium}
            price={premiumDisplay}
            features={PREMIUM_FEATURES}
            cta={premiumCta}
            disabled={
              !!purchasing
              || loadingOfferings
              || (!premiumPackage && premiumCta.kind !== "owned" && premiumCta.kind !== "downgrade")
            }
            loading={purchasing === "premium" || (loadingOfferings && premiumCta.kind !== "owned")}
            onPress={() => runCta(premiumCta.kind, "premium")}
          />

          {/* Restore + legal links — Apple wants Terms and Privacy reachable
              from inside the paywall, not just from a separate menu. */}
          <View style={styles.footer}>
            <TouchableOpacity
              onPress={handleRestore}
              disabled={!!purchasing}
              accessibilityRole="button"
              accessibilityLabel="Restore purchases"
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            >
              <ThemedText
                type="varsitySmall"
                style={[styles.footerLink, { color: c.secondaryText }]}
              >
                Restore Purchases
              </ThemedText>
            </TouchableOpacity>
            <ThemedText style={[styles.footerSeparator, { color: c.secondaryText }]}>·</ThemedText>
            <TouchableOpacity
              onPress={() => {
                onClose();
                router.push('/legal?tab=terms' as any);
              }}
              accessibilityRole="link"
              accessibilityLabel="Terms of Service"
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            >
              <ThemedText
                type="varsitySmall"
                style={[styles.footerLink, { color: c.secondaryText }]}
              >
                Terms
              </ThemedText>
            </TouchableOpacity>
            <ThemedText style={[styles.footerSeparator, { color: c.secondaryText }]}>·</ThemedText>
            <TouchableOpacity
              onPress={() => {
                onClose();
                router.push('/legal?tab=privacy' as any);
              }}
              accessibilityRole="link"
              accessibilityLabel="Privacy Policy"
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            >
              <ThemedText
                type="varsitySmall"
                style={[styles.footerLink, { color: c.secondaryText }]}
              >
                Privacy
              </ThemedText>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

// ── Plan card ──────────────────────────────────────────────────────────

interface PlanCardProps {
  tierColor: string;
  label: string;
  tagline: string;
  price: string | null;
  features: string[];
  cta: { kind: "owned" | "switch" | "upgrade" | "buy" | "downgrade"; label: string; a11yLabel: string };
  disabled: boolean;
  loading: boolean;
  onPress: () => void;
}

function PlanCard({
  tierColor,
  label,
  tagline,
  price,
  features,
  cta,
  disabled,
  loading,
  onPress,
}: PlanCardProps) {
  const scheme = useColorScheme() ?? "light";
  const c = Colors[scheme];
  const isOwned = cta.kind === "owned";

  return (
    <View
      style={[
        styles.planCard,
        { backgroundColor: c.card, borderColor: c.border },
      ]}
    >
      {/* Tier accent rule — full-width top edge in the tier color */}
      <View style={[styles.planAccent, { backgroundColor: tierColor }]} />

      <View style={styles.planBody}>
        <View style={styles.planHeader}>
          <View style={{ flex: 1 }}>
            <ThemedText
              type="varsitySmall"
              style={[styles.planTagline, { color: tierColor }]}
            >
              {tagline}
            </ThemedText>
            <ThemedText
              type="display"
              style={[styles.planName, { color: c.text }]}
            >
              {label}.
            </ThemedText>
          </View>
          {price ? (
            <View style={styles.priceBlock}>
              <ThemedText style={[styles.planPrice, { color: c.text }]}>
                {price}
              </ThemedText>
            </View>
          ) : (
            <View style={[styles.pricePlaceholder, { backgroundColor: c.cardAlt }]} />
          )}
        </View>

        {/* Gold rule between header and features (HomeHero stat-row vibe) */}
        <View style={[styles.featureDivider, { backgroundColor: c.gold }]} />

        {features.map((feature) => (
          <View style={styles.featureRow} key={feature}>
            <Ionicons
              name="checkmark"
              size={12}
              color={tierColor}
              accessible={false}
            />
            <ThemedText style={[styles.featureText, { color: c.text }]}>
              {feature}
            </ThemedText>
          </View>
        ))}

        <TouchableOpacity
          style={[
            styles.purchaseButton,
            isOwned
              ? { backgroundColor: 'transparent', borderColor: tierColor, borderWidth: 1 }
              : { backgroundColor: tierColor },
            disabled && { opacity: 0.55 },
          ]}
          onPress={onPress}
          disabled={disabled}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel={cta.a11yLabel}
        >
          {loading ? (
            <LogoSpinner size={18} />
          ) : (
            <ThemedText
              type="varsity"
              style={[
                styles.purchaseButtonText,
                { color: isOwned ? tierColor : Brand.ecru },
              ]}
            >
              {cta.label}
            </ThemedText>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },

  // Header row — Alfa Slab title left, close button right.
  // Title carries the brand voice; close stays out of the way on the side.
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: s(20),
    paddingTop: s(12),
    paddingBottom: s(12),
    gap: s(12),
  },
  closeBtn: {
    width: s(28),
    height: s(28),
    borderRadius: s(14),
    alignItems: 'center',
    justifyContent: 'center',
  },

  scrollArea: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: s(20),
    paddingBottom: s(20),
  },

  heroTitle: {
    flex: 1,
    fontSize: ms(22),
    lineHeight: ms(26),
    letterSpacing: -0.3,
  },
  heroSubtitle: {
    fontSize: ms(12),
    lineHeight: ms(16),
    marginBottom: s(8),
  },

  // Period toggle — brand pill segmenter (tightened)
  toggleRow: {
    flexDirection: 'row',
    borderRadius: 10,
    borderWidth: 1,
    padding: s(3),
    marginBottom: s(6),
  },
  toggleButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: s(7),
    borderRadius: 8,
    gap: s(8),
  },
  toggleButtonActive: {
    borderWidth: 1,
  },
  toggleText: {
    fontSize: ms(11),
    letterSpacing: 1.0,
  },
  saveBadge: {
    paddingHorizontal: s(6),
    paddingVertical: s(1.5),
    borderRadius: 4,
  },
  saveBadgeText: {
    color: Brand.ecru,
    fontSize: ms(8),
    letterSpacing: 0.8,
  },

  autoRenewText: {
    fontSize: ms(9),
    lineHeight: ms(13),
    marginBottom: s(10),
    textAlign: 'center',
  },

  // Plan card — tighter padding + smaller header so two cards stack in view
  planCard: {
    borderWidth: 1,
    borderRadius: 14,
    overflow: 'hidden',
    marginBottom: s(10),
  },
  planAccent: {
    height: s(3),
  },
  planBody: {
    padding: s(14),
    gap: s(4),
  },
  planHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: s(10),
  },
  planTagline: {
    fontSize: ms(9),
    letterSpacing: 1.4,
    marginBottom: s(1),
  },
  planName: {
    fontSize: ms(20),
    lineHeight: ms(24),
    letterSpacing: -0.3,
  },
  priceBlock: { alignItems: 'flex-end' },
  planPrice: {
    fontFamily: Fonts.mono,
    fontSize: ms(14),
    letterSpacing: 0.3,
  },
  pricePlaceholder: {
    width: s(64),
    height: ms(14),
    borderRadius: 4,
  },

  featureDivider: {
    height: 1,
    marginVertical: s(6),
    opacity: 0.55,
  },

  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(8),
    paddingVertical: s(0),
  },
  featureText: {
    fontSize: ms(12),
    lineHeight: ms(16),
    flex: 1,
  },

  purchaseButton: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: s(10),
    borderRadius: 10,
    marginTop: s(8),
  },
  purchaseButtonText: {
    fontSize: ms(12),
    letterSpacing: 1.0,
  },

  // Footer — tightened
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: s(10),
    paddingTop: s(12),
    paddingBottom: s(8),
  },
  footerLink: {
    fontSize: ms(9),
    letterSpacing: 1.2,
  },
  footerSeparator: {
    fontSize: ms(11),
  },
});
