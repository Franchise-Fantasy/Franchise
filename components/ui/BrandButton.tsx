import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  TouchableOpacity,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { Brand, Colors } from '@/constants/Colors';
import { useColors } from '@/hooks/useColors';
import { ms, s } from '@/utils/scale';

import { ThemedText } from './ThemedText';

export type BrandButtonVariant = 'primary' | 'secondary' | 'ghost';
export type BrandButtonSize = 'small' | 'default' | 'large';

type Props = {
  label: string;
  onPress: () => void;
  variant?: BrandButtonVariant;
  size?: BrandButtonSize;
  /** Leading icon (Ionicons). Pairs with the label. */
  icon?: keyof typeof Ionicons.glyphMap;
  /** Shows a spinner in place of the label + disables the button. */
  loading?: boolean;
  disabled?: boolean;
  /** Stretch to parent width. Default `false`. */
  fullWidth?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
};

/**
 * Brand button. Three variants — primary (filled turfGreen CTA),
 * secondary (outlined dark on light), ghost (text-only accent).
 *
 * Tuned for the app's LIGHT ecru/cream surfaces. HomeHero's pills
 * (`OutlinePill`, `PulsingPill`) are intentionally separate — they're
 * calibrated for the dark turfGreen hero surface with translucent ecru
 * borders, and bringing them under a single component would force awkward
 * surface-aware prop plumbing.
 */
export function BrandButton({
  label,
  onPress,
  variant = 'primary',
  size = 'default',
  icon,
  loading = false,
  disabled = false,
  fullWidth = false,
  accessibilityLabel,
  accessibilityHint,
  style,
}: Props) {
  const c = useColors();

  const colors = resolveColors(variant, c);
  const sizing = SIZES[size];
  const isInactive = disabled || loading;

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={isInactive}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: isInactive, busy: loading }}
      style={[
        styles.base,
        {
          backgroundColor: colors.bg,
          borderColor: colors.border,
          borderWidth: variant === 'secondary' ? 1 : 0,
          paddingVertical: sizing.paddingV,
          paddingHorizontal: sizing.paddingH,
        },
        fullWidth && styles.fullWidth,
        isInactive && styles.inactive,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={colors.fg} />
      ) : (
        <View style={styles.content}>
          {icon && (
            <Ionicons
              name={icon}
              size={sizing.icon}
              color={colors.fg}
              style={{ marginRight: s(6) }}
            />
          )}
          <ThemedText
            type="varsity"
            style={{ color: colors.fg, fontSize: sizing.font, letterSpacing: 0.8 }}
          >
            {label}
          </ThemedText>
        </View>
      )}
    </TouchableOpacity>
  );
}

function resolveColors(variant: BrandButtonVariant, c: typeof Colors.light) {
  switch (variant) {
    case 'primary':
      // Filled turfGreen on light surfaces — the brand's structural
      // authority color. Ecru text mirrors the landing-page hero CTA
      // ("JOIN WAITLIST" — green fill, cream text, varsity caps).
      return { bg: Brand.turfGreen, fg: Brand.ecru, border: 'transparent' };
    case 'secondary':
      // Outlined, transparent fill. Text + border share the theme's
      // primary text color so the button reads as "same weight as
      // content, tap-able." Matches the landing page's "SEE WHAT'S
      // DIFFERENT" secondary CTA.
      return { bg: 'transparent', fg: c.text, border: c.border };
    case 'ghost':
      // No border, no bg — accent-colored varsity text only. For
      // tertiary or repeat-use actions inside dense forms where
      // bordered buttons would be visual noise.
      return { bg: 'transparent', fg: c.accent, border: 'transparent' };
  }
}

const SIZES = {
  small: { paddingV: s(6), paddingH: s(12), font: ms(10), icon: ms(14) },
  default: { paddingV: s(10), paddingH: s(18), font: ms(12), icon: ms(16) },
  large: { paddingV: s(14), paddingH: s(22), font: ms(13), icon: ms(18) },
} as const;

const styles = StyleSheet.create({
  base: {
    borderRadius: 10,
    alignSelf: 'flex-start',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullWidth: {
    alignSelf: 'stretch',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  inactive: {
    opacity: 0.5,
  },
});
