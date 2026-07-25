import { StyleSheet, Text, View } from "react-native";

import { ThemedText } from "@/components/ui/ThemedText";
import { Brand, Fonts } from "@/constants/Colors";
import { formatIsoDate, formatShortDate } from "@/utils/dates";
import { ms, s } from "@/utils/scale";

export interface OffseasonMilestoneProps {
  phaseLabels: string[];
  phaseIndex: number;
  countdownDays: number | null;
  tipOffISO: string | null;
  /** What the season starts with — "TIP-OFF" (basketball) or "KICKOFF" (NFL). */
  openerWord: string;
  /** Condensed single-line + slim-dots rendering for hero cards that don't
   *  have the ~130pt of headroom the full countdown block needs (e.g. the
   *  Roster hero's lineup-bar slot). Full size otherwise. */
  compact?: boolean;
}

/**
 * Offseason milestone — the one number every manager checks in the gap
 * between seasons (days until next season's opener), plus a phase ribbon
 * showing where the league sits on the road there. Shared between the
 * Matchup hero (replaces the dead "no matchup" body) and the Roster hero
 * (fills the space the lineup bar leaves empty once games stop).
 */
export function OffseasonMilestone({
  phaseLabels,
  phaseIndex,
  countdownDays,
  tipOffISO,
  openerWord,
  compact = false,
}: OffseasonMilestoneProps) {
  const countdownLabel = `${countdownDays} ${countdownDays === 1 ? "DAY" : "DAYS"}${
    tipOffISO ? ` · ${formatShortDate(tipOffISO).toUpperCase()}` : ""
  }`;
  const accessibilityLabel =
    countdownDays != null
      ? `Next season ${openerWord.toLowerCase()} in ${countdownDays} ${
          countdownDays === 1 ? "day" : "days"
        }${tipOffISO ? `, ${formatIsoDate(tipOffISO)}` : ""}`
      : `Offseason: ${phaseLabels[phaseIndex] ?? "unknown phase"}`;

  if (compact) {
    return (
      <View style={styles.compactWrap} accessibilityLabel={accessibilityLabel}>
        <View style={styles.compactRow}>
          <ThemedText type="varsitySmall" style={styles.compactLabel}>
            {countdownDays != null ? `${openerWord} IN` : "OFFSEASON"}
          </ThemedText>
          <ThemedText type="mono" style={styles.compactValue} numberOfLines={1}>
            {countdownDays != null
              ? countdownLabel
              : (phaseLabels[phaseIndex] ?? "")}
          </ThemedText>
        </View>
        <PhaseRibbon labels={phaseLabels} activeIndex={phaseIndex} compact />
      </View>
    );
  }

  return (
    <View style={styles.offBody}>
      {countdownDays != null ? (
        <View style={styles.countBlock} accessibilityLabel={accessibilityLabel}>
          <ThemedText type="varsity" style={styles.countLabel}>
            {openerWord} IN
          </ThemedText>
          <Text style={styles.countNum}>{countdownDays}</Text>
          <ThemedText type="mono" style={styles.countSub}>
            {countdownDays === 1 ? "DAY" : "DAYS"}
            {tipOffISO ? ` · ${formatShortDate(tipOffISO).toUpperCase()}` : ""}
          </ThemedText>
        </View>
      ) : (
        <ThemedText type="varsity" style={styles.countLabelOnly}>
          {phaseLabels[phaseIndex] ?? "OFFSEASON"}
        </ThemedText>
      )}
      <PhaseRibbon labels={phaseLabels} activeIndex={phaseIndex} />
    </View>
  );
}

/**
 * The offseason phase ribbon — an engraved timeline of the league's steps
 * (per league type: Season Over → Draft Lottery → Rookie Draft → New Season,
 * etc.) with completed steps and the active step lit in gold. A continuous
 * base rail sits behind opaque nodes so it reads on any sport-tinted surface.
 * `compact` drops the per-step text labels and shrinks the nodes/spacing to
 * a slim dot-track — same idea, ~35pt shorter.
 */
function PhaseRibbon({
  labels,
  activeIndex,
  compact = false,
}: {
  labels: string[];
  activeIndex: number;
  compact?: boolean;
}) {
  const n = labels.length;
  if (n === 0) return null;
  const halfPct = (0.5 / n) * 100;
  const donePct = (Math.min(activeIndex, n - 1) / n) * 100;
  return (
    <View
      style={compact ? styles.ribbonCompact : styles.ribbon}
      accessibilityLabel={`Offseason progress: ${
        labels[activeIndex] ?? labels[0]
      }, step ${Math.min(activeIndex + 1, n)} of ${n}`}
    >
      <View style={compact ? styles.ribbonNodesRowCompact : styles.ribbonNodesRow}>
        <View
          style={[styles.ribbonBaseLine, { left: `${halfPct}%`, right: `${halfPct}%` }]}
        />
        {activeIndex > 0 && (
          <View
            style={[styles.ribbonDoneLine, { left: `${halfPct}%`, width: `${donePct}%` }]}
          />
        )}
        {labels.map((label, i) => (
          <View key={label} style={styles.ribbonCol}>
            <View
              style={[
                compact ? styles.nodeCompact : styles.node,
                i < activeIndex && styles.nodeDone,
                i === activeIndex &&
                  (compact ? styles.nodeActiveCompact : styles.nodeActive),
              ]}
            />
          </View>
        ))}
      </View>
      {!compact && (
        <View style={styles.ribbonLabelsRow}>
          {labels.map((label, i) => (
            <Text
              key={label}
              numberOfLines={1}
              style={[
                styles.ribbonLabel,
                i < activeIndex && styles.ribbonLabelDone,
                i === activeIndex && styles.ribbonLabelActive,
              ]}
            >
              {label}
            </Text>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  offBody: {
    minHeight: ms(86),
    justifyContent: "center",
    paddingVertical: s(4),
  },
  countBlock: {
    alignItems: "center",
  },
  countLabel: {
    color: Brand.vintageGold,
    fontSize: ms(10.5),
    letterSpacing: 2,
  },
  countLabelOnly: {
    color: Brand.ecru,
    fontSize: ms(14),
    letterSpacing: 1.4,
    textAlign: "center",
  },
  countNum: {
    // The numerals face, not the display face: this is a countdown, so the
    // digits change every tick and need uniform widths to hold still. Not
    // Fonts.score either — the dot-matrix face is reserved for the actual score.
    fontFamily: Fonts.mono,
    color: Brand.ecru,
    fontSize: ms(52),
    // Generous line height so the numerals don't clip at the top; the empty
    // descent slack that leaves below the number is reclaimed by the sub-line's
    // negative margin rather than by squeezing this box.
    lineHeight: ms(58),
    letterSpacing: -0.5,
    marginTop: s(1),
    fontVariant: ["tabular-nums"],
  },
  countSub: {
    color: Brand.ecruMuted,
    fontSize: ms(11),
    letterSpacing: 0.6,
    marginTop: s(-12),
  },
  ribbon: {
    marginTop: s(14),
    paddingHorizontal: s(4),
  },
  ribbonNodesRow: {
    position: "relative",
    flexDirection: "row",
    alignItems: "center",
    height: ms(14),
  },
  ribbonBaseLine: {
    position: "absolute",
    top: "50%",
    marginTop: -1,
    height: 2,
    borderRadius: 1,
    backgroundColor: "rgba(233, 226, 203, 0.20)",
  },
  ribbonDoneLine: {
    position: "absolute",
    top: "50%",
    marginTop: -1,
    height: 2,
    borderRadius: 1,
    backgroundColor: Brand.vintageGold,
  },
  ribbonCol: {
    flex: 1,
    alignItems: "center",
  },
  node: {
    width: 11,
    height: 11,
    borderRadius: 6,
    backgroundColor: "rgba(233, 226, 203, 0.30)",
  },
  nodeDone: {
    backgroundColor: Brand.vintageGold,
  },
  nodeActive: {
    width: 13,
    height: 13,
    borderRadius: 7,
    backgroundColor: Brand.vintageGold,
    shadowColor: Brand.vintageGold,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.7,
    shadowRadius: 5,
    elevation: 4,
  },
  ribbonLabelsRow: {
    flexDirection: "row",
    marginTop: s(7),
  },
  ribbonLabel: {
    flex: 1,
    textAlign: "center",
    fontFamily: Fonts.varsityBold,
    fontSize: ms(8.5),
    letterSpacing: 0.6,
    textTransform: "uppercase",
    color: "rgba(233, 226, 203, 0.40)",
  },
  ribbonLabelDone: {
    color: Brand.ecruMuted,
  },
  ribbonLabelActive: {
    color: Brand.vintageGold,
  },

  // ── Compact variant — single label/value row + slim dot track ────────
  compactWrap: {
    marginBottom: s(10),
    gap: s(6),
  },
  compactRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  compactLabel: {
    color: Brand.vintageGold,
    fontSize: ms(10),
    letterSpacing: 1.2,
  },
  compactValue: {
    color: Brand.ecru,
    fontSize: ms(12),
    letterSpacing: 0.2,
    fontVariant: ["tabular-nums"],
  },
  ribbonCompact: {
    paddingHorizontal: s(2),
  },
  ribbonNodesRowCompact: {
    position: "relative",
    flexDirection: "row",
    alignItems: "center",
    height: ms(8),
  },
  nodeCompact: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "rgba(233, 226, 203, 0.30)",
  },
  nodeActiveCompact: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Brand.vintageGold,
    shadowColor: Brand.vintageGold,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 3,
    elevation: 2,
  },
});
