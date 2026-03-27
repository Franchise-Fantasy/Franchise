import { ThemedText } from '@/components/ThemedText';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { Ionicons } from '@expo/vector-icons';
import type { TipCardProps } from '@/types/cms';
import { StyleSheet, TouchableOpacity, View } from 'react-native';

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
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
  },
  row: {
    flexDirection: 'row',
    gap: 10,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textWrap: {
    flex: 1,
  },
  title: {
    fontSize: 14,
    marginBottom: 2,
  },
  body: {
    fontSize: 13,
    lineHeight: 18,
  },
  categoryPill: {
    alignSelf: 'flex-start',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginTop: 8,
  },
  categoryText: {
    fontSize: 11,
    fontWeight: '600',
  },
});
