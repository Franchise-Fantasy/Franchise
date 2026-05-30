import { StyleSheet } from "react-native";

import { ms, s } from "@/utils/scale";

export const playerDetailStyles = StyleSheet.create({
  // Slide-up sheet chrome — still consumed by DropPickerModal, which keeps its
  // own Modal + drag-to-dismiss path (the main sheet now uses BottomSheet).
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
  loading: {
    padding: s(20),
  },

  // BottomSheet body overrides — sections manage their own horizontal padding,
  // and the game log runs edge-to-edge, so the sheet's default body padding is
  // zeroed out here.
  body: {
    paddingHorizontal: 0,
    paddingBottom: 0,
  },
  bodyInner: {
    flex: 1,
  },
  scrollContent: {
    paddingTop: s(14),
    paddingBottom: s(8),
  },
  sectionPad: {
    paddingHorizontal: s(16),
    marginBottom: s(10),
  },
  eyebrowRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: s(8),
  },
  eyebrowLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: s(10),
    flexShrink: 1,
  },
  rankBadges: {
    flexDirection: "row",
    alignItems: "center",
    gap: s(6),
    flexShrink: 0,
  },
  goldRule: {
    height: 2,
    width: s(18),
  },
  txnWrap: {
    marginTop: s(14),
  },

  // Inline toast — rendered inside the sheet so it isn't hidden by the Modal
  // on native (the global ToastProvider renders beneath it).
  inlineToastWrap: {
    position: "absolute",
    top: s(8),
    left: 0,
    right: 0,
    alignItems: "center",
    zIndex: 200,
  },
  inlineToastPill: {
    flexDirection: "row",
    alignItems: "center",
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
    fontWeight: "600",
  },
});
