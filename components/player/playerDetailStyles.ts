import { StyleSheet } from "react-native";

import { ms, s } from "@/utils/scale";

export const playerDetailStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
  },
  sheet: {
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    minHeight: "90%",
    maxHeight: "92%",
    overflow: "hidden",
    paddingBottom: s(32),
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    padding: s(16),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerHeadshotWrap: {
    position: "relative" as const,
    marginRight: s(12),
  },
  headerHeadshotCircle: {
    width: s(74),
    height: s(74),
    borderRadius: 40,
    borderWidth: 1.5,
    overflow: "hidden" as const,
  },
  injuryChip: {
    position: "absolute" as const,
    top: s(-2),
    left: s(-4),
    paddingHorizontal: s(4),
    paddingVertical: 0,
    maxHeight: s(16),
    borderRadius: 3,
  },
  injuryChipText: {
    fontSize: ms(8),
    fontWeight: "800" as const,
    letterSpacing: 0.5,
    position: "relative" as const,
    top: -4,
  },
  headerHeadshotImg: {
    position: "absolute" as const,
    bottom: s(-2),
    left: 0,
    right: 0,
    height: s(66),
  },
  headerInfo: {
    flex: 1,
  },
  playerName: {
    fontSize: ms(22),
    flexShrink: 1,
  },
  subtitleRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: s(4),
    marginTop: s(2),
  },
  modalTeamLogo: {
    width: s(14),
    height: s(14),
    opacity: 0.6,
  },
  subtitle: {
    fontSize: ms(13),
  },
  outBadge: {
    fontWeight: "700",
  },
  closeButton: {
    padding: s(8),
    marginTop: s(-4),
    marginRight: s(-4),
  },
  closeText: {
    fontSize: ms(18),
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: s(8),
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: s(4),
  },
  headerBtn: {
    height: s(26),
    paddingHorizontal: s(10),
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  headerBtnAdd: {},
  headerBtnTaxi: {
    backgroundColor: "#8e44ad",
  },
  headerBtnText: {
    fontSize: ms(12),
    fontWeight: "600",
  },
  headerWarning: {
    fontSize: ms(10),
    marginTop: s(2),
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  scrollContent: {
    paddingTop: s(12),
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  gamesThisWeek: {
    fontSize: ms(12),
    fontWeight: "600",
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: "rgba(128,128,128,0.2)",
    marginHorizontal: s(16),
    marginVertical: s(8),
  },
  section: {
    paddingHorizontal: s(16),
    marginBottom: s(8),
  },
  sectionTitle: {
    marginBottom: s(8),
  },
  loading: {
    padding: s(20),
  },
  dropPickerList: {
    padding: s(8),
  },
  dropPickerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: s(14),
    paddingHorizontal: s(16),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  dropPickerInfo: {
    flex: 1,
  },
  dropPickerSub: {
    fontSize: ms(12),
    marginTop: s(2),
  },
  dropPickerFpts: {
    fontSize: ms(14),
    fontWeight: "600",
    marginLeft: s(12),
  },
  inlineToastWrap: {
    position: "absolute" as const,
    top: s(8),
    left: 0,
    right: 0,
    alignItems: "center" as const,
    zIndex: 200,
  },
  inlineToastPill: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    paddingHorizontal: s(12),
    paddingVertical: s(8),
    borderRadius: 999,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 6,
    maxWidth: "90%",
  },
  inlineToastText: {
    fontSize: ms(13),
    fontWeight: "600" as const,
  },
  tradeBlockPromptOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: s(24),
    zIndex: 100,
  },
  tradeBlockPromptCard: {
    borderRadius: 14,
    padding: s(20),
    width: "100%",
    maxWidth: s(340),
  },
  tradeBlockPromptTitle: {
    fontSize: ms(17),
    marginBottom: s(4),
  },
  tradeBlockPromptDesc: {
    fontSize: ms(13),
    marginBottom: s(12),
  },
  tradeBlockPromptInput: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: s(12),
    paddingVertical: s(10),
    fontSize: ms(14),
    marginBottom: s(16),
  },
  tradeBlockPromptButtons: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: s(8),
  },
  tradeBlockPromptBtn: {
    paddingHorizontal: s(16),
    paddingVertical: s(10),
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "transparent",
  },
});
