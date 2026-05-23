import { StyleSheet, type ViewStyle } from "react-native";

import { cardShadow, Fonts } from "@/constants/Colors";
import { ms, s } from "@/utils/scale";

export const rosterStyles = StyleSheet.create({
  container: { flex: 1 },
  // ── Section header action pills ────────────────────────────────────────
  // Match the home page leagueInfoPill chrome so every action chip on the
  // page reads as a pill, not a button-of-various-shapes.
  headerPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: s(5),
    paddingHorizontal: s(10),
    paddingVertical: s(5),
    borderRadius: 8,
    borderWidth: 1,
  },
  headerPillLabel: {
    fontSize: ms(9.5),
    letterSpacing: 1.0,
  },
  headerPillValue: {
    fontSize: ms(13),
    fontWeight: "700",
  },
  scrollContent: { paddingBottom: s(56) },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: s(20),
  },
  section: { padding: s(16), paddingBottom: 0 },
  emptyBench: { padding: s(16), alignItems: "center" },
  card: {
    borderRadius: 12,
    overflow: "hidden",
    borderWidth: 1,
    ...cardShadow,
  },
  slotRow: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: s(64),
    paddingHorizontal: s(10),
    paddingVertical: s(8),
    gap: s(10),
  },
  // Refined slot pill — replaces the column-stripe slotLabel. Same tap target
  // but reads as a chip, not a heavy left rail. Border + text colors are
  // applied inline based on filled / active / locked state.
  slotPill: {
    width: s(40),
    paddingVertical: s(6),
    borderRadius: 8,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  slotPillText: {
    fontSize: ms(10),
    letterSpacing: 1.0,
  },
  slotPlayer: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: s(10),
  },
  rosterPortraitWrap: {
    width: s(48),
    height: s(48),
    alignItems: "center",
  },
  // Empty slot's headshot stand-in — dashed hairline circle with a "+" icon
  // so empty rows keep the same horizontal rhythm as filled rows.
  emptyHeadshot: {
    width: s(48),
    height: s(48),
    borderRadius: s(24),
    borderWidth: 1,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
  },
  rosterHeadshotCircle: {
    width: s(48),
    height: s(48),
    borderRadius: s(24),
    borderWidth: 1.5,
    overflow: "hidden" as const,
  },
  rosterHeadshotImg: {
    position: "absolute" as const,
    bottom: -2,
    left: 0,
    right: 0,
    height: s(42),
  },
  rosterTeamPill: {
    position: "absolute",
    bottom: -1,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.75)",
    borderRadius: 8,
    paddingHorizontal: s(3),
    paddingVertical: 1,
    gap: 2,
  },
  rosterTeamPillLogo: {
    width: s(9),
    height: s(9),
  },
  rosterTeamPillText: {
    fontSize: ms(7),
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  slotPlayerInfo: { flex: 1 },
  slotLine1: {
    flexDirection: "row",
    alignItems: "center",
    gap: s(4),
  },
  slotPlayerName: { fontSize: ms(14), lineHeight: ms(18) },
  // Matchup row container — chip + optional live game-info text beside it.
  slotMatchupRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: s(6),
    marginTop: s(3),
  },
  // Live game info (quarter/clock/score) sits next to the matchup chip
  // when a game is in progress.
  matchupChipMeta: {
    fontSize: ms(9),
    letterSpacing: 1.0,
    flexShrink: 1,
  },
  // Pre-game / no-game context line: position · season fpts average · unit.
  // Baseline-aligned so the differently-sized pieces (position, dot, the larger
  // gold number, the small unit) all sit on one line instead of each floating
  // at its own vertical center.
  slotFptsRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: s(6),
    marginTop: s(3),
  },
  slotPosLabel: {
    fontSize: ms(9.5),
    letterSpacing: 1.0,
  },
  // Dim separator dot between the position and the average on the context line.
  slotPosDot: {
    fontSize: ms(11),
  },
  slotAvgFpts: {
    fontFamily: Fonts.mono,
    fontSize: ms(13),
    fontWeight: "700",
    letterSpacing: 0.4,
  },
  // Upcoming-game info on pre-game rows: opponent chip (pill) is the headline,
  // tipoff time a small subordinate caption beneath it. The time is inset by
  // the chip's horizontal padding (MatchupChip uses s(6)) so its right edge
  // lands under the opponent text rather than the pill's outer border.
  slotGameInfo: {
    alignItems: "flex-end",
    gap: s(1),
  },
  slotGameTime: {
    fontFamily: Fonts.mono,
    fontSize: ms(9),
    lineHeight: ms(11),
    letterSpacing: 0.5,
    marginRight: s(6),
  },
  // Mono stat line for past-day actuals — matches the Free Agents row pattern.
  slotStatLine: {
    fontFamily: Fonts.mono,
    fontSize: ms(10),
    lineHeight: ms(14),
    letterSpacing: 0.4,
    marginTop: s(2),
  },
  // Headline FPTS — same treatment as Free Agents headline FPTS (mono, gold,
  // larger). Color is applied inline by AnimatedFpts (active vs dim).
  slotFpts: {
    fontFamily: Fonts.mono,
    fontSize: ms(15),
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  // Empty-slot eyebrow + helper text. The headshot is replaced with the
  // dashed `emptyHeadshot` circle, and these two lines sit beside it.
  emptySlotEyebrow: {
    fontSize: ms(10),
    letterSpacing: 1.2,
  },
  emptySlotHint: {
    fontSize: ms(11),
    marginTop: s(2),
  },
  liveBadge: {
    paddingHorizontal: s(4),
    paddingVertical: 1,
    borderRadius: 3,
  },
  liveText: {
    fontSize: ms(8),
    fontWeight: "800",
    letterSpacing: 0.5,
  },
});

// Tokens the slot-pill variant reads — a structural subset of the theme so
// the helper stays decoupled from the full Colors union (and its sport-themed
// merges).
type SlotPillColors = {
  cardAlt: string;
  gold: string;
  heritageGold: string;
  border: string;
  text: string;
  secondaryText: string;
};

/**
 * Visual variant for a slot-position pill, keyed on whether the slot can be
 * edited from the current view. The chrome is otherwise identical; only the
 * border tells them apart — editable pills get a soft gold stroke so they read
 * as tappable, while read-only pills (a past day, a game already in progress,
 * or another team's roster) keep the neutral hairline border. The selected
 * pill steps up to a full-gold, thicker border.
 */
export function slotPillVariant(
  c: SlotPillColors,
  opts: { canEdit: boolean; isActive: boolean; hasPlayer: boolean },
): { container: ViewStyle; textColor: string } {
  return {
    container: {
      backgroundColor: opts.hasPlayer ? c.cardAlt : "transparent",
      borderColor: opts.isActive
        ? c.gold
        : opts.canEdit
          ? c.heritageGold
          : c.border,
      borderWidth: opts.isActive ? 1.5 : 1,
    },
    textColor: opts.isActive ? c.gold : opts.hasPlayer ? c.text : c.secondaryText,
  };
}
