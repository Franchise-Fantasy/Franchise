import { ThemedText } from '@/components/ui/ThemedText';
import { Colors, cardShadow } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import type { PollCardProps } from '@/types/cms';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { ms, s } from '@/utils/scale';

export function PollCard({ question, options, expiryDate, onVote }: PollCardProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  const expiryLabel = expiryDate ? formatExpiry(expiryDate) : null;

  return (
    <View
      style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}
      accessibilityRole="summary"
      accessibilityLabel={`Poll: ${question}`}
    >
      <ThemedText type="defaultSemiBold" style={styles.question}>
        {question}
      </ThemedText>

      {options.map((option, i) => (
        <TouchableOpacity
          key={i}
          style={[styles.optionBar, { backgroundColor: c.cardAlt }]}
          onPress={() => onVote?.(i)}
          activeOpacity={onVote ? 0.7 : 1}
          accessibilityRole="button"
          accessibilityLabel={`Vote for: ${option}`}
        >
          <ThemedText style={styles.optionText}>{option}</ThemedText>
        </TouchableOpacity>
      ))}

      {expiryLabel ? (
        <ThemedText style={[styles.expiry, { color: c.secondaryText }]}>
          {expiryLabel}
        </ThemedText>
      ) : null}
    </View>
  );
}

/** Format an ISO expiry date into a human-readable relative label. */
function formatExpiry(iso: string): string {
  const target = new Date(iso);
  const now = new Date();
  const diffMs = target.getTime() - now.getTime();

  if (diffMs <= 0) return 'Poll ended';

  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 1) return 'Ends tomorrow';
  if (diffDays <= 7) return `Ends in ${diffDays} days`;
  return `Ends ${target.toLocaleDateString()}`;
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
    borderWidth: 1,
    padding: s(14),
    ...cardShadow,
  },
  question: {
    fontSize: ms(15),
    marginBottom: s(10),
  },
  optionBar: {
    borderRadius: 8,
    padding: s(12),
    marginTop: s(8),
  },
  optionText: {
    fontSize: ms(14),
  },
  expiry: {
    fontSize: ms(11),
    marginTop: s(10),
  },
});
