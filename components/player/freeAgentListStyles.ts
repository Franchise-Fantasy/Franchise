import { StyleSheet } from "react-native";

import { ms, s } from "@/utils/scale";

export const freeAgentListStyles = StyleSheet.create({
  container: {
    flex: 1,
  },
  offseasonBanner: {
    flexDirection: "row",
    alignItems: "center",
    padding: s(10),
    marginHorizontal: s(8),
    marginTop: s(4),
    borderRadius: 8,
    borderWidth: 1,
  },
  listContent: {
    paddingHorizontal: s(8),
    paddingBottom: s(100),
  },
  ribbonRow: {
    flexDirection: "row",
    alignItems: "center",
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
  rowAlt: {
    backgroundColor: "rgba(128, 128, 128, 0.09)",
  },
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
    alignItems: "flex-end",
  },
  statLine: {
    fontSize: ms(12),
  },
  fpts: {
    fontSize: ms(11),
    fontWeight: "600",
    marginTop: 1,
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

  // FAAB bid modal
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  faabModal: {
    width: "80%",
    borderRadius: 12,
    padding: s(20),
  },
  bidRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: s(4),
  },
  bidInput: {
    width: s(80),
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: s(12),
    paddingVertical: s(8),
    fontSize: ms(16),
    fontWeight: "700",
    textAlign: "center",
  },
  modalButtons: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: s(10),
  },
  modalBtn: {
    paddingHorizontal: s(20),
    paddingVertical: s(10),
    borderRadius: 8,
    alignItems: "center",
    minWidth: s(80),
  },
});
