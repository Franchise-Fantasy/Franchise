import { usePathname } from "expo-router";
import React from "react";
import { StyleSheet, View } from "react-native";

import { useAppState } from "@/context/AppStateProvider";
import { useSession } from "@/context/AuthProvider";
import { useColors } from "@/hooks/useColors";
import { isWebRouteLive, webRouteLabel } from "@/utils/web/webRouteStatus";

import "./globalWebStyles";
import { InProgressScreen } from "./InProgress";
import { Sidebar } from "./Sidebar";

// Phone-width column for pre-login / setup / standalone screens so they don't
// stretch. Content column width for the sidebar'd app screens.
const NARROW_MAX = 480;
const CONTENT_MAX = 960;
// Dashboard-style screens that are built as a multi-column grid want more room
// than the reading column — otherwise they leave big empty side gutters on a
// wide monitor. Add a route here once its desktop layout fills the extra width.
const WIDE_MAX = 1240;
const WIDE_ROUTES = new Set(["/", "/standings", "/draft-hub"]);

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
 *
 * It's also the beta's route guard. The sidebar won't link to an unported
 * screen, but a typed URL, a deep link or a notification tap still can — so
 * anything outside utils/web/webRouteStatus.ts shows the In Progress page here
 * instead of its phone-first layout. Covering the route in place (rather than
 * redirecting) keeps the sidebar up, so the user can see where they landed and
 * navigate on.
 */
export function WebShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const session = useSession();
  const { leagueId } = useAppState();
  const c = useColors();

  const live = isWebRouteLive(pathname);

  // `children` is the router's <Stack>, so a gated route must HIDE it, never
  // swap it out — dropping it would unmount the whole navigator and take the
  // navigation state with it. display:none keeps the tree mounted and costs no
  // layout, and the In Progress panel renders in its place.
  const content = (
    <>
      <View style={live ? styles.fill : styles.hidden}>{children}</View>
      {!live && <InProgressScreen label={webRouteLabel(pathname)} />}
    </>
  );

  // Only a *live* immersive route goes full-bleed — a gated one (the lottery
  // room) needs the shell's chrome so there's a way back out.
  const immersive = live && IMMERSIVE_PREFIXES.some((p) => pathname.startsWith(p));
  if (immersive) return <>{children}</>;

  const isWizard = WIZARD_PREFIXES.some((p) => pathname.startsWith(p));

  const showSidebar =
    !!session &&
    !!leagueId &&
    !NO_SIDEBAR_PREFIXES.some((p) => pathname.startsWith(p));

  if (!showSidebar) {
    return <View style={isWizard ? styles.wizardStandalone : styles.narrow}>{content}</View>;
  }

  const contentMax = isWizard ? WIZARD_MAX : WIDE_ROUTES.has(pathname) ? WIDE_MAX : CONTENT_MAX;

  return (
    <View style={styles.row}>
      <Sidebar />
      <View style={[styles.contentCell, { backgroundColor: c.background }]}>
        <View style={[styles.contentInner, { maxWidth: contentMax }]}>{content}</View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  hidden: { display: "none" },
  narrow: { flex: 1, width: "100%", maxWidth: NARROW_MAX, alignSelf: "center" },
  wizardStandalone: { flex: 1, width: "100%", maxWidth: WIZARD_MAX, alignSelf: "center" },
  row: { flex: 1, flexDirection: "row" },
  contentCell: { flex: 1 },
  contentInner: { flex: 1, width: "100%", alignSelf: "center" },
});
