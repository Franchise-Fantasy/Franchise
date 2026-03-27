import { ThemedText } from '@/components/ThemedText';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import type { SpotlightCardProps } from '@/types/cms';
import { Image, StyleSheet, TouchableOpacity, View } from 'react-native';

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
    borderRadius: 10,
    borderWidth: 1,
    padding: 14,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headshot: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 1.5,
    overflow: 'hidden',
  },
  placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderText: {
    fontSize: 22,
    fontWeight: '700',
  },
  headerText: {
    flex: 1,
  },
  playerName: {
    fontSize: 16,
  },
  subtitle: {
    fontSize: 12,
    marginTop: 1,
  },
  statPill: {
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  statText: {
    fontSize: 12,
    fontWeight: '700',
  },
  body: {
    fontSize: 13,
    lineHeight: 18,
    marginTop: 10,
  },
});
