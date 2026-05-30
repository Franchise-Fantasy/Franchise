import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/ui/ThemedText';
import { Fonts } from '@/constants/Colors';
import { useColors } from '@/hooks/useColors';
import { ms, s } from '@/utils/scale';

/**
 * Shared empty state for the analytics surfaces (category, age, and strength
 * views all reuse it). A gold rule, a display-type title, and an uppercase
 * sub-line — matches the "Nothing to chart yet." treatment that lived inline
 * in app/analytics.tsx.
 */
export function AnalyticsEmptyState({ title, sub }: { title: string; sub: string }) {
  const c = useColors();
  return (
    <View style={styles.emptyState} accessibilityLabel={`${title}. ${sub}`}>
      <View style={[styles.emptyRule, { backgroundColor: c.gold }]} />
      <ThemedText type="display" style={[styles.emptyTitle, { color: c.text }]}>
        {title}
      </ThemedText>
      <ThemedText type="varsitySmall" style={[styles.emptySub, { color: c.secondaryText }]}>
        {sub}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: s(10),
    paddingHorizontal: s(32),
    paddingTop: s(40),
  },
  emptyRule: {
    height: 2,
    width: s(48),
    marginBottom: s(8),
  },
  emptyTitle: {
    fontFamily: Fonts.display,
    fontSize: ms(22),
    lineHeight: ms(26),
    letterSpacing: -0.2,
    textAlign: 'center',
  },
  emptySub: {
    fontSize: ms(11),
    letterSpacing: 1.3,
    textAlign: 'center',
  },
});
