import { ThemedText } from '@/components/ui/ThemedText';
import { Colors, cardShadow } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import type { ArticleCardProps } from '@/types/cms';
import { Image, StyleSheet, TouchableOpacity, View } from 'react-native';
import { ms, s } from '@/utils/scale';

export function ArticleCard({
  title,
  heroImageUrl,
  bodyExcerpt,
  videoUrl,
  author,
  category,
  publishedDate,
  onPress,
}: ArticleCardProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  const dateLabel = publishedDate
    ? new Date(publishedDate).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : null;

  const meta = [author, dateLabel].filter(Boolean).join(' · ');

  const Wrapper = onPress ? TouchableOpacity : View;
  const wrapperProps = onPress
    ? { onPress, activeOpacity: 0.7, accessibilityRole: 'button' as const }
    : {};

  return (
    <Wrapper
      style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}
      accessibilityLabel={`Article: ${title}`}
      {...wrapperProps}
    >
      {/* Hero image */}
      {heroImageUrl ? (
        <Image
          source={{ uri: heroImageUrl }}
          style={styles.hero}
          resizeMode="cover"
          accessibilityLabel={`${title} hero image`}
        />
      ) : null}

      <View style={styles.content}>
        {/* Category pill */}
        {category ? (
          <View style={[styles.categoryPill, { backgroundColor: c.accent }]}>
            <ThemedText style={[styles.categoryText, { color: c.statusText }]}>{category}</ThemedText>
          </View>
        ) : null}

        {/* Title */}
        <ThemedText type="defaultSemiBold" style={styles.title} numberOfLines={2}>
          {title}
        </ThemedText>

        {/* Excerpt */}
        {bodyExcerpt ? (
          <ThemedText style={[styles.excerpt, { color: c.secondaryText }]} numberOfLines={3}>
            {bodyExcerpt}
          </ThemedText>
        ) : null}

        {/* Video indicator */}
        {videoUrl ? (
          <View style={[styles.videoBadge, { backgroundColor: c.cardAlt }]}>
            <ThemedText style={[styles.videoBadgeText, { color: c.accent }]}>
              ▶ Video
            </ThemedText>
          </View>
        ) : null}

        {/* Meta line */}
        {meta ? (
          <ThemedText style={[styles.meta, { color: c.secondaryText }]}>
            {meta}
          </ThemedText>
        ) : null}
      </View>
    </Wrapper>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
    ...cardShadow,
  },
  hero: {
    width: '100%',
    height: s(180),
  },
  content: {
    padding: s(14),
  },
  categoryPill: {
    alignSelf: 'flex-start',
    borderRadius: 12,
    paddingHorizontal: s(8),
    paddingVertical: s(2),
    marginBottom: s(6),
  },
  categoryText: {
    fontSize: ms(11),
    fontWeight: '600',
  },
  title: {
    fontSize: ms(16),
    marginBottom: s(4),
  },
  excerpt: {
    fontSize: ms(13),
    lineHeight: ms(18),
    marginBottom: s(6),
  },
  videoBadge: {
    alignSelf: 'flex-start',
    borderRadius: 6,
    paddingHorizontal: s(8),
    paddingVertical: s(3),
    marginBottom: s(6),
  },
  videoBadgeText: {
    fontSize: ms(12),
    fontWeight: '600',
  },
  meta: {
    fontSize: ms(11),
  },
});
