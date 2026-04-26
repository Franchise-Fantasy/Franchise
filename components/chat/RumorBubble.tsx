import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/ui/ThemedText';
import { Brand, Fonts } from '@/constants/Colors';
import { useColors } from '@/hooks/useColors';
import { ms, s } from '@/utils/scale';

interface Props {
  rumorText: string;
}

export function RumorBubble({ rumorText }: Props) {
  const c = useColors();

  return (
    <View
      style={[styles.card, { backgroundColor: c.cardAlt, borderLeftColor: Brand.merlot }]}
      accessibilityRole="summary"
      accessibilityLabel={`Trade rumor: ${rumorText}`}
    >
      <View style={styles.headerRow}>
        <View style={[styles.eyebrowRule, { backgroundColor: Brand.merlot }]} />
        <ThemedText
          type="varsitySmall"
          style={[styles.header, { color: Brand.merlot }]}
        >
          👀 TRADE RUMOR
        </ThemedText>
      </View>
      <ThemedText style={[styles.rumorText, { color: c.text }]}>
        &ldquo;{rumorText}&rdquo;
      </ThemedText>
      <ThemedText
        type="varsitySmall"
        style={[styles.attribution, { color: c.secondaryText }]}
      >
        — LEAGUE SOURCES
      </ThemedText>
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
  rumorText: {
    fontFamily: Fonts.display,
    fontSize: ms(15),
    lineHeight: ms(22),
    letterSpacing: -0.2,
  },
  attribution: {
    fontSize: ms(10),
    letterSpacing: 1.2,
  },
});
