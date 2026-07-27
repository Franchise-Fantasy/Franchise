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
  /** `full` — centered countdown + labelled phase ribbon, for a hero body that
   *  owns the whole card width (Matchup).
   *  `rail` — right-aligned countdown stat with no ribbon, sized to sit beside
   *  a team identity block in a hero's main row (Roster). */
  variant?: "full" | "rail";
}

/**
 * Offseason milestone — the one number every manager checks in the gap
 * between seasons (days until next season's opener). The `full` variant adds
 * a phase ribbon showing where the league sits on the road there; the `rail`
 * variant is countdown-only, for the Roster hero's identity row (its phase is
 * named in words in that hero's context strip instead).
 */
export function OffseasonMilestone({
  phaseLabels,
  phaseIndex,
  countdownDays,
  tipOffISO,
  openerWord,
  variant = "full",
}: OffseasonMilestoneProps) {
  const accessibilityLabel =
    countdownDays != null
      ? `Next season ${openerWord.toLowerCase()} in ${countdownDays} ${
          countdownDays === 1 ? "day" : "days"
        }${tipOffISO ? `, ${formatIsoDate(tipOffISO)}` : ""}`
      : `Offseason: ${phaseLabels[phaseIndex] ?? "unknown phase"}`;

  if (variant === "rail") {
    return (
      <View style={styles.rail} accessible accessibilityLabel={accessibilityLabel}>
        <ThemedText type="varsitySmall" style={styles.railCap} numberOfLines={1}>
          {countdownDays != null ? `${openerWord} IN` : "OFFSEASON"}
        </ThemedText>
        {countdownDays != null ? (
          <>
            <Text style={styles.railNum}>{countdownDays}</Text>
            <ThemedText type="mono" style={styles.railSub} numberOfLines={1}>
              {countdownDays === 1 ? "DAY" : "DAYS"}
              {tipOffISO ? ` · ${formatShortDate(tipOffISO).toUpperCase()}` : ""}
            </ThemedText>
          </>
        ) : (
          <ThemedText type="mono" style={styles.railPhase} numberOfLines={2}>
            {phaseLabels[phaseIndex] ?? ""}
          </ThemedText>
        )}
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
 */
function PhaseRibbon({
  labels,
  activeIndex,
}: {
  labels: string[];
  activeIndex: number;
}) {
  const n = labels.length;
  if (n === 0) return null;
  const halfPct = (0.5 / n) * 100;
  const donePct = (Math.min(activeIndex, n - 1) / n) * 100;
  return (
    <View
      style={styles.ribbon}
      accessibilityLabel={`Offseason progress: ${
        labels[activeIndex] ?? labels[0]
      }, step ${Math.min(activeIndex + 1, n)} of ${n}`}
    >
      <View style={styles.ribbonNodesRow}>
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
                styles.node,
                i < activeIndex && styles.nodeDone,
                i === activeIndex && styles.nodeActive,
              ]}
            />
          </View>
        ))}
      </View>
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

  // ── Rail variant — right-aligned countdown stat, no ribbon ──────────
  rail: {
    alignItems: "flex-end",
    flexShrink: 0,
    // Top-aligned so the cap line sits with the neighbouring tricode's cap
    // height rather than floating in the middle of the identity block.
    alignSelf: "flex-start",
    marginTop: s(3),
  },
  railCap: {
    color: Brand.vintageGold,
    fontSize: ms(8.5),
    letterSpacing: 1.2,
  },
  railNum: {
    fontFamily: Fonts.mono,
    color: Brand.ecru,
    fontSize: ms(30),
    lineHeight: ms(34),
    letterSpacing: -0.5,
    fontVariant: ["tabular-nums"],
  },
  railSub: {
    color: Brand.ecruMuted,
    fontSize: ms(10),
    letterSpacing: 0.4,
  },
  railPhase: {
    color: Brand.ecru,
    fontSize: ms(13),
    letterSpacing: 0.2,
    textAlign: "right",
    marginTop: s(2),
  },
});
