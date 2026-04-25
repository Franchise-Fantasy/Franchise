import React, { forwardRef, useState } from 'react';
import {
  StyleSheet,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { ms, s } from '@/utils/scale';

import { ThemedText } from './ThemedText';

type Props = Omit<TextInputProps, 'style'> & {
  /** Small varsity caps label rendered above the input. */
  label?: string;
  /** Muted helper text under the input — e.g. format hints. */
  helperText?: string;
  /** When set, replaces helperText and paints the border/text danger red. */
  errorText?: string;
  /** Wrapper style override — rarely needed. */
  containerStyle?: StyleProp<ViewStyle>;
  /** Input style override — use for font size / height adjustments. */
  inputStyle?: StyleProp<TextStyle>;
};

/**
 * Brand-tuned text input. Varsity-caps label on top, bordered cream
 * box with focus ring + error state, muted helper text below.
 *
 * Replaces the scattered "hand-styled TextInput" pattern across the
 * create/join/import flows where every field redeclares
 * `color: c.text, borderColor: c.border, backgroundColor: c.input`.
 */
export const BrandTextInput = forwardRef<TextInput, Props>(function BrandTextInput(
  {
    label,
    helperText,
    errorText,
    containerStyle,
    inputStyle,
    onFocus,
    onBlur,
    placeholderTextColor,
    ...inputProps
  },
  ref,
) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const [focused, setFocused] = useState(false);

  const hasError = !!errorText;
  const borderColor = hasError ? c.danger : focused ? c.accent : c.border;
  const helper = errorText ?? helperText;
  const helperColor = hasError ? c.danger : c.secondaryText;

  return (
    <View style={[styles.wrap, containerStyle]}>
      {label && (
        <ThemedText
          type="varsitySmall"
          style={[styles.label, { color: c.secondaryText }]}
        >
          {label}
        </ThemedText>
      )}
      <TextInput
        ref={ref}
        {...inputProps}
        placeholderTextColor={placeholderTextColor ?? c.secondaryText}
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
        style={[
          styles.input,
          {
            color: c.text,
            backgroundColor: c.input,
            borderColor,
            // Bump border to 1.5 on focus/error so the state shift is
            // visible without the input jumping size (we reserve the
            // space with the same 1.5 when unfocused, too).
            borderWidth: 1.5,
          },
          inputStyle,
        ]}
      />
      {helper && (
        <ThemedText style={[styles.helper, { color: helperColor }]}>
          {helper}
        </ThemedText>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: {
    alignSelf: 'stretch',
  },
  label: {
    marginBottom: s(6),
  },
  input: {
    borderRadius: 10,
    paddingHorizontal: s(12),
    paddingVertical: s(10),
    fontSize: ms(16),
    fontWeight: '500',
    // No explicit `lineHeight` — on iOS TextInput, setting line-height
    // taller than the font's natural ascent pushes the rendered
    // baseline to the bottom of the line-box, making the text look
    // "sunken." Padding alone handles the vertical rhythm now.
    textAlignVertical: 'center',
  },
  helper: {
    marginTop: s(4),
    fontSize: ms(11),
    lineHeight: ms(15),
  },
});
