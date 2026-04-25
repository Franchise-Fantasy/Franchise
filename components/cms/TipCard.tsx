import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, TouchableOpacity, View } from 'react-native';

import { ThemedText } from '@/components/ui/ThemedText';
import { Colors, cardShadow } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import type { TipCardProps } from '@/types/cms';
import { ms, s } from '@/utils/scale';

export function TipCard({ title, body, category, iconName, onPress }: TipCardProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  const icon = (iconName as keyof typeof Ionicons.glyphMap) || 'bulb-outline';

  const Wrapper = onPress ? TouchableOpacity : View;
  const wrapperProps = onPress
    ? { onPress, activeOpacity: 0.7, accessibilityRole: 'button' as const }
    : {};

  return (
    <Wrapper
      style={[styles.card, { backgroundColor: c.cardAlt, borderColor: c.border }]}
      accessibilityLabel={`Tip: ${title}`}
      {...wrapperProps}
    >
      <View style={styles.row}>
        <View style={[styles.iconWrap, { backgroundColor: c.card }]}>
          <Ionicons name={icon} size={20} color={c.accent} />
        </View>
        <View style={styles.textWrap}>
          <ThemedText type="defaultSemiBold" style={styles.title} numberOfLines={1}>
            {title}
          </ThemedText>
          <ThemedText style={[styles.body, { color: c.secondaryText }]} numberOfLines={2}>
            {body}
          </ThemedText>
        </View>
      </View>
      {category ? (
        <View style={[styles.categoryPill, { backgroundColor: c.card }]}>
          <ThemedText style={[styles.categoryText, { color: c.secondaryText }]}>
            {category}
          </ThemedText>
        </View>
      ) : null}
    </Wrapper>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
    borderWidth: 1,
    padding: s(12),
    ...cardShadow,
  },
  row: {
    flexDirection: 'row',
    gap: s(10),
  },
  iconWrap: {
    width: s(36),
    height: s(36),
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textWrap: {
    flex: 1,
  },
  title: {
    fontSize: ms(14),
    marginBottom: s(2),
  },
  body: {
    fontSize: ms(13),
    lineHeight: ms(18),
  },
  categoryPill: {
    alignSelf: 'flex-start',
    borderRadius: 10,
    paddingHorizontal: s(8),
    paddingVertical: s(2),
    marginTop: s(8),
  },
  categoryText: {
    fontSize: ms(11),
    fontWeight: '600',
  },
});
