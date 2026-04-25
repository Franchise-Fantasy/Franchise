import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { ms, s } from '@/utils/scale';
import { ThemedText } from './ThemedText';

type Props = {
  /** Varsity-caps label rendered above the control. Matches the label
   * typography baked into `BrandTextInput` so labelled pickers, toggles,
   * and date buttons share one visual voice inside a FormSection. */
  label: string;
  /** Optional muted helper text under the control — short usage hints. */
  helperText?: string;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
};

/**
 * Label + control wrapper for wizard form fields whose control doesn't
 * carry its own built-in label (`SegmentedControl`, custom toggles,
 * date pickers, etc.). Drop-in companion to `BrandTextInput` — same
 * label treatment, tight spacing between label and control.
 */
export function FieldGroup({ label, helperText, style, children }: Props) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  return (
    <View style={[styles.wrap, style]}>
      <ThemedText
        type="varsitySmall"
        style={[styles.label, { color: c.secondaryText }]}
      >
        {label}
      </ThemedText>
      {children}
      {helperText && (
        <ThemedText style={[styles.helper, { color: c.secondaryText }]}>
          {helperText}
        </ThemedText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignSelf: 'stretch',
  },
  label: {
    marginBottom: s(6),
    fontSize: ms(10),
  },
  helper: {
    marginTop: s(6),
    fontSize: ms(12),
    lineHeight: ms(17),
  },
});
