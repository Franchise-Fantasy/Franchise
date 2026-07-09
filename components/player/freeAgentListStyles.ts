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
    // No horizontal padding here — the row's own paddingHorizontal carries the
    // content inset so the zebra-stripe background bleeds to both screen edges
    // (and aligns with the full-bleed colKey header above the list).
    paddingBottom: s(100),
  },
  // Extra bottom clearance so the floating compare bar (which sits above the
  // tab bar) doesn't cover the last rows.
  listContentCompare: {
    paddingBottom: s(170),
  },
  colKey: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    // Match the row's horizontal padding so the stat-key legend lines up with
    // the row content below it.
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
    // The stat-key legend now lives on its own colKey row below, so the
    // ribbon is just the scrollable pills with symmetric edge padding.
    paddingHorizontal: s(8),
    paddingVertical: s(4),
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
    // s(20) = the old listContent s(8) + row s(12), so content stays put while
    // the full-width row background provides edge-to-edge zebra striping.
    paddingHorizontal: s(20),
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
  // Wraps the portrait so the compare-selected gold check badge can overlay its
  // top-right corner (same treatment as the roster/matchup rows). The portrait's
  // own marginRight moves onto this wrapper (set inline) so the badge anchors to
  // the portrait box rather than the trailing gap.
  compareBadgeWrap: {
    marginRight: s(10),
  },
  // Skeleton placeholder reuses this circle; the real row's portrait chrome
  // now lives in the shared PlayerPortrait component.
  headshotCircle: {
    width: s(54),
    height: s(54),
    borderRadius: 29,
    borderWidth: 1.5,
    overflow: "hidden" as const,
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
  // Next-game projection shown inline beside the matchup chip in the pos row.
  projInline: {
    fontSize: ms(9.5),
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
  tradeButton: {
    width: s(28),
    height: s(28),
    borderRadius: 14,
    borderWidth: 1.5,
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
