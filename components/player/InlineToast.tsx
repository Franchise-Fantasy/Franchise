import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/ui/ThemedText";
import { useColors } from "@/hooks/useColors";
import { ms, s } from "@/utils/scale";

const VISIBLE_MS = 1800;

/**
 * Confirmation toast state for a bottom sheet. The global ToastProvider renders
 * beneath the Modal on native, so anything triggered from inside a sheet needs
 * its own pill rendered within that sheet.
 */
export function useInlineToast() {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((next: string) => {
    if (timer.current) clearTimeout(timer.current);
    setMessage(next);
    timer.current = setTimeout(() => setMessage(null), VISIBLE_MS);
  }, []);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return { message, show };
}

/** Renders the pill from `useInlineToast`. Absolutely positioned — mount it as
 *  a sibling of the sheet's scrolling body, not inside it. */
export function InlineToast({ message }: { message: string | null }) {
  const c = useColors();
  if (!message) return null;

  return (
    <View
      pointerEvents="none"
      style={styles.wrap}
      accessibilityRole="alert"
      accessibilityLiveRegion="assertive"
      accessibilityLabel={message}
    >
      <View style={[styles.pill, { backgroundColor: c.success }]}>
        <Ionicons
          name="checkmark-circle"
          size={16}
          color={c.statusText}
          style={styles.icon}
        />
        <ThemedText style={[styles.text, { color: c.statusText }]}>{message}</ThemedText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    top: s(8),
    left: 0,
    right: 0,
    alignItems: "center",
    zIndex: 200,
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: s(12),
    paddingVertical: s(8),
    borderRadius: 999,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 6,
    maxWidth: "90%",
  },
  icon: {
    marginRight: s(6),
  },
  text: {
    fontSize: ms(13),
    fontWeight: "600",
  },
});
