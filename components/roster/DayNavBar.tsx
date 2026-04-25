import { Text, TouchableOpacity, View } from "react-native";

import { ThemedText } from "@/components/ui/ThemedText";

import { rosterStyles as styles } from "./rosterStyles";

interface DayNavBarProps {
  selectedDate: string;
  today: string;
  canGoBack: boolean;
  isFutureDate: boolean;
  isPastDate: boolean;
  isToday: boolean;
  currentWeek: { week_number: number } | null | undefined;
  dayLabel: string;
  colors: {
    border: string;
    text: string;
    secondaryText: string;
    accent: string;
  };
  onPrevDay: () => void;
  onNextDay: () => void;
  onGoToToday: () => void;
}

export function DayNavBar({
  selectedDate,
  today,
  canGoBack,
  isFutureDate,
  isPastDate,
  isToday,
  currentWeek,
  dayLabel,
  colors,
  onPrevDay,
  onNextDay,
  onGoToToday,
}: DayNavBarProps) {
  return (
    <View style={[styles.dayNav, { borderBottomColor: colors.border }]}>
      <TouchableOpacity
        onPress={onPrevDay}
        disabled={!canGoBack}
        style={[styles.navArrow, !canGoBack && { opacity: 0.3 }]}
        accessibilityRole="button"
        accessibilityLabel="Previous day"
        accessibilityState={{ disabled: !canGoBack }}
      >
        <Text style={[styles.navArrowText, { color: colors.text }]}>‹</Text>
      </TouchableOpacity>

      <View style={styles.dayInfo}>
        <View>
          <ThemedText type="defaultSemiBold" style={styles.dayLabel}>
            {dayLabel}
          </ThemedText>
        </View>
        {currentWeek && (
          <ThemedText
            style={[styles.daySubLabel, { color: colors.secondaryText }]}
          >
            Week {currentWeek.week_number}
            {isPastDate
              ? " · Past lineup (read-only)"
              : isToday
                ? " · Today's lineup"
                : ""}
          </ThemedText>
        )}
        {!currentWeek && isPastDate && (
          <ThemedText
            style={[styles.daySubLabel, { color: colors.secondaryText }]}
          >
            Past lineup (read-only)
          </ThemedText>
        )}
        {!currentWeek && isToday && (
          <ThemedText
            style={[styles.daySubLabel, { color: colors.secondaryText }]}
          >
            Today's lineup
          </ThemedText>
        )}
      </View>

      <TouchableOpacity
        onPress={onNextDay}
        style={styles.navArrow}
        accessibilityRole="button"
        accessibilityLabel="Next day"
      >
        <Text style={[styles.navArrowText, { color: colors.text }]}>›</Text>
      </TouchableOpacity>

      {selectedDate !== today && (
        <TouchableOpacity
          onPress={onGoToToday}
          style={[
            styles.todayChip,
            isFutureDate ? styles.todayChipLeft : styles.todayChipRight,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Go to today"
        >
          <ThemedText style={[styles.todayChipText, { color: colors.accent }]}>
            Today
          </ThemedText>
        </TouchableOpacity>
      )}
    </View>
  );
}
