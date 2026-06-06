import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { StyleSheet, TouchableOpacity, View } from "react-native";

import { ThemedText } from "@/components/ui/ThemedText";
import { useColors } from "@/hooks/useColors";
import { ms, s } from "@/utils/scale";
import { GameWindow } from "@/utils/scoring/fantasyPoints";

/** The roster pages layer two non-window choices on top of the historical stat
 *  windows: "Proj" (next-game projection) and "Prev" (last season's averages).
 *  Neither is a `GameWindow` (they slice nothing from the current game log), so
 *  they live only here where the picker and roster rows consume them — analytics
 *  keeps the plain `GameWindow`. */
export type RosterStatMode = GameWindow | "proj" | "prev";

const WINDOW_LABELS: Record<RosterStatMode, string> = {
  L5: "L5",
  L10: "L10",
  L15: "L15",
  season: "Season",
  proj: "Proj",
  prev: "Prev",
};

interface Props {
  windowSel: RosterStatMode;
  onWindowChange: (w: RosterStatMode) => void;
  /** Sorted list of windows worth offering — drives the dropdown options.
   *  Hide the whole picker (renders nothing) when only "Season" is here. */
  availableWindows: readonly RosterStatMode[];
  /** Label for the "Prev" option — the compact previous-season string (e.g.
   *  "'25" / "'24-'25"). Falls back to "Prev" when omitted. */
  prevLabel?: string;
}

/**
 * Discreet header-right pill for swapping a roster page's stat window between
 * Last 5 / Last 10 / Last 15 / Season / Proj / previous season. Mirrors the
 * inline window picker on the player-detail Insights card so the gesture and
 * chrome read the same. Renders nothing when there's effectively one option.
 */
export function RosterWindowPicker({
  windowSel,
  onWindowChange,
  availableWindows,
  prevLabel,
}: Props) {
  const c = useColors();
  const [open, setOpen] = useState(false);

  if (availableWindows.length <= 1) return null;

  const labelFor = (w: RosterStatMode) =>
    w === "prev" && prevLabel ? prevLabel : WINDOW_LABELS[w];
  const label = labelFor(windowSel);

  return (
    <View>
      <TouchableOpacity
        onPress={() => setOpen((v) => !v)}
        style={[styles.btn, { backgroundColor: c.cardAlt, borderColor: c.border }]}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        accessibilityRole="button"
        accessibilityLabel={`Stat window: ${label}. Tap to change.`}
        accessibilityState={{ expanded: open }}
      >
        <Ionicons name="filter-outline" size={12} color={c.gold} />
        <ThemedText type="varsitySmall" style={[styles.btnLabel, { color: c.gold }]}>
          {label.toUpperCase()}
        </ThemedText>
      </TouchableOpacity>
      {open && (
        <>
          {/* Tap-out backdrop so the dropdown closes on outside tap without
              a full Modal — Modal stacking is fragile on iOS (CLAUDE.md). */}
          <TouchableOpacity
            style={styles.backdrop}
            activeOpacity={1}
            onPress={() => setOpen(false)}
            accessibilityLabel="Close stat window picker"
          />
          <View style={[styles.dropdown, { backgroundColor: c.card, borderColor: c.border }]}>
            {availableWindows.map((w) => {
              const isSelected = w === windowSel;
              return (
                <TouchableOpacity
                  key={w}
                  onPress={() => {
                    onWindowChange(w);
                    setOpen(false);
                  }}
                  style={[
                    styles.item,
                    isSelected && { backgroundColor: c.gold },
                  ]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSelected }}
                  accessibilityLabel={labelFor(w)}
                >
                  <ThemedText
                    style={[
                      styles.itemText,
                      { color: isSelected ? c.statusText : c.text },
                    ]}
                  >
                    {labelFor(w)}
                  </ThemedText>
                </TouchableOpacity>
              );
            })}
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  btn: {
    flexDirection: "row",
    alignItems: "center",
    gap: s(4),
    paddingHorizontal: s(8),
    paddingVertical: s(4),
    borderRadius: 6,
    borderWidth: 1,
  },
  btnLabel: {
    fontSize: ms(10),
    letterSpacing: 0.6,
  },
  backdrop: {
    position: "absolute",
    top: s(-1000),
    left: s(-1000),
    right: s(-1000),
    bottom: s(-1000),
    zIndex: 9,
  },
  dropdown: {
    position: "absolute",
    top: "100%",
    right: 0,
    marginTop: s(4),
    borderRadius: 8,
    borderWidth: 1,
    paddingVertical: s(4),
    zIndex: 10,
    elevation: 5,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 6,
    minWidth: s(80),
  },
  item: {
    paddingHorizontal: s(12),
    paddingVertical: s(7),
  },
  itemText: {
    fontSize: ms(12),
    fontWeight: "500",
  },
});