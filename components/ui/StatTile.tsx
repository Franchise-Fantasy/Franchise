import React from 'react';
import { StyleSheet, TouchableOpacity, View, type StyleProp, type ViewStyle } from 'react-native';

import { Colors, cardShadow } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { ms, s } from '@/utils/scale';
import { ThemedText } from './ThemedText';

type Props = {
  /** Small varsity label above the value (e.g. "LUCK"). */
  label: string;
  /** Main display value (e.g. "+2.4", "12-3", ".580"). */
  value: React.ReactNode;
  /** Optional sub-label below the value (e.g. "Lucky", "60% win rate"). */
  sub?: string;
  /** Tint for the main value (success/danger accents, for example). */
  valueColor?: string;
  onPress?: () => void;
  accessibilityLabel?: string;
  /** Override the tile's own style (width, min-height, grid behavior). */
  style?: StyleProp<ViewStyle>;
};

/**
 * Label / big-value / sub tile. Flex-basis 47% by default so two tiles
 * sit side-by-side; drop into a wrapping flex row with gap for a grid.
 */
export function StatTile({
  label,
  value,
  sub,
  valueColor,
  onPress,
  accessibilityLabel,
  style,
}: Props) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  const content = (
    <>
      <ThemedText type="varsitySmall" style={[styles.label, { color: c.secondaryText }]}>
        {label}
      </ThemedText>
      <ThemedText type="display" style={[styles.value, { color: valueColor ?? c.text }]}>
        {value}
      </ThemedText>
      {sub && (
        <ThemedText type="varsitySmall" style={[styles.sub, { color: c.secondaryText }]}>
          {sub}
        </ThemedText>
      )}
    </>
  );

  const tileStyle = [
    styles.tile,
    { backgroundColor: c.card, borderColor: c.border, ...cardShadow },
    style,
  ];

  if (onPress) {
    return (
      <TouchableOpacity
        style={tileStyle}
        onPress={onPress}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
      >
        {content}
      </TouchableOpacity>
    );
  }

  return (
    <View style={tileStyle} accessibilityLabel={accessibilityLabel}>
      {content}
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    flexBasis: '47%',
    flexGrow: 1,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: s(12),
    paddingHorizontal: s(10),
    alignItems: 'center',
    minHeight: s(78),
    justifyContent: 'center',
  },
  label: {
    fontSize: ms(9.5),
    marginBottom: s(4),
  },
  value: {
    fontSize: ms(20),
    lineHeight: ms(24),
    letterSpacing: -0.2,
  },
  sub: {
    fontSize: ms(9),
    marginTop: s(2),
  },
});
