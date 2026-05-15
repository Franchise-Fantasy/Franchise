import { StyleSheet } from "react-native";

import { ms, s } from "@/utils/scale";

export const freeAgentListStyles = StyleSheet.create({
  container: {
    flex: 1,
  },
  offseasonBanner: {
    paddingHorizontal: s(14),
    paddingVertical: s(12),
    marginHorizontal: s(8),
    marginTop: s(4),
    borderRadius: 8,
    borderWidth: 1,
    gap: s(6),
  },
  offseasonEyebrowRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: s(8),
  },
  offseasonRule: {
    height: 2,
    width: s(14),
  },
  offseasonEyebrow: {
    fontSize: ms(9),
    letterSpacing: 1.4,
  },
  offseasonBody: {
    fontSize: ms(13),
  },
  emptyState: {
    alignItems: "center",
    paddingTop: s(56),
    paddingHorizontal: s(24),
    gap: s(8),
  },
  emptyRule: {
    height: 2,
    width: s(28),
  },
  emptyEyebrow: {
    fontSize: ms(11),
    letterSpacing: 1.6,
  },
  emptyBody: {
    fontSize: ms(13),
    textAlign: "center",
  },
  listContent: {
    paddingHorizontal: s(8),
    paddingBottom: s(100),
  },
  colKey: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    // Match the row's effective horizontal padding (listContent s(8) + row s(12)).
    paddingHorizontal: s(20),
    paddingTop: s(8),
    paddingBottom: s(6),
    gap: s(8),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  colKeyStats: {
    alignItems: "flex-end",
  },
  colKeyText: {
    fontSize: ms(9),
    letterSpacing: 1.2,
    textAlign: "right" as const,
  },
  // Width-matched spacer for the row's round add-button column (28pt button + 0pt gap-equivalent).
  colKeyAddSpacer: {
    width: s(28),
  },
  ribbonRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: s(8),
    // Right padding matches the row's effective horizontal padding
    // (listContent s(8) + row s(12)) so the stat-key column sits over
    // the slash-line values, not the round add button.
    paddingRight: s(20),
    paddingTop: s(4),
    paddingBottom: s(4),
    gap: s(8),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  statInfoBtn: {
    paddingHorizontal: s(10),
    paddingVertical: s(4),
    marginLeft: "auto",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: s(6),
    paddingHorizontal: s(12),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  // The alt-row backgroundColor is applied inline in `FreeAgentRow` so it
  // can read `c.cardAlt` from the active sport theme.
  portraitWrap: {
    width: s(58),
    height: s(58),
    marginRight: s(10),
    alignItems: "center",
  },
  headshotCircle: {
    width: s(54),
    height: s(54),
    borderRadius: 29,
    borderWidth: 1.5,
    overflow: "hidden" as const,
  },
  headshotImg: {
    position: "absolute" as const,
    bottom: s(-2),
    left: 0,
    right: 0,
    height: s(48),
  },
  teamPill: {
    position: "absolute",
    bottom: 0,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.75)",
    borderRadius: 8,
    paddingHorizontal: s(4),
    paddingVertical: s(1),
    gap: s(2),
  },
  teamPillLogo: {
    width: s(10),
    height: s(10),
  },
  teamPillText: {
    fontSize: ms(8),
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  info: {
    flex: 1,
    marginRight: s(8),
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: s(4),
  },
  nameWrap: {
    flexShrink: 1,
  },
  // Off-screen measurement copy of the name; lays out at the wrap's full
  // width so onTextLayout reports the natural line count given available
  // space. Invisible to users and screen readers.
  nameMeasure: {
    position: "absolute",
    left: 0,
    right: 0,
    opacity: 0,
  },
  badge: {
    paddingHorizontal: s(4),
    paddingVertical: s(1),
    borderRadius: 3,
  },
  badgeText: {
    fontSize: ms(8),
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  posRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: s(4),
  },
  posText: {
    fontSize: ms(11),
    marginTop: 0,
  },
  waiverBadge: {
    paddingHorizontal: s(5),
    paddingVertical: s(1),
    borderRadius: 3,
    marginLeft: s(4),
  },
  waiverBadgeText: {
    fontSize: ms(9),
    fontWeight: "700",
  },
  gameTodayBadge: {
    paddingHorizontal: s(4),
    paddingVertical: s(1),
    borderRadius: 3,
  },
  gameTodayText: {
    fontSize: ms(9),
    fontWeight: "700",
  },
  rightSide: {
    flexDirection: "row",
    alignItems: "center",
    gap: s(8),
  },
  stats: {
    // Fixed width keeps the slash-line right edge in the same x-position
    // on every row, so the column key above lines up cleanly. Categories
    // leagues need extra room for the 5-stat slash line.
    alignItems: "flex-end",
  },
  statsPoints: {
    // Sized for the longest realistic slash line — `40.5/12.4/10.5`
    // (14 chars) in mono ms(10) — across device scales. The slash
    // line is intentionally subordinate; FPTS is the headline.
    width: s(100),
  },
  statsCategories: {
    // 5-stat slash line — `35.5/12.4/10.5/2.1/1.8` (22 chars) in mono ms(10).
    width: s(150),
  },
  statLine: {
    fontSize: ms(10),
    textAlign: "right" as const,
  },
  fptsValue: {
    fontSize: ms(15),
    fontWeight: "700",
    marginTop: s(2),
  },
  catLine: {
    fontSize: ms(10),
    marginTop: 1,
  },
  addButton: {
    width: s(28),
    height: s(28),
    borderRadius: 14,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  claimButton: {
    width: s(28),
    height: s(28),
    borderRadius: 14,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  addButtonText: {
    fontSize: ms(14),
    fontWeight: "bold",
    lineHeight: ms(16),
  },
  addButtonDisabled: {
    opacity: 0.4,
  },
  skeletonBar: {
    height: s(12),
    borderRadius: 4,
  },

  // Status ribbon
  ribbonScroll: {
    marginTop: s(4),
    marginHorizontal: s(8),
  },
  ribbonContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: s(8),
    paddingVertical: s(4),
    paddingHorizontal: s(2),
  },
  ribbonPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: s(4),
    paddingHorizontal: s(10),
    paddingVertical: s(6),
    borderRadius: 16,
    borderWidth: 1,
  },
  claimsList: {
    marginHorizontal: s(8),
    marginTop: s(4),
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: s(12),
  },
  claimRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: s(8),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
