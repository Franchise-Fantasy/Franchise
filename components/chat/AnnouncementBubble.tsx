import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/ui/ThemedText';
import { Fonts } from '@/constants/Colors';
import { useColors } from '@/hooks/useColors';
import { ms, s } from '@/utils/scale';

interface Props {
  text: string;
}

/**
 * League-wide notice (champion crowned, season over). Rendered as a centered
 * banner with no sender/avatar — it comes from the league, not from a team.
 */
export function AnnouncementBubble({ text }: Props) {
  const c = useColors();

  return (
    <View
      style={[styles.card, { backgroundColor: c.cardAlt, borderLeftColor: c.gold }]}
      accessibilityRole="summary"
      accessibilityLabel={`League announcement: ${text}`}
    >
      <View style={styles.headerRow}>
        <View style={[styles.eyebrowRule, { backgroundColor: c.gold }]} />
        <ThemedText type="varsitySmall" style={[styles.header, { color: c.gold }]}>
          LEAGUE ANNOUNCEMENT
        </ThemedText>
      </View>
      <ThemedText style={[styles.text, { color: c.text }]}>{text}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 14,
    borderLeftWidth: 3,
    padding: s(14),
    gap: s(8),
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(8),
  },
  eyebrowRule: {
    height: 2,
    width: s(20),
  },
  header: {
    fontSize: ms(11),
    letterSpacing: 1.4,
  },
  text: {
    fontFamily: Fonts.display,
    fontSize: ms(15),
    lineHeight: ms(22),
    letterSpacing: -0.2,
  },
});
