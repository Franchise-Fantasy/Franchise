import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/ui/ThemedText';
import { Fonts } from '@/constants/Colors';
import { useColors } from '@/hooks/useColors';
import { ms, s } from '@/utils/scale';

interface OffseasonEmptyStateProps {
  title: string;
  subtitle: string;
  icon?: ComponentProps<typeof Ionicons>['name'];
  accessibilityLabel: string;
}

export function OffseasonEmptyState({
  title,
  subtitle,
  icon = 'sunny-outline',
  accessibilityLabel,
}: OffseasonEmptyStateProps) {
  const c = useColors();

  return (
    <View
      style={styles.container}
      accessible
      accessibilityRole="text"
      accessibilityLabel={accessibilityLabel}
    >
      <View style={[styles.rule, { backgroundColor: c.gold }]} />
      <Ionicons name={icon} size={ms(40)} color={c.secondaryText} accessible={false} />
      <ThemedText type="display" style={[styles.title, { color: c.text }]}>
        {title}
      </ThemedText>
      <ThemedText type="varsitySmall" style={[styles.subtitle, { color: c.secondaryText }]}>
        {subtitle}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: s(32),
    gap: s(10),
  },
  rule: {
    height: 2,
    width: s(48),
    marginBottom: s(8),
  },
  title: {
    fontFamily: Fonts.display,
    fontSize: ms(22),
    lineHeight: ms(26),
    letterSpacing: -0.2,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: ms(11),
    letterSpacing: 1.3,
    textAlign: 'center',
  },
});
