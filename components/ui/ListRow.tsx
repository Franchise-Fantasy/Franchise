import React from 'react';
import {
  StyleSheet,
  TouchableOpacity,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { s } from '@/utils/scale';

type Props = {
  /** Item position in the list — when equal to `total - 1`, hides the bottom divider. */
  index: number;
  /** Total number of items, used to detect the last row. */
  total: number;
  /** Highlights the row (e.g. "this is my team" in a standings table). */
  isActive?: boolean;
  onPress?: () => void;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  /** Per-row style overrides. Merges over the base row + divider + isActive. */
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
};

/**
 * Divider-aware list row. Pulls the "hairline border, last-row gets none,
 * isMe row gets activeCard background, optionally pressable" logic out of
 * every table/list on every data screen.
 */
export function ListRow({
  index,
  total,
  isActive,
  onPress,
  accessibilityLabel,
  accessibilityHint,
  style,
  children,
}: Props) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const isLast = index === total - 1;

  const rowStyle = [
    styles.row,
    { borderBottomColor: c.border },
    isLast && styles.lastRow,
    isActive && { backgroundColor: c.activeCard },
    style,
  ];

  if (onPress) {
    return (
      <TouchableOpacity
        style={rowStyle}
        onPress={onPress}
        activeOpacity={0.6}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={accessibilityHint}
      >
        {children}
      </TouchableOpacity>
    );
  }

  return (
    <View style={rowStyle} accessibilityLabel={accessibilityLabel}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: s(10),
    paddingHorizontal: s(14),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  lastRow: {
    borderBottomWidth: 0,
  },
});
