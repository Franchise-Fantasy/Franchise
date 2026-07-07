import { usePathname } from "expo-router";
import React from "react";
import { StyleSheet, View } from "react-native";

import { useAppState } from "@/context/AppStateProvider";
import { useSession } from "@/context/AuthProvider";
import { useColors } from "@/hooks/useColors";

import { Sidebar } from "./Sidebar";

// Phone-width column for pre-login / setup / standalone screens so they don't
// stretch. Content column width for the sidebar'd app screens.
const NARROW_MAX = 480;
const CONTENT_MAX = 960;
// Dashboard-style screens that are built as a multi-column grid want more room
// than the reading column — otherwise they leave big empty side gutters on a
// wide monitor. Add a route here once its desktop layout fills the extra width.
const WIDE_MAX = 1240;
const WIDE_ROUTES = new Set(["/", "/standings"]);

// Immersive routes take the whole viewport with no sidebar.
const IMMERSIVE_PREFIXES = ["/draft-room", "/lottery-room"];
// Signed-in routes that still shouldn't show the app sidebar.
const NO_SIDEBAR_PREFIXES = ["/legal", "/reset-password"];

/**
 * Desktop web shell. Replaces the mobile bottom-tab chrome with a persistent
 * left sidebar wrapping every app screen, and caps content width so phone-first
 * layouts read as a contained desktop app rather than stretching edge-to-edge.
 * Only renders the sidebar once the user is signed in AND has a league (so the
 * auth + setup flows stay clean); immersive routes (draft/lottery rooms) go
 * full-bleed.
 */
export function WebShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const session = useSession();
  const { leagueId } = useAppState();
  const c = useColors();

  const immersive = IMMERSIVE_PREFIXES.some((p) => pathname.startsWith(p));
  if (immersive) return <>{children}</>;

  const showSidebar =
    !!session &&
    !!leagueId &&
    !NO_SIDEBAR_PREFIXES.some((p) => pathname.startsWith(p));

  if (!showSidebar) {
    return <View style={styles.narrow}>{children}</View>;
  }

  const contentMax = WIDE_ROUTES.has(pathname) ? WIDE_MAX : CONTENT_MAX;

  return (
    <View style={styles.row}>
      <Sidebar />
      <View style={[styles.contentCell, { backgroundColor: c.background }]}>
        <View style={[styles.contentInner, { maxWidth: contentMax }]}>{children}</View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  narrow: { flex: 1, width: "100%", maxWidth: NARROW_MAX, alignSelf: "center" },
  row: { flex: 1, flexDirection: "row" },
  contentCell: { flex: 1 },
  contentInner: { flex: 1, width: "100%", alignSelf: "center" },
});
