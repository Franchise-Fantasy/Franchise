import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { ms, s } from '@/utils/scale';
import { StyleSheet, Text, View } from 'react-native';

interface DynastyScoreBadgeProps {
  score: number;
  size?: 'small' | 'large';
}

/** Color-scaled dynasty score pill. Higher = more orange, lower = muted. */
export function DynastyScoreBadge({ score, size = 'small' }: DynastyScoreBadgeProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  // Color scale: 80+ = accent, 60-79 = gold, <60 = muted
  const bgColor = score >= 80 ? c.accent : score >= 60 ? c.gold : c.cardAlt;
  const textColor = score >= 60 ? '#fff' : c.secondaryText;

  const isLarge = size === 'large';

  return (
    <View
      style={[
        styles.pill,
        isLarge && styles.pillLarge,
        { backgroundColor: bgColor },
      ]}
      accessibilityLabel={`Dynasty score ${score}`}
    >
      <Text style={[styles.text, isLarge && styles.textLarge, { color: textColor }]}>
        {score}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    paddingHorizontal: s(8),
    paddingVertical: s(2),
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillLarge: {
    paddingHorizontal: s(14),
    paddingVertical: s(6),
    borderRadius: 12,
  },
  text: {
    fontSize: ms(11),
    fontWeight: '700',
  },
  textLarge: {
    fontSize: ms(22),
    fontWeight: '800',
  },
});
