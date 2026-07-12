import { usePathname } from "expo-router";
import React from "react";
import { StyleSheet, View } from "react-native";

import { useAppState } from "@/context/AppStateProvider";
import { useSession } from "@/context/AuthProvider";
import { useColors } from "@/hooks/useColors";

import "./globalWebStyles";
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

// The setup wizards render their own full-chrome WizardShell card (step rail +
// form + optional summary panel), so they need a wider bound than the reading
// column — whether or not the sidebar is showing (a leagueless first-timer has
// none). They KEEP the sidebar when the user has a league: it's their only way
// out of the wizard and back to the app. WizardShell drops its summary panel
// before the form gets cramped, so the sidebar never costs us the column layout.
const WIZARD_MAX = 1480;
const WIZARD_PREFIXES = ["/create-league", "/import-league"];

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

  const isWizard = WIZARD_PREFIXES.some((p) => pathname.startsWith(p));

  const showSidebar =
    !!session &&
    !!leagueId &&
    !NO_SIDEBAR_PREFIXES.some((p) => pathname.startsWith(p));

  if (!showSidebar) {
    return <View style={isWizard ? styles.wizardStandalone : styles.narrow}>{children}</View>;
  }

  const contentMax = isWizard ? WIZARD_MAX : WIDE_ROUTES.has(pathname) ? WIDE_MAX : CONTENT_MAX;

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
  wizardStandalone: { flex: 1, width: "100%", maxWidth: WIZARD_MAX, alignSelf: "center" },
  row: { flex: 1, flexDirection: "row" },
  contentCell: { flex: 1 },
  contentInner: { flex: 1, width: "100%", alignSelf: "center" },
});
