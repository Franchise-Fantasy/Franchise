/**
 * Branded two-button confirmation overlay. Replaces every two-button
 * `Alert.alert(title, message, [Cancel, Action])` and the older
 * `ConfirmModal`. Mechanically a plain absolute-positioned overlay (no
 * `<Modal>`), so it stacks reliably inside other Modals when rendered
 * from a `DialogHost`.
 *
 * Closing dismisses first and then fires `action.onPress` after the
 * fade-out so any downstream picker or modal doesn't fight the dismiss
 * frame.
 *
 * Pass `requireTypedConfirmation` for extra-friction destructive flows
 * (e.g. Delete Account). The action button stays disabled until the
 * user types the expected token (case-insensitive).
 */
import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { BrandDialogCard } from '@/components/ui/BrandDialogCard';
import { ThemedText } from '@/components/ui/ThemedText';
import { Brand, Fonts } from '@/constants/Colors';
import { useColors } from '@/hooks/useColors';
import { ms, s } from '@/utils/scale';

export type ConfirmAction = {
  label: string;
  onPress: () => void;
  destructive?: boolean;
};

export interface ConfirmConfig {
  title: string;
  message?: string;
  cancelLabel?: string;
  /** Optional cleanup when the user taps Cancel (real side effect, not dismiss-only). */
  onCancel?: () => void;
  action: ConfirmAction;
  /**
   * Adds a TextInput inside the card and disables the action button
   * until the typed value matches this token (case-insensitive,
   * trimmed). Use for destructive flows where a single tap is too easy.
   */
  requireTypedConfirmation?: string;
}

interface Props {
  config: ConfirmConfig;
  onClose: () => void;
}

const CLOSE_DELAY_MS = 180;

export function InlineConfirm({ config, onClose }: Props) {
  const c = useColors();
  const {
    title,
    message,
    cancelLabel = 'Cancel',
    onCancel,
    action,
    requireTypedConfirmation,
  } = config;

  const [typed, setTyped] = useState('');
  const requiresTyping = !!requireTypedConfirmation;
  const matchesToken = requiresTyping
    ? typed.trim().toLowerCase() === requireTypedConfirmation!.trim().toLowerCase()
    : true;

  const handleConfirm = () => {
    if (!matchesToken) return;
    onClose();
    setTimeout(action.onPress, CLOSE_DELAY_MS);
  };

  const handleCancel = () => {
    onClose();
    if (onCancel) setTimeout(onCancel, CLOSE_DELAY_MS);
  };

  const actionBg = action.destructive ? c.danger : c.gold;
  const actionFg = action.destructive ? Brand.ecru : Brand.ink;
  const buttonDisabled = !matchesToken;

  const card = (
    <BrandDialogCard title={title} message={message}>
      {requiresTyping ? (
        <View style={styles.typedSection}>
          <ThemedText
            type="varsitySmall"
            style={[styles.typedHint, { color: c.secondaryText }]}
          >
            TYPE “{requireTypedConfirmation!.toUpperCase()}” TO CONFIRM
          </ThemedText>
          <TextInput
            value={typed}
            onChangeText={setTyped}
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={handleConfirm}
            style={[
              styles.input,
              {
                backgroundColor: c.cardAlt,
                borderColor: matchesToken ? c.danger : c.border,
                color: c.text,
              },
            ]}
            accessibilityLabel={`Type ${requireTypedConfirmation} to confirm`}
          />
        </View>
      ) : null}

      <View style={styles.buttonRow}>
        <TouchableOpacity
          onPress={handleCancel}
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
          onPress={handleConfirm}
          disabled={buttonDisabled}
          style={[
            styles.btn,
            { backgroundColor: actionBg },
            buttonDisabled && styles.btnDisabled,
          ]}
          accessibilityRole="button"
          accessibilityLabel={action.label}
          accessibilityState={{ disabled: buttonDisabled }}
          activeOpacity={0.85}
        >
          <ThemedText style={[styles.actionText, { color: actionFg }]}>
            {action.label.toUpperCase()}
          </ThemedText>
        </TouchableOpacity>
      </View>
    </BrandDialogCard>
  );

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

      {requiresTyping ? (
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.keyboardWrap}
        >
          {card}
        </KeyboardAvoidingView>
      ) : (
        card
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(20, 16, 16, 0.55)', // Brand.ink @ 55%
    justifyContent: 'center',
    alignItems: 'center',
    padding: s(24),
  },
  keyboardWrap: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  typedSection: {
    marginBottom: s(14),
  },
  typedHint: {
    fontSize: ms(10),
    letterSpacing: 1.3,
    marginBottom: s(6),
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingVertical: s(10),
    paddingHorizontal: s(12),
    fontFamily: Fonts.body,
    fontSize: ms(15),
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
  btnDisabled: {
    opacity: 0.4,
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
