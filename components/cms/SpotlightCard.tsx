import { ThemedText } from '@/components/ui/ThemedText';
import { Colors, cardShadow } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import type { SpotlightCardProps } from '@/types/cms';
import { Image, StyleSheet, TouchableOpacity, View } from 'react-native';
import { ms, s } from '@/utils/scale';

export function SpotlightCard({
  title,
  playerName,
  headshotUrl,
  bodyExcerpt,
  statCallout,
  onPress,
}: SpotlightCardProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  const Wrapper = onPress ? TouchableOpacity : View;
  const wrapperProps = onPress
    ? { onPress, activeOpacity: 0.7, accessibilityRole: 'button' as const }
    : {};

  return (
    <Wrapper
      style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}
      accessibilityLabel={`Player spotlight: ${playerName}`}
      {...wrapperProps}
    >
      {/* Header row — headshot + name + stat */}
      <View style={styles.header}>
        {headshotUrl ? (
          <Image
            source={{ uri: headshotUrl }}
            style={[styles.headshot, { borderColor: c.border }]}
            accessibilityLabel={`${playerName} headshot`}
          />
        ) : (
          <View style={[styles.headshot, styles.placeholder, { borderColor: c.border, backgroundColor: c.cardAlt }]}>
            <ThemedText style={styles.placeholderText}>
              {playerName.charAt(0)}
            </ThemedText>
          </View>
        )}
        <View style={styles.headerText}>
          <ThemedText type="defaultSemiBold" style={styles.playerName} numberOfLines={1}>
            {playerName}
          </ThemedText>
          {title !== playerName ? (
            <ThemedText style={[styles.subtitle, { color: c.secondaryText }]} numberOfLines={1}>
              {title}
            </ThemedText>
          ) : null}
        </View>
        {statCallout ? (
          <View style={[styles.statPill, { backgroundColor: c.accent }]}>
            <ThemedText style={[styles.statText, { color: c.statusText }]}>{statCallout}</ThemedText>
          </View>
        ) : null}
      </View>

      {/* Body excerpt */}
      {bodyExcerpt ? (
        <ThemedText style={[styles.body, { color: c.secondaryText }]} numberOfLines={3}>
          {bodyExcerpt}
        </ThemedText>
      ) : null}
    </Wrapper>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
    borderWidth: 1,
    padding: s(14),
    ...cardShadow,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(10),
  },
  headshot: {
    width: s(56),
    height: s(56),
    borderRadius: 28,
    borderWidth: 1.5,
    overflow: 'hidden',
  },
  placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderText: {
    fontSize: ms(22),
    fontWeight: '700',
  },
  headerText: {
    flex: 1,
  },
  playerName: {
    fontSize: ms(16),
  },
  subtitle: {
    fontSize: ms(12),
    marginTop: 1,
  },
  statPill: {
    borderRadius: 12,
    paddingHorizontal: s(10),
    paddingVertical: s(4),
  },
  statText: {
    fontSize: ms(12),
    fontWeight: '700',
  },
  body: {
    fontSize: ms(13),
    lineHeight: ms(18),
    marginTop: s(10),
  },
});
