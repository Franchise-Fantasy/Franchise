import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, TouchableOpacity, View, type StyleProp, type ViewStyle } from 'react-native';

import { Colors, cardShadow } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { ms, s } from '@/utils/scale';

import { ThemedText } from './ThemedText';

type Props = {
  /** Section heading. String or ReactNode (for varsitySmall division headers, etc.). */
  title: React.ReactNode;
  /** Shows an info-circle button next to the title. */
  onInfoPress?: () => void;
  /** Shows a right-aligned icon action (edit pencil, plus, etc.). */
  action?: {
    icon: keyof typeof Ionicons.glyphMap;
    onPress: () => void;
    accessibilityLabel: string;
    /** Defaults to heritageGold — the "editable / actionable" accent. */
    color?: string;
  };
  /** Override the card's internal padding. Default keeps the standard brand rhythm. */
  cardStyle?: StyleProp<ViewStyle>;
  /** Drop the card wrapper entirely (label + raw children). Rare — use for custom layouts. */
  noCard?: boolean;
  /** Hide the gold rule + title row entirely. Rare — use when embedding a labelless card. */
  noLabel?: boolean;
  children: React.ReactNode;
};

/**
 * Gold-rule label + bordered card — the repeated screen rhythm from the
 * brand deck ("01 — Brand Story" anchor pattern). Every data screen
 * (standings, schedule, league-history, league-info, roster) composes
 * one or more of these.
 */
export function Section({ title, onInfoPress, action, cardStyle, noCard, noLabel, children }: Props) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  const label = !noLabel ? (
    <View style={styles.labelRow}>
      <View style={[styles.labelRule, { backgroundColor: c.gold }]} />
      {typeof title === 'string' ? (
        <ThemedText
          type="sectionLabel"
          style={[styles.title, { color: c.text }]}
          accessibilityRole="header"
          numberOfLines={1}
        >
          {title}
        </ThemedText>
      ) : (
        <View style={styles.title}>{title}</View>
      )}
      {onInfoPress && (
        <TouchableOpacity
          onPress={onInfoPress}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={`What is ${typeof title === 'string' ? title : 'this'}?`}
        >
          <Ionicons name="information-circle-outline" size={ms(16)} color={c.secondaryText} />
        </TouchableOpacity>
      )}
      {action && (
        <TouchableOpacity
          onPress={action.onPress}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={action.accessibilityLabel}
        >
          <Ionicons
            name={action.icon}
            size={ms(16)}
            color={action.color ?? c.heritageGold}
          />
        </TouchableOpacity>
      )}
    </View>
  ) : null;

  const body = noCard ? (
    children
  ) : (
    <View
      style={[
        styles.card,
        { backgroundColor: c.card, borderColor: c.border, ...cardShadow },
        cardStyle,
      ]}
    >
      {children}
    </View>
  );

  return (
    <View style={styles.wrap}>
      {label}
      {body}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginBottom: s(4),
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: s(10),
    gap: s(10),
  },
  labelRule: {
    height: 2,
    width: s(18),
  },
  title: {
    flex: 1,
  },
  card: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: s(14),
    paddingTop: s(10),
    paddingBottom: s(8),
    marginBottom: s(16),
  },
});
