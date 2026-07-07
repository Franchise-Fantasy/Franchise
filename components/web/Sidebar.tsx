import { Ionicons } from "@expo/vector-icons";
import { Link, usePathname, useRouter } from "expo-router";
import React, { useState } from "react";
import { Image, ScrollView, StyleSheet, TouchableOpacity, View } from "react-native";

import { LeagueSwitcher } from "@/components/home/LeagueSwitcher";
import { TeamLogo } from "@/components/team/TeamLogo";
import { LeagueMetaChips } from "@/components/ui/LeagueMetaChips";
import { ThemedText } from "@/components/ui/ThemedText";
import { Fonts } from "@/constants/Colors";
import { useAppState } from "@/context/AppStateProvider";
import { useTotalUnread } from "@/hooks/chat";
import { useColors } from "@/hooks/useColors";
import { useLeague } from "@/hooks/useLeague";

const PATCH = require("@/assets/images/F_patch.png");

type NavItem = {
  label: string;
  href: string;
  icon: keyof typeof Ionicons.glyphMap;
  isActive: (pathname: string) => boolean;
  dynastyOnly?: boolean;
};

// "My team" — the surfaces about the user's own roster/decisions.
const MY_TEAM: NavItem[] = [
  { label: "Home", href: "/", icon: "home-outline", isActive: (p) => p === "/" },
  { label: "Matchup", href: "/matchup", icon: "basketball-outline", isActive: (p) => p.startsWith("/matchup") },
  { label: "Roster", href: "/roster", icon: "people-outline", isActive: (p) => p.startsWith("/roster") },
  { label: "Free Agents", href: "/free-agents", icon: "person-add-outline", isActive: (p) => p.startsWith("/free-agents") },
];

// "League" — everyone's shared surfaces (formerly the home "Explore" grid).
const LEAGUE: NavItem[] = [
  { label: "Standings", href: "/standings", icon: "podium-outline", isActive: (p) => p.startsWith("/standings") },
  { label: "Scoreboard", href: "/scoreboard", icon: "stats-chart-outline", isActive: (p) => p.startsWith("/scoreboard") },
  { label: "Schedule", href: "/schedule", icon: "calendar-outline", isActive: (p) => p.startsWith("/schedule") },
  { label: "Trades", href: "/trades", icon: "swap-horizontal-outline", isActive: (p) => p.startsWith("/trades") },
  { label: "Activity", href: "/activity", icon: "time-outline", isActive: (p) => p.startsWith("/activity") },
  { label: "Playoffs", href: "/playoff-bracket", icon: "trophy-outline", isActive: (p) => p.startsWith("/playoff") },
  { label: "News", href: "/news", icon: "newspaper-outline", isActive: (p) => p.startsWith("/news") },
  { label: "Draft", href: "/draft-hub", icon: "clipboard-outline", isActive: (p) => p.startsWith("/draft"), dynastyOnly: true },
  { label: "History", href: "/league-history", icon: "library-outline", isActive: (p) => p.startsWith("/league-history") },
];

type Team = {
  id: string;
  name: string;
  tricode: string | null;
  logo_key: string | null;
  wins: number | null;
  losses: number | null;
  ties: number | null;
};

/**
 * Desktop web navigation rail. This is the app's spine on web — it carries the
 * brand, the active-league switcher (moved off the old floating top bar), the
 * full grouped navigation (which absorbs the home screen's old "Explore" grid),
 * and a team/chat footer. Rendered by WebShell.web.tsx for signed-in app
 * screens; web-only, never reaches a native bundle.
 */
export function Sidebar() {
  const c = useColors();
  const pathname = usePathname();
  const router = useRouter();
  const { teamId } = useAppState();
  const { data: league } = useLeague();
  const { data: unread } = useTotalUnread();
  const [switcherVisible, setSwitcherVisible] = useState(false);

  const isDynasty = (league?.league_type ?? "dynasty") === "dynasty";
  const leagueItems = LEAGUE.filter((i) => !i.dynastyOnly || isDynasty);

  const myTeam =
    (((league?.league_teams as Team[] | undefined) ?? []).find((t) => t.id === teamId)) ?? null;
  const record = myTeam
    ? myTeam.ties && myTeam.ties > 0
      ? `${myTeam.wins ?? 0}-${myTeam.losses ?? 0}-${myTeam.ties}`
      : `${myTeam.wins ?? 0}-${myTeam.losses ?? 0}`
    : null;

  const renderItem = (item: NavItem) => {
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
          <Ionicons name={item.icon} size={19} color={active ? c.gold : c.secondaryText} />
          <ThemedText style={[styles.label, { color: active ? c.text : c.secondaryText }]}>
            {item.label}
          </ThemedText>
        </TouchableOpacity>
      </Link>
    );
  };

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
        <ThemedText style={[styles.wordmark, { color: c.text }]}>FRANCHISE</ThemedText>
      </View>

      <TouchableOpacity
        style={[styles.switcher, { backgroundColor: c.cardAlt, borderColor: c.border }]}
        onPress={() => setSwitcherVisible(true)}
        accessibilityRole="button"
        accessibilityLabel="Switch league"
        accessibilityHint="Opens the league switcher"
      >
        <View style={styles.switcherText}>
          <ThemedText
            type="varsity"
            numberOfLines={1}
            style={[styles.switcherName, { color: c.text }]}
          >
            {league?.name ?? "Franchise"}
          </ThemedText>
          {league && (
            <LeagueMetaChips
              sport={league.sport}
              leagueType={league.league_type}
              scoringType={league.scoring_type}
              size="small"
              style={styles.switcherChips}
            />
          )}
        </View>
        <Ionicons name="chevron-expand" size={16} color={c.secondaryText} />
      </TouchableOpacity>

      <ScrollView style={styles.nav} contentContainerStyle={styles.navContent} showsVerticalScrollIndicator={false}>
        <ThemedText style={[styles.groupLabel, { color: c.secondaryText }]}>MY TEAM</ThemedText>
        {MY_TEAM.map(renderItem)}
        <ThemedText style={[styles.groupLabel, styles.groupLabelSpaced, { color: c.secondaryText }]}>
          LEAGUE
        </ThemedText>
        {leagueItems.map(renderItem)}
      </ScrollView>

      <View style={[styles.footer, { borderTopColor: c.border }]}>
        {myTeam && (
          <View style={styles.teamRow}>
            <TeamLogo logoKey={myTeam.logo_key} teamName={myTeam.name} tricode={myTeam.tricode ?? undefined} size="small" />
            <View style={styles.teamText}>
              <ThemedText type="defaultSemiBold" numberOfLines={1} style={[styles.teamName, { color: c.text }]}>
                {myTeam.name}
              </ThemedText>
              {record && (
                <ThemedText style={[styles.teamRecord, { color: c.secondaryText }]}>{record}</ThemedText>
              )}
            </View>
          </View>
        )}
        <View style={styles.footerActions}>
          <TouchableOpacity
            style={[styles.footerBtn, { borderColor: c.border }]}
            onPress={() => router.push("/chat")}
            accessibilityRole="button"
            accessibilityLabel={`Chat${(unread ?? 0) > 0 ? `, ${unread! > 99 ? "99+" : unread} unread` : ""}`}
          >
            <Ionicons name="chatbubble-outline" size={18} color={c.secondaryText} />
            <ThemedText style={[styles.footerBtnLabel, { color: c.secondaryText }]}>Chat</ThemedText>
            {(unread ?? 0) > 0 && (
              <View style={[styles.badge, { backgroundColor: c.danger }]} accessible={false}>
                <ThemedText style={[styles.badgeText, { color: c.statusText }]}>
                  {unread! > 99 ? "99+" : unread}
                </ThemedText>
              </View>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.footerIconBtn, { borderColor: c.border }]}
            onPress={() => router.push("/profile")}
            accessibilityRole="button"
            accessibilityLabel="Profile and settings"
          >
            <Ionicons name="settings-outline" size={18} color={c.secondaryText} />
          </TouchableOpacity>
        </View>
      </View>

      <LeagueSwitcher visible={switcherVisible} onClose={() => setSwitcherVisible(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  sidebar: {
    width: 264,
    borderRightWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingTop: 22,
    paddingBottom: 14,
  },
  brand: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 8,
    marginBottom: 18,
  },
  patch: {
    width: 40,
    height: 38,
  },
  wordmark: {
    fontFamily: Fonts.varsityBold,
    fontSize: 17,
    letterSpacing: 1.5,
  },
  switcher: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 16,
  },
  switcherText: {
    flex: 1,
  },
  switcherName: {
    fontSize: 13,
    letterSpacing: 0.6,
  },
  switcherChips: {
    marginTop: 5,
  },
  nav: {
    flex: 1,
  },
  navContent: {
    paddingBottom: 8,
  },
  groupLabel: {
    fontFamily: Fonts.varsityBold,
    fontSize: 10,
    letterSpacing: 1.4,
    marginBottom: 8,
    paddingHorizontal: 12,
  },
  groupLabelSpaced: {
    marginTop: 18,
  },
  item: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 10,
  },
  activeBar: {
    position: "absolute",
    left: 0,
    top: 7,
    bottom: 7,
    width: 3,
    borderRadius: 2,
  },
  label: {
    fontFamily: Fonts.varsitySemibold,
    fontSize: 13,
    letterSpacing: 0.5,
  },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 12,
    gap: 10,
  },
  teamRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 8,
  },
  teamText: {
    flex: 1,
  },
  teamName: {
    fontSize: 13,
  },
  teamRecord: {
    fontSize: 11,
    marginTop: 1,
  },
  footerActions: {
    flexDirection: "row",
    gap: 8,
  },
  footerBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 9,
    paddingHorizontal: 12,
  },
  footerBtnLabel: {
    fontFamily: Fonts.varsitySemibold,
    fontSize: 12,
    letterSpacing: 0.5,
  },
  footerIconBtn: {
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 9,
    paddingHorizontal: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  badge: {
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
    marginLeft: "auto",
  },
  badgeText: {
    fontSize: 10,
    fontWeight: "700",
    lineHeight: 16,
  },
});
