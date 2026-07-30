import type { ReactNode } from "react";
import { View } from "react-native";

import { rosterStyles as styles } from "@/components/roster/rosterStyles";
import { SectionEyebrow } from "@/components/roster/SectionEyebrow";
import type { SlotEntry } from "@/components/roster/SlotPickerModal";
import { useColors } from "@/hooks/useColors";

interface ParkedSlotSectionProps {
  /** Section eyebrow, e.g. "INJURED RESERVE" or "TAXI SQUAD". */
  label: string;
  slots: SlotEntry[];
  renderSlotRow: (slot: SlotEntry, idx: number, list: SlotEntry[]) => ReactNode;
}

/**
 * A non-scoring holding section (IR, taxi squad) on the roster page.
 *
 * Both render the identical eyebrow + card + rows shape and differ only by label
 * and slot list, so they share this. Renders nothing when the league hasn't
 * opted into the slot type — callers don't need their own length guard.
 */
export function ParkedSlotSection({
  label,
  slots,
  renderSlotRow,
}: ParkedSlotSectionProps) {
  const c = useColors();
  if (slots.length === 0) return null;

  return (
    <View style={styles.section}>
      <SectionEyebrow label={label} />
      <View
        style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}
      >
        {slots.map((slot, idx) => renderSlotRow(slot, idx, slots))}
      </View>
    </View>
  );
}
