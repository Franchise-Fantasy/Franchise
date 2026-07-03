import { Ionicons } from "@expo/vector-icons";
import { Link, usePathname } from "expo-router";
import React from "react";
import { Image, StyleSheet, TouchableOpacity, View } from "react-native";

import { ThemedText } from "@/components/ui/ThemedText";
import { Fonts } from "@/constants/Colors";
import { useColors } from "@/hooks/useColors";

const PATCH = require("@/assets/images/F_patch.png");

type NavItem = {
  label: string;
  href: string;
  icon: keyof typeof Ionicons.glyphMap;
  isActive: (pathname: string) => boolean;
};

const ITEMS: NavItem[] = [
  { label: "Home", href: "/", icon: "home-outline", isActive: (p) => p === "/" },
  { label: "Matchup", href: "/matchup", icon: "basketball-outline", isActive: (p) => p.startsWith("/matchup") },
  { label: "Roster", href: "/roster", icon: "people-outline", isActive: (p) => p.startsWith("/roster") },
  { label: "Players", href: "/free-agents", icon: "person-add-outline", isActive: (p) => p.startsWith("/free-agents") },
  { label: "Draft", href: "/draft-hub", icon: "clipboard-outline", isActive: (p) => p.startsWith("/draft") },
  { label: "Standings", href: "/standings", icon: "trophy-outline", isActive: (p) => p.startsWith("/standings") },
  { label: "Profile", href: "/profile", icon: "person-circle-outline", isActive: (p) => p.startsWith("/profile") },
];

/**
 * Desktop web navigation rail. Replaces the mobile bottom-tab bar (hidden on
 * web in app/(tabs)/_layout.tsx) — rendered by WebShell.web.tsx for signed-in
 * app screens. Web-only; never reaches a native bundle.
 */
export function Sidebar() {
  const c = useColors();
  const pathname = usePathname();

  return (
    <View style={[styles.sidebar, { backgroundColor: c.card, borderRightColor: c.border }]}>
      <View style={styles.brand}>
        <Image
          source={PATCH}
          style={styles.patch}
          resizeMode="contain"
          accessibilityLabel="Franchise"
          accessibilityRole="image"
        />
      </View>
      <View style={styles.nav}>
        {ITEMS.map((item) => {
          const active = item.isActive(pathname);
          return (
            <Link key={item.href} href={item.href as never} asChild>
              <TouchableOpacity
                // Link asChild merges props into the child through a Slot, which
                // can't handle array styles on web — flatten to a single object.
                style={StyleSheet.flatten([styles.item, active && { backgroundColor: c.cardAlt }])}
                accessibilityRole="link"
                accessibilityLabel={item.label}
                accessibilityState={{ selected: active }}
              >
                <View style={[styles.activeBar, { backgroundColor: active ? c.gold : "transparent" }]} />
                <Ionicons name={item.icon} size={20} color={active ? c.gold : c.secondaryText} />
                <ThemedText style={[styles.label, { color: active ? c.text : c.secondaryText }]}>
                  {item.label}
                </ThemedText>
              </TouchableOpacity>
            </Link>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sidebar: {
    width: 232,
    borderRightWidth: StyleSheet.hairlineWidth,
    paddingTop: 24,
    paddingHorizontal: 12,
  },
  brand: {
    alignItems: "center",
    paddingVertical: 12,
    marginBottom: 16,
  },
  patch: {
    width: 56,
    height: 52,
  },
  nav: {
    gap: 4,
  },
  item: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 11,
    paddingHorizontal: 12,
    borderRadius: 10,
  },
  activeBar: {
    position: "absolute",
    left: 0,
    top: 8,
    bottom: 8,
    width: 3,
    borderRadius: 2,
  },
  label: {
    fontFamily: Fonts.varsitySemibold,
    fontSize: 13,
    letterSpacing: 0.6,
  },
});
