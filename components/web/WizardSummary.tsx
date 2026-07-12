import React from "react";
import { StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/ui/ThemedText";
import { Fonts } from "@/constants/Colors";
import type { LeagueWizardState } from "@/constants/LeagueDefaults";
import { useColors } from "@/hooks/useColors";
import { ROSTER_SLOT } from "@/utils/roster/rosterSlotsShared";

/** Roster spots that count toward the cap — IR and taxi are stashes, not starters. */
function activeRosterSize(slots: LeagueWizardState["rosterSlots"]): number {
  return slots.reduce(
    (sum, slot) =>
      slot.position === "IR" || slot.position === ROSTER_SLOT.TAXI ? sum : sum + slot.count,
    0,
  );
}

function formatClock(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86400)}d`;
}

function formatWaivers(state: LeagueWizardState): string {
  if (state.waiverType === "None") return "None";
  if (state.waiverType === "FAAB") return `FAAB · $${state.faabBudget}`;
  return `Standard · ${state.waiverPeriodDays}d`;
}

function formatFormat(state: LeagueWizardState): string {
  if (state.leagueType === "Keeper") return `Keeper · ${state.keeperCount ?? 5}`;
  return state.leagueType ?? "Dynasty";
}

/**
 * Live league summary for the desktop wizard's right rail. Reflects the wizard
 * state as the user configures it, so the settings they've already chosen stay
 * on screen instead of scrolling away step-by-step — the persistent context a
 * desktop viewport has room for and a phone doesn't. Read-only; the Review step
 * remains the place to edit.
 */
export function WizardSummary({ state }: { state: LeagueWizardState }) {
  const c = useColors();

  const rows: { label: string; value: string }[] = [
    { label: "Sport", value: `${state.sport.toUpperCase()} · ${state.season}` },
    { label: "Format", value: formatFormat(state) },
    { label: "Teams", value: String(state.teams) },
    { label: "Roster", value: `${activeRosterSize(state.rosterSlots)} spots` },
    { label: "Scoring", value: state.scoringType },
    { label: "Waivers", value: formatWaivers(state) },
    {
      label: "Season",
      value: `${state.regularSeasonWeeks} wk + ${state.playoffWeeks} playoff`,
    },
    { label: "Playoffs", value: `${state.playoffTeams} teams` },
    { label: "Draft", value: `${state.draftType} · ${formatClock(state.timePerPick)}` },
    { label: "Visibility", value: state.isPrivate ? "Private" : "Public" },
  ];

  if (state.buyIn > 0) rows.push({ label: "Buy-In", value: `$${state.buyIn}` });

  const name = state.name.trim();

  return (
    <View style={styles.root} accessibilityLabel="League summary">
      <View style={styles.headingRow}>
        <View style={[styles.rule, { backgroundColor: c.gold }]} />
        <ThemedText type="varsitySmall" style={[styles.heading, { color: c.secondaryText }]}>
          SUMMARY
        </ThemedText>
      </View>

      <ThemedText
        type="sectionLabel"
        style={[styles.name, { color: name ? c.text : c.secondaryText }]}
        numberOfLines={2}
      >
        {name || "Untitled League"}
      </ThemedText>

      <View style={[styles.divider, { backgroundColor: c.border }]} />

      {rows.map((row) => (
        <View key={row.label} style={styles.row}>
          <ThemedText style={[styles.rowLabel, { color: c.secondaryText }]}>{row.label}</ThemedText>
          <ThemedText style={[styles.rowValue, { color: c.text }]} numberOfLines={1}>
            {row.value}
          </ThemedText>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 2 },
  headingRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 },
  rule: { height: 2, width: 16 },
  heading: { fontSize: 10, letterSpacing: 1.4 },
  name: { fontSize: 16, lineHeight: 21 },
  divider: { height: StyleSheet.hairlineWidth, marginTop: 12, marginBottom: 6 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    paddingVertical: 7,
  },
  rowLabel: { fontSize: 12 },
  rowValue: {
    fontFamily: Fonts.mono,
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0.3,
    flexShrink: 1,
    textAlign: "right",
  },
});
