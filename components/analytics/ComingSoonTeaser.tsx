import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/ui/ThemedText';
import { Fonts } from '@/constants/Colors';
import { useColors } from '@/hooks/useColors';
import { ms, s } from '@/utils/scale';

/**
 * Non-interactive teaser for the upcoming "Performance vs Expected" analytic.
 * Shown to single-year (keeper/redraft) leagues in place of the age analytics
 * until real projections ship. Plain <View> — there's nothing behind a tap.
 */
export function ComingSoonTeaser() {
  const c = useColors();
  return (
    <View
      style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}
      accessibilityLabel="Performance versus expected, coming soon. Compares each player to projections once they are available."
    >
      <View style={styles.headerRow}>
        <View style={[styles.rule, { backgroundColor: c.gold }]} />
        <ThemedText type="varsitySmall" style={[styles.eyebrow, { color: c.secondaryText }]}>
          PERFORMANCE VS EXPECTED
        </ThemedText>
        <View style={[styles.badge, { borderColor: c.gold }]}>
          <ThemedText type="varsitySmall" style={[styles.badgeText, { color: c.gold }]}>
            COMING SOON
          </ThemedText>
        </View>
      </View>
      <ThemedText type="display" style={[styles.title, { color: c.text }]}>
        Beating the projection
      </ThemedText>
      <ThemedText style={[styles.body, { color: c.secondaryText }]}>
        Once projections are wired up, this will chart each player against their
        expected output — so you can see who's overperforming and who's a sell-high.
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: s(16),
    paddingTop: s(14),
    paddingBottom: s(16),
    marginTop: s(14),
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(8),
    marginBottom: s(10),
  },
  rule: {
    height: 2,
    width: s(18),
  },
  eyebrow: {
    flex: 1,
    fontSize: ms(9.5),
    letterSpacing: 1.3,
  },
  badge: {
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: s(6),
    paddingVertical: s(2),
  },
  badgeText: {
    fontSize: ms(8.5),
    letterSpacing: 1.0,
  },
  title: {
    fontFamily: Fonts.display,
    fontSize: ms(20),
    lineHeight: ms(24),
    letterSpacing: -0.2,
    marginBottom: s(6),
  },
  body: {
    fontSize: ms(13),
    lineHeight: ms(19),
  },
});
