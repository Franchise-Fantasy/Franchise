import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Brand, Colors } from '@/constants/Colors';
import { useColors } from '@/hooks/useColors';
import { ms, s } from '@/utils/scale';

import { ThemedText } from './ThemedText';

export type BadgeVariant =
  | 'neutral'
  | 'success'
  | 'danger'
  | 'warning'
  | 'gold'
  | 'turf'
  | 'merlot';

type Props = {
  label: string;
  variant?: BadgeVariant;
  /** Compact size for inline pills next to tight text (weekly breakdown, streak). */
  size?: 'default' | 'small';
  /** Override the computed background color (rarely needed). */
  backgroundColor?: string;
  /** Override the computed text color (rarely needed). */
  textColor?: string;
  style?: StyleProp<ViewStyle>;
};

/**
 * Uppercase varsity pill. Covers every hand-rolled Live / Playoff / Commish /
 * Lucky / Unlucky / Clinched / Eliminated badge across the app, so they
 * don't drift in size, padding, or letterspacing.
 *
 * `success`/`danger`/`warning` use the theme's muted background + saturated
 * text (the "tinted chip" pattern). `gold`/`turf`/`merlot` are solid brand
 * fills — used for strong status signals (Live, Playoff, Commissioner).
 */
export function Badge({
  label,
  variant = 'neutral',
  size = 'default',
  backgroundColor,
  textColor,
  style,
}: Props) {
  const c = useColors();

  const { bg, fg } = resolveColors(variant, c);

  return (
    <View
      style={[
        size === 'small' ? styles.pillSmall : styles.pill,
        { backgroundColor: backgroundColor ?? bg },
        style,
      ]}
    >
      <ThemedText
        type="varsitySmall"
        style={[
          size === 'small' ? styles.textSmall : styles.text,
          { color: textColor ?? fg },
        ]}
      >
        {label}
      </ThemedText>
    </View>
  );
}

function resolveColors(variant: BadgeVariant, c: typeof Colors.light) {
  switch (variant) {
    case 'success':
      return { bg: c.successMuted, fg: c.success };
    case 'danger':
      return { bg: c.dangerMuted, fg: c.danger };
    case 'warning':
      return { bg: c.warningMuted, fg: c.warning };
    case 'gold':
      // `c.gold` is sport-tinted (orange for WNBA, vintage gold for NBA),
      // so Live/Playoff/Commissioner pills shift palette per league.
      return { bg: c.gold, fg: Brand.ink };
    case 'turf':
      return { bg: Brand.turfGreen, fg: Brand.ecru };
    case 'merlot':
      return { bg: Brand.merlot, fg: Brand.ecru };
    case 'neutral':
    default:
      return { bg: c.cardAlt, fg: c.secondaryText };
  }
}

const styles = StyleSheet.create({
  pill: {
    paddingHorizontal: s(6),
    paddingVertical: s(2),
    borderRadius: 4,
    alignSelf: 'center',
  },
  pillSmall: {
    paddingHorizontal: s(5),
    paddingVertical: s(1.5),
    borderRadius: 4,
    alignSelf: 'center',
  },
  text: {
    fontSize: ms(9),
    letterSpacing: 0.8,
  },
  textSmall: {
    fontSize: ms(8),
    letterSpacing: 0.5,
  },
});
