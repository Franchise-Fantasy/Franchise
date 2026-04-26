/**
 * Branded single-input prompt overlay. Replaces the `Alert.prompt`
 * pattern (iOS-only, no Android equivalent) with a cross-platform
 * branded card. Used for short text entries like "Edit Team Name" or
 * "Edit Tricode" — anything with one input + submit/cancel.
 *
 * Mechanically a plain absolute overlay (no `<Modal>`), so it stacks
 * reliably inside other Modals via `DialogHost`.
 *
 * Submit dismisses first, then fires `action.onSubmit(value)` after the
 * fade-out so any downstream picker doesn't fight the dismiss frame.
 */
import React, { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
  type KeyboardTypeOptions,
} from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { BrandDialogCard } from '@/components/ui/BrandDialogCard';
import { ThemedText } from '@/components/ui/ThemedText';
import { Brand, Fonts } from '@/constants/Colors';
import { useColors } from '@/hooks/useColors';
import { ms, s } from '@/utils/scale';

export type InputAction = {
  label: string;
  onSubmit: (value: string) => void;
  destructive?: boolean;
};

export interface InputConfig {
  title: string;
  message?: string;
  placeholder?: string;
  defaultValue?: string;
  maxLength?: number;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  keyboardType?: KeyboardTypeOptions;
  cancelLabel?: string;
  action: InputAction;
}

interface Props {
  config: InputConfig;
  onClose: () => void;
}

const CLOSE_DELAY_MS = 180;

export function InlineInput({ config, onClose }: Props) {
  const c = useColors();
  const {
    title,
    message,
    placeholder,
    defaultValue = '',
    maxLength,
    autoCapitalize = 'sentences',
    keyboardType,
    cancelLabel = 'Cancel',
    action,
  } = config;

  const [value, setValue] = useState(defaultValue);

  // Reset when the config changes (e.g. opening for a new field with a different default).
  useEffect(() => {
    setValue(defaultValue);
  }, [defaultValue]);

  const handleSubmit = () => {
    const submitted = value;
    onClose();
    setTimeout(() => action.onSubmit(submitted), CLOSE_DELAY_MS);
  };

  const actionBg = action.destructive ? c.danger : c.gold;
  const actionFg = action.destructive ? Brand.ecru : Brand.ink;

  return (
    <Animated.View
      entering={FadeIn.duration(140)}
      exiting={FadeOut.duration(120)}
      style={styles.scrim}
    >
      <TouchableOpacity
        style={StyleSheet.absoluteFill}
        activeOpacity={1}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Close"
      />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.center}
      >
        <BrandDialogCard title={title} message={message}>
          <TextInput
            value={value}
            onChangeText={setValue}
            placeholder={placeholder}
            placeholderTextColor={c.secondaryText}
            maxLength={maxLength}
            autoCapitalize={autoCapitalize}
            keyboardType={keyboardType}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={handleSubmit}
            style={[
              styles.input,
              {
                backgroundColor: c.cardAlt,
                borderColor: c.border,
                color: c.text,
              },
            ]}
            accessibilityLabel={title}
          />

          <View style={styles.buttonRow}>
            <TouchableOpacity
              onPress={onClose}
              style={[
                styles.btn,
                styles.cancelBtn,
                { backgroundColor: c.cardAlt, borderColor: c.border },
              ]}
              accessibilityRole="button"
              accessibilityLabel={cancelLabel}
              activeOpacity={0.65}
            >
              <ThemedText style={[styles.cancelText, { color: c.text }]}>
                {cancelLabel.toUpperCase()}
              </ThemedText>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleSubmit}
              style={[styles.btn, { backgroundColor: actionBg }]}
              accessibilityRole="button"
              accessibilityLabel={action.label}
              activeOpacity={0.85}
            >
              <ThemedText style={[styles.actionText, { color: actionFg }]}>
                {action.label.toUpperCase()}
              </ThemedText>
            </TouchableOpacity>
          </View>
        </BrandDialogCard>
      </KeyboardAvoidingView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(20, 16, 16, 0.55)',
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: s(24),
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingVertical: s(10),
    paddingHorizontal: s(12),
    fontFamily: Fonts.body,
    fontSize: ms(15),
    marginBottom: s(14),
  },
  buttonRow: {
    flexDirection: 'row',
    gap: s(10),
    marginTop: s(4),
  },
  btn: {
    flex: 1,
    paddingVertical: s(11),
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBtn: {
    borderWidth: StyleSheet.hairlineWidth,
  },
  cancelText: {
    fontFamily: Fonts.varsityBold,
    fontSize: ms(12),
    letterSpacing: 1.2,
  },
  actionText: {
    fontFamily: Fonts.varsityBold,
    fontSize: ms(12),
    letterSpacing: 1.2,
  },
});
