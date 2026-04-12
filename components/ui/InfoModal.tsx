/**
 * Reusable floating info modal — replaces native Alert.alert for
 * informational / tooltip-style popups across the app.
 */
import { Ionicons } from "@expo/vector-icons";
import React from "react";
import {
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { Colors } from "@/constants/Colors";
import { useColorScheme } from "@/hooks/useColorScheme";
import { ms, s } from "@/utils/scale";

interface InfoModalProps {
  visible: boolean;
  onClose: () => void;
  title: string;
  /** Plain-text message (rendered as a single paragraph). */
  message?: string;
  /** For richer content, pass children instead of / in addition to message. */
  children?: React.ReactNode;
}

export function InfoModal({
  visible,
  onClose,
  title,
  message,
  children,
}: InfoModalProps) {
  const scheme = useColorScheme() ?? "dark";
  const c = Colors[scheme];
  const isDark = scheme === "dark";

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <TouchableOpacity
        style={styles.overlay}
        activeOpacity={1}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Close info modal"
      >
        <View
          style={[
            styles.card,
            {
              backgroundColor: isDark ? "#1C1C1E" : "#FFFFFF",
              borderColor: isDark
                ? "rgba(255,255,255,0.1)"
                : "rgba(0,0,0,0.1)",
            },
          ]}
          onStartShouldSetResponder={() => true}
          accessibilityViewIsModal
        >
          <View style={styles.header}>
            <Text
              style={[styles.title, { color: c.text }]}
              accessibilityRole="header"
            >
              {title}
            </Text>
            <TouchableOpacity
              onPress={onClose}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel="Close info"
            >
              <Ionicons name="close" size={20} color={c.secondaryText} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.body} bounces={false}>
            {message ? (
              <Text style={[styles.text, { color: c.secondaryText }]}>
                {message}
              </Text>
            ) : null}
            {children}
          </ScrollView>
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: s(24),
  },
  card: {
    borderWidth: 1,
    borderRadius: 16,
    padding: s(20),
    width: "100%",
    maxWidth: s(360),
    maxHeight: "80%",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: s(14),
  },
  title: {
    fontSize: ms(16),
    fontWeight: "700",
    flex: 1,
    marginRight: s(12),
  },
  body: {
    flexGrow: 0,
  },
  text: {
    fontSize: ms(13),
    lineHeight: ms(19),
    marginBottom: s(12),
  },
});
