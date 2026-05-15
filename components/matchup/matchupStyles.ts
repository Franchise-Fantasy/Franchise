import { StyleSheet } from "react-native";

import { cardShadow, Fonts } from "@/constants/Colors";
import { ms, s } from "@/utils/scale";

export const styles = StyleSheet.create({
  container: { flex: 1 },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: s(24),
  },
  spinnerWrap: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: s(48),
  },
  body: { paddingBottom: s(56), flexGrow: 1 },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    alignItems: "center",
  },
  scheduleSheet: {
    width: "80%",
    maxHeight: "70%",
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  scheduleTitle: {
    fontSize: ms(16),
    padding: s(16),
    paddingBottom: s(12),
  },
  scheduleRow: {
    paddingHorizontal: s(16),
    paddingVertical: s(12),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  scheduleWeekLabel: { fontSize: ms(14), fontWeight: "600" },
  scheduleWeekRange: { fontSize: ms(12), marginTop: 2 },
});

export const colStyles = StyleSheet.create({
  // Brand card surface — wraps a section of slot rows with the same chrome
  // the roster page uses (rounded 12, hairline border, cardShadow).
  card: {
    borderRadius: 12,
    overflow: "hidden",
    borderWidth: 1,
    ...cardShadow,
  },

  // Section eyebrow padding (so eyebrows align with the slot card edges).
  // Matches the roster page's `section: { padding: s(16) }` so switching
  // between the two tabs feels visually continuous.
  sectionWrap: {
    marginHorizontal: s(16),
    marginTop: s(16),
  },

  // Center slot pill — narrower than the roster pill since the matchup
  // page splits horizontal space between two players. Same chrome family
  // (rounded, hairline border) so it still reads as the brand pill.
  slotPill: {
    width: s(30),
    paddingVertical: s(4),
    borderRadius: 6,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  slotPillText: {
    fontFamily: Fonts.varsityBold,
    fontSize: ms(10),
    letterSpacing: 0.8,
  },

  // Acquisition pill — leagueInfoPill chrome with eyebrow + value, used
  // at the bottom of the matchup card.
  acqRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: s(10),
    marginHorizontal: s(6),
    gap: s(8),
  },
  acqPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: s(5),
    paddingHorizontal: s(10),
    paddingVertical: s(5),
    borderRadius: 8,
    borderWidth: 1,
  },
  acqEyebrow: {
    fontSize: ms(9.5),
    letterSpacing: 1.0,
  },
  acqValue: {
    fontFamily: Fonts.mono,
    fontSize: ms(13),
    fontWeight: "700",
    letterSpacing: 0.4,
  },
});
