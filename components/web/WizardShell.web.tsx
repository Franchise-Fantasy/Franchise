import { Ionicons } from "@expo/vector-icons";
import React, { useState } from "react";
import { Image, LayoutChangeEvent, Pressable, ScrollView, StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/ui/ThemedText";
import { Fonts, cardShadow } from "@/constants/Colors";
import { useColors } from "@/hooks/useColors";

const PATCH = require("@/assets/images/F_patch.png");

const RAIL_WIDTH = 210;
const ASIDE_WIDTH = 280;
// The form column is the point of the page; the summary is a bonus. Only show
// the summary when the sheet would STILL have room for its label gutter plus a
// comfortable value column afterwards — otherwise drop it and give the form the
// space. Measured off the real body width, not the window, because the app
// sidebar and step rail both eat into it.
const FORM_MIN_WITH_ASIDE = 660;

interface WizardShellProps {
  title: string;
  subtitle?: string;
  /** Ordered step labels. Omit to render without the progress rail (simple flows). */
  steps?: string[];
  /** 0-based index of the active step. */
  currentStep?: number;
  onCancel?: () => void;
  /** Jump to a step — the caller decides which indices are reachable. */
  onStepPress?: (index: number) => void;
  /** Persistent right-hand context panel (e.g. the live league summary). */
  aside?: React.ReactNode;
  /** Action row pinned under the scrollable step content (e.g. Back/Next). */
  footer?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * Desktop web frame for the create-league / import-league wizards. Three zones:
 * a persistent vertical step rail, the step form, and an optional context panel
 * — replacing the phone's cramped horizontal dots + single scrolling column. The
 * shared step components render inside unchanged. Mounted only behind
 * `isDesktop`, so native never sees it.
 */
export function WizardShell({
  title,
  subtitle,
  steps,
  currentStep = 0,
  onCancel,
  onStepPress,
  aside,
  footer,
  children,
}: WizardShellProps) {
  const c = useColors();
  const [bodyWidth, setBodyWidth] = useState(0);
  const hasRail = !!steps && steps.length > 0;
  const railWidth = hasRail ? RAIL_WIDTH : 0;
  const showAside =
    !!aside && bodyWidth >= railWidth + ASIDE_WIDTH + FORM_MIN_WITH_ASIDE;

  return (
    <View style={styles.page}>
      <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
        {/* ── Branded header ── */}
        <View style={[styles.header, { borderBottomColor: c.border }]}>
          <View style={styles.brand}>
            <Image
              source={PATCH}
              style={styles.patch}
              resizeMode="contain"
              accessibilityLabel="Franchise"
              accessibilityRole="image"
            />
            <View style={styles.brandText}>
              <ThemedText type="varsity" style={[styles.title, { color: c.text }]} accessibilityRole="header">
                {title}
              </ThemedText>
              {subtitle ? (
                <ThemedText style={[styles.subtitle, { color: c.secondaryText }]}>{subtitle}</ThemedText>
              ) : null}
            </View>
          </View>
          {onCancel ? (
            <Pressable
              onPress={onCancel}
              style={({ hovered }: { hovered?: boolean }) => [
                styles.close,
                hovered ? { backgroundColor: c.cardAlt } : null,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Cancel and exit"
            >
              <Ionicons name="close" size={20} color={c.secondaryText} />
            </Pressable>
          ) : null}
        </View>

        <View
          style={styles.body}
          onLayout={(e: LayoutChangeEvent) => setBodyWidth(e.nativeEvent.layout.width)}
        >
          {/* ── Vertical step rail ── */}
          {hasRail ? (
            <View style={[styles.rail, { borderRightColor: c.border, backgroundColor: c.cardAlt }]}>
              <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.railInner}>
                {steps!.map((label, i) => {
                  const active = i === currentStep;
                  const done = i < currentStep;
                  const clickable = done && !!onStepPress;
                  return (
                    <Pressable
                      key={label}
                      disabled={!clickable}
                      onPress={() => clickable && onStepPress!(i)}
                      style={({ hovered }: { hovered?: boolean }) => [
                        styles.railItem,
                        active ? { backgroundColor: c.card } : null,
                        clickable && hovered ? { backgroundColor: c.card } : null,
                      ]}
                      accessibilityRole={clickable ? "button" : undefined}
                      accessibilityLabel={`Step ${i + 1}, ${label}${active ? ", current step" : done ? ", completed" : ""}`}
                    >
                      <View
                        style={[
                          styles.railDot,
                          {
                            borderColor: active || done ? c.accent : c.border,
                            backgroundColor: done ? c.accent : "transparent",
                          },
                        ]}
                      >
                        {done ? (
                          <Ionicons name="checkmark" size={12} color={c.card} />
                        ) : (
                          <View
                            style={[styles.railDotInner, { backgroundColor: active ? c.accent : "transparent" }]}
                          />
                        )}
                      </View>
                      <ThemedText
                        style={[
                          styles.railLabel,
                          {
                            color: active ? c.text : c.secondaryText,
                            fontFamily: active ? Fonts.varsityBold : Fonts.varsitySemibold,
                          },
                        ]}
                        numberOfLines={1}
                      >
                        {label}
                      </ThemedText>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          ) : null}

          {/* ── Step content (scrolls) + pinned footer ── */}
          <View style={styles.content}>
            <ScrollView
              style={styles.scroll}
              contentContainerStyle={styles.scrollInner}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              <View style={styles.contentInner}>{children}</View>
            </ScrollView>
            {footer ? (
              <View style={[styles.footer, { borderTopColor: c.border }]}>
                <View style={styles.footerInner}>{footer}</View>
              </View>
            ) : null}
          </View>

          {/* ── Context panel (live summary) ── */}
          {showAside ? (
            <View style={[styles.aside, { borderLeftColor: c.border, backgroundColor: c.cardAlt }]}>
              <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.asideInner}>
                {aside}
              </ScrollView>
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );
}

// The charter sheet is one dense ruled column (label gutter + value column), not
// a stack of cards — this is the reading width it wants.
const CONTENT_MAX = 780;

const styles = StyleSheet.create({
  page: { flex: 1, alignItems: "center", paddingVertical: 24, paddingHorizontal: 24 },
  card: {
    flex: 1,
    width: "100%",
    maxWidth: 1400,
    borderWidth: 1,
    borderRadius: 18,
    overflow: "hidden",
    ...cardShadow,
  },

  // ─── Header ───────────────────────────────────────────────
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 24,
    paddingVertical: 16,
    borderBottomWidth: 1,
  },
  brand: { flexDirection: "row", alignItems: "center", gap: 14 },
  brandText: { gap: 2 },
  patch: { width: 32, height: 30 },
  title: { fontSize: 17, letterSpacing: 0.4 },
  subtitle: { fontSize: 12.5, lineHeight: 16 },
  close: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },

  // ─── Body / step rail ─────────────────────────────────────
  body: { flex: 1, flexDirection: "row", alignItems: "stretch" },
  rail: { width: RAIL_WIDTH, borderRightWidth: 1 },
  railInner: { paddingVertical: 18, paddingHorizontal: 14, gap: 2 },
  railItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 9,
    paddingHorizontal: 10,
    borderRadius: 9,
  },
  railDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  railDotInner: { width: 8, height: 8, borderRadius: 4 },
  railLabel: { fontSize: 12.5, letterSpacing: 0.4, flexShrink: 1 },

  // ─── Content ──────────────────────────────────────────────
  content: { flex: 1, minWidth: 0 },
  scroll: { flex: 1 },
  scrollInner: { paddingVertical: 28, paddingHorizontal: 32 },
  contentInner: { width: "100%", maxWidth: CONTENT_MAX, alignSelf: "center" },
  footer: { borderTopWidth: 1, paddingVertical: 14, paddingHorizontal: 32 },
  footerInner: { width: "100%", maxWidth: CONTENT_MAX, alignSelf: "center" },

  // ─── Context panel ────────────────────────────────────────
  aside: { width: ASIDE_WIDTH, borderLeftWidth: 1 },
  asideInner: { paddingVertical: 24, paddingHorizontal: 22 },
});
