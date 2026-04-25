import { FlatList, Modal, TouchableOpacity, View } from "react-native";

import { ThemedText } from "@/components/ui/ThemedText";
import { parseLocalDate } from "@/utils/dates";

import { styles } from "./matchupStyles";

export interface Week {
  id: string;
  week_number: number;
  start_date: string;
  end_date: string;
  is_playoff: boolean;
}

function formatWeekRange(start: string, end: string): string {
  const s = parseLocalDate(start);
  const e = parseLocalDate(end);
  const fmt = (d: Date) =>
    d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${fmt(s)} – ${fmt(e)}`;
}

interface WeekScheduleModalProps {
  visible: boolean;
  weeks: Week[];
  currentWeek: Week | null | undefined;
  today: string;
  colors: {
    background: string;
    border: string;
    card: string;
    accent: string;
    secondaryText: string;
  };
  onClose: () => void;
  onSelectDate: (date: string) => void;
}

export function WeekScheduleModal({
  visible,
  weeks,
  currentWeek,
  today,
  colors,
  onClose,
  onSelectDate,
}: WeekScheduleModalProps) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <TouchableOpacity
        style={styles.modalOverlay}
        activeOpacity={1}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Close schedule picker"
      >
        <View
          style={[
            styles.scheduleSheet,
            { backgroundColor: colors.background, borderColor: colors.border },
          ]}
        >
          <ThemedText
            type="defaultSemiBold"
            style={styles.scheduleTitle}
            accessibilityRole="header"
          >
            Schedule
          </ThemedText>
          <FlatList
            data={weeks}
            keyExtractor={(w) => w.id}
            renderItem={({ item: w, index }) => {
              const isActive = currentWeek?.id === w.id;
              return (
                <TouchableOpacity
                  style={[
                    styles.scheduleRow,
                    { borderBottomColor: colors.border },
                    isActive && { backgroundColor: colors.card },
                    index === weeks.length - 1 && { borderBottomWidth: 0 },
                  ]}
                  onPress={() => {
                    const jumpDate =
                      today >= w.start_date && today <= w.end_date
                        ? today
                        : w.start_date;
                    onSelectDate(jumpDate);
                    onClose();
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`${w.is_playoff ? "Playoffs, " : ""}Week ${w.week_number}, ${formatWeekRange(w.start_date, w.end_date)}`}
                  accessibilityState={{ selected: isActive }}
                >
                  <ThemedText
                    style={[
                      styles.scheduleWeekLabel,
                      isActive && { color: colors.accent },
                    ]}
                  >
                    {w.is_playoff ? "Playoffs · " : ""}Week {w.week_number}
                  </ThemedText>
                  <ThemedText
                    style={[
                      styles.scheduleWeekRange,
                      { color: colors.secondaryText },
                    ]}
                  >
                    {formatWeekRange(w.start_date, w.end_date)}
                  </ThemedText>
                </TouchableOpacity>
              );
            }}
          />
        </View>
      </TouchableOpacity>
    </Modal>
  );
}
