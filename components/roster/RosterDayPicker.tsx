import { Ionicons } from "@expo/vector-icons";
import { TouchableOpacity, View } from "react-native";

import { BottomSheet } from "@/components/ui/BottomSheet";
import { ThemedText } from "@/components/ui/ThemedText";
import { Brand } from "@/constants/Colors";
import { useColors } from "@/hooks/useColors";
import { addDays, parseLocalDate } from "@/utils/dates";
import { ms, s } from "@/utils/scale";

interface RosterDayPickerProps {
  visible: boolean;
  onClose: () => void;
  /** Inclusive bounds of the week being navigated (YYYY-MM-DD). */
  weekStart: string;
  weekEnd: string;
  weekNumber: number;
  isPlayoff: boolean;
  selectedDate: string;
  today: string;
  /** Earliest navigable day — days before this are disabled (the roster
   *  didn't exist yet). Null when there's no lower bound. */
  earliestDate: string | null;
  onSelectDate: (date: string) => void;
}

function buildWeekDays(start: string, end: string): string[] {
  const days: string[] = [];
  let cursor = start;
  // Guard against a malformed range producing an unbounded loop.
  for (let i = 0; i < 14 && cursor <= end; i += 1) {
    days.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return days;
}

/**
 * Day-granular "dropdown" for the roster hero's date. Lists every day in
 * the current matchup week so a manager can jump straight to a day's
 * lineup instead of stepping with the ‹ › arrows. Mirrors the Matchup
 * hero's schedule dropdown, but day-level since the roster page is
 * managed one day at a time.
 */
export function RosterDayPicker({
  visible,
  onClose,
  weekStart,
  weekEnd,
  weekNumber,
  isPlayoff,
  selectedDate,
  today,
  earliestDate,
  onSelectDate,
}: RosterDayPickerProps) {
  const c = useColors();
  const days = buildWeekDays(weekStart, weekEnd);

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Jump to Day"
      subtitle={`${isPlayoff ? "PLAYOFFS · " : ""}WEEK ${weekNumber}`}
    >
      <View>
        {days.map((day, i) => {
          const d = parseLocalDate(day);
          const weekday = d
            .toLocaleDateString("en-US", { weekday: "short" })
            .toUpperCase();
          const monthDay = d.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
          });
          const isSelected = day === selectedDate;
          const isToday = day === today;
          const disabled = !!earliestDate && day < earliestDate;

          return (
            <TouchableOpacity
              key={day}
              disabled={disabled || isSelected}
              onPress={() => {
                onSelectDate(day);
                onClose();
              }}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: s(12),
                paddingVertical: s(12),
                paddingHorizontal: s(12),
                borderRadius: 12,
                marginBottom: i === days.length - 1 ? 0 : s(4),
                opacity: disabled ? 0.4 : 1,
                backgroundColor: isSelected ? c.activeCard : "transparent",
                borderWidth: 1,
                borderColor: isSelected ? c.activeBorder : "transparent",
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected, disabled }}
              accessibilityLabel={`${weekday} ${monthDay}${
                isToday ? ", today" : ""
              }${isSelected ? ", selected" : ""}`}
            >
              <ThemedText
                type="varsity"
                style={{
                  width: s(44),
                  fontSize: ms(13),
                  color: isSelected ? c.activeText : c.secondaryText,
                }}
              >
                {weekday}
              </ThemedText>
              <ThemedText
                style={{
                  flex: 1,
                  fontSize: ms(16),
                  color: isSelected ? c.activeText : c.text,
                }}
              >
                {monthDay}
              </ThemedText>
              {isToday && (
                <View
                  style={{
                    paddingHorizontal: s(7),
                    paddingVertical: s(2),
                    borderRadius: 6,
                    borderWidth: 1,
                    borderColor: Brand.vintageGold,
                    backgroundColor: "rgba(181, 123, 48, 0.14)",
                  }}
                >
                  <ThemedText
                    type="varsitySmall"
                    style={{ fontSize: ms(9), color: Brand.vintageGold }}
                  >
                    TODAY
                  </ThemedText>
                </View>
              )}
              {isSelected && (
                <Ionicons
                  name="checkmark"
                  size={ms(18)}
                  color={c.activeText}
                />
              )}
            </TouchableOpacity>
          );
        })}
      </View>
    </BottomSheet>
  );
}
