import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import { ThemedText } from "@/components/ui/ThemedText";

import { playerDetailStyles as styles } from "./playerDetailStyles";

interface TradeBlockPromptProps {
  initialNote: string;
  colors: {
    card: string;
    secondaryText: string;
    text: string;
    border: string;
    background: string;
    warning: string;
    statusText: string;
  };
  onCancel: () => void;
  onConfirm: (note: string | null) => void;
}

export function TradeBlockPrompt({
  initialNote,
  colors,
  onCancel,
  onConfirm,
}: TradeBlockPromptProps) {
  const [noteInput, setNoteInput] = useState(initialNote);

  return (
    <KeyboardAvoidingView
      style={styles.tradeBlockPromptOverlay}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View
        style={[styles.tradeBlockPromptCard, { backgroundColor: colors.card }]}
      >
        <ThemedText
          type="defaultSemiBold"
          style={styles.tradeBlockPromptTitle}
          accessibilityRole="header"
        >
          Add to Trade Block
        </ThemedText>
        <ThemedText
          style={[
            styles.tradeBlockPromptDesc,
            { color: colors.secondaryText },
          ]}
        >
          What are you looking for? (optional)
        </ThemedText>
        <TextInput
          style={[
            styles.tradeBlockPromptInput,
            {
              color: colors.text,
              borderColor: colors.border,
              backgroundColor: colors.background,
            },
          ]}
          value={noteInput}
          onChangeText={setNoteInput}
          placeholder='e.g. "2nd Rounder", "Wing player"'
          placeholderTextColor={colors.secondaryText}
          maxLength={100}
          autoFocus
          accessibilityLabel="Asking price or trade note"
        />
        <View style={styles.tradeBlockPromptButtons}>
          <TouchableOpacity
            style={[styles.tradeBlockPromptBtn, { borderColor: colors.border }]}
            onPress={onCancel}
            accessibilityRole="button"
            accessibilityLabel="Cancel"
          >
            <ThemedText>Cancel</ThemedText>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.tradeBlockPromptBtn,
              { backgroundColor: colors.warning },
            ]}
            onPress={() => onConfirm(noteInput.trim() || null)}
            accessibilityRole="button"
            accessibilityLabel="Add to trade block"
          >
            <ThemedText style={{ color: colors.statusText, fontWeight: "600" }}>
              Add
            </ThemedText>
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}
