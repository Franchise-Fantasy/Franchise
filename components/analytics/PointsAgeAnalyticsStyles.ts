import { StyleSheet } from "react-native";

import { Fonts } from "@/constants/Colors";
import { ms, s } from "@/utils/scale";

/** Plot height. Lives here rather than in the component because the chart's
 *  container style needs it too, and the component derives its plot area from
 *  the same number. */
export const CHART_HEIGHT = s(400);

export const styles = StyleSheet.create({
  // Fills the analytics body so the floating detail card can pin to its bottom.
  root: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: s(32),
  },
  // Extra bottom room while the floating detail tray occupies the lower band.
  scrollContentWithDetail: {
    paddingBottom: s(150),
  },

  // Narrative Card — mirrors AnalyticsPreviewCard chrome
  narrativeCard: {
    position: "relative",
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: s(16),
    paddingTop: s(18),
    paddingBottom: s(14),
    marginBottom: s(14),
    overflow: "hidden",
  },
  topNotch: {
    position: "absolute",
    top: 0,
    left: s(16),
    height: 3,
    width: s(44),
  },
  eyebrow: {
    fontSize: ms(10),
    letterSpacing: 1.3,
    marginBottom: s(12),
  },
  columnsRow: {
    flexDirection: "row",
    alignItems: "stretch",
  },
  column: {
    flex: 1,
    alignItems: "flex-start",
    justifyContent: "center",
    paddingHorizontal: s(2),
  },
  columnLabel: {
    fontSize: ms(9.5),
    letterSpacing: 1.2,
    marginBottom: s(4),
  },
  columnBig: {
    fontFamily: Fonts.display,
    fontSize: ms(22),
    lineHeight: ms(26),
    letterSpacing: -0.3,
    marginBottom: s(2),
  },
  columnSub: {
    fontSize: ms(9.5),
    letterSpacing: 1.0,
  },
  columnDivider: {
    width: 1,
    marginHorizontal: s(8),
  },
  spectrumWrap: {
    marginTop: s(16),
    paddingHorizontal: s(2),
  },
  curveToggleRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: s(12),
    paddingHorizontal: 2,
    gap: s(8),
  },
  curveToggleChips: {
    flex: 1,
    flexDirection: "row",
    gap: s(6),
  },
  curveToggleInfo: {
    padding: s(2),
  },
  curveTogglePill: {
    minWidth: s(40),
    paddingHorizontal: s(10),
    paddingVertical: s(6),
    borderRadius: 6,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  curveToggleText: {
    fontSize: ms(11),
    letterSpacing: 1.0,
  },

  // Anchors the FIT pill over the chart. The pill is a sibling of the
  // GestureDetector rather than a child, so its press doesn't also land as a
  // chart tap.
  chartWrap: {
    position: "relative",
  },
  // Chart — positioned relative so text overlays work; overflow hidden keeps a
  // half-clipped edge dot from spilling into the axis gutters.
  chartArea: {
    marginBottom: 0,
    position: "relative",
    height: CHART_HEIGHT,
    overflow: "hidden",
  },
  fitPill: {
    position: "absolute",
    top: s(4),
    right: s(4),
    minWidth: s(44),
    paddingHorizontal: s(10),
    paddingVertical: s(6),
    borderRadius: 6,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  fitPillText: {
    fontSize: ms(11),
    letterSpacing: 1.0,
  },

  // Absolutely positioned text labels over the Canvas
  axisLabel: {
    position: "absolute",
    fontSize: ms(11),
    fontWeight: "500",
  },
  axisTitleLabel: {
    position: "absolute",
    fontSize: ms(11),
    fontWeight: "700",
  },
  indicatorLabel: {
    position: "absolute",
    fontSize: ms(8),
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  playerNameLabel: {
    position: "absolute",
    fontSize: ms(9),
  },

  // Floating Detail Card — pinned to the bottom of the viewport, over the
  // chart, so a tapped dot pops into view regardless of scroll position. The
  // wrapper is an opaque, page-colored tray filling the lower band: it occludes
  // whatever content (footnote / dependency-risk) scrolls behind the card, so
  // the card never visually collides with it. bg is set inline (theme-aware).
  floatingDetail: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: s(14),
    paddingBottom: s(10),
    paddingHorizontal: s(2),
  },
  floatingDetailInner: {
    borderWidth: 1,
    borderRadius: 12,
    padding: s(14),
  },
  // Detail Card interior — gold-rule eyebrow + Alfa Slab name + Badge.
  detailEyebrowRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: s(8),
  },
  detailEyebrowLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: s(8),
  },
  detailRule: {
    height: 2,
    width: s(18),
  },
  detailEyebrow: {
    fontSize: ms(9.5),
    letterSpacing: 1.3,
  },
  detailHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: s(10),
  },
  detailHeaderLeft: {
    flex: 1,
    minWidth: 0,
  },
  detailName: {
    fontFamily: Fonts.display,
    fontSize: ms(18),
    lineHeight: ms(22),
    letterSpacing: -0.2,
  },
  detailMeta: {
    fontSize: ms(10),
    letterSpacing: 1.2,
    marginTop: s(2),
  },
  detailFpts: {
    alignItems: "flex-end",
  },
  detailFptsValue: {
    fontFamily: Fonts.display,
    fontSize: ms(22),
    lineHeight: ms(26),
    letterSpacing: -0.3,
  },
  detailFptsLabel: {
    fontSize: ms(9),
    letterSpacing: 1.0,
    marginTop: s(1),
  },
  detailBadges: {
    flexDirection: "row",
    gap: s(8),
    marginTop: s(8),
  },

  // Info modal content (rendered inside shared InfoModal)
  modalText: {
    fontSize: ms(13),
    lineHeight: ms(19),
    marginBottom: s(12),
  },
  modalSwatchRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: s(5),
    marginBottom: s(12),
  },
  modalSwatch: {
    width: s(10),
    height: s(10),
    borderRadius: 5,
  },
  modalSwatchLabel: {
    fontSize: ms(12),
    fontWeight: "500",
  },

  footnote: { fontSize: ms(10), fontStyle: "italic", textAlign: "center" },
});
