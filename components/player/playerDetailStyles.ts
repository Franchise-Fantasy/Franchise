import { StyleSheet } from "react-native";

import { s } from "@/utils/scale";

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
  // Sections whose only content is a SectionEyebrow — that component brings its
  // own bottom margin, so this contributes horizontal padding alone.
  eyebrowPad: {
    paddingHorizontal: s(16),
  },
  txnWrap: {
    marginTop: s(14),
  },
});
