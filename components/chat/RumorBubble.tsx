import { ThemedText } from '@/components/ThemedText';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { StyleSheet, View } from 'react-native';

const AMBER = '#F59E0B';

interface Props {
  rumorText: string;
}

export function RumorBubble({ rumorText }: Props) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  return (
    <View
      style={[styles.card, { backgroundColor: c.cardAlt, borderLeftColor: AMBER }]}
      accessibilityRole="summary"
      accessibilityLabel={`Trade rumor: ${rumorText}`}
    >
      <ThemedText style={styles.header}>👀 TRADE RUMOR</ThemedText>
      <ThemedText style={[styles.rumorText, { color: c.text }]}>
        &ldquo;{rumorText}&rdquo;
      </ThemedText>
      <ThemedText style={[styles.attribution, { color: c.secondaryText }]}>
        — League Sources
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 14,
    borderLeftWidth: 3,
    padding: 14,
    gap: 6,
  },
  header: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  rumorText: {
    fontSize: 15,
    lineHeight: 22,
    fontStyle: 'italic',
  },
  attribution: {
    fontSize: 12,
    fontWeight: '600',
  },
});
