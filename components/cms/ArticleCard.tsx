import { ThemedText } from '@/components/ThemedText';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import type { ArticleCardProps } from '@/types/cms';
import { Image, StyleSheet, TouchableOpacity, View } from 'react-native';

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
    borderRadius: 10,
    borderWidth: 1,
    overflow: 'hidden',
  },
  hero: {
    width: '100%',
    height: 180,
  },
  content: {
    padding: 14,
  },
  categoryPill: {
    alignSelf: 'flex-start',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginBottom: 6,
  },
  categoryText: {
    fontSize: 11,
    fontWeight: '600',
  },
  title: {
    fontSize: 16,
    marginBottom: 4,
  },
  excerpt: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 6,
  },
  videoBadge: {
    alignSelf: 'flex-start',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginBottom: 6,
  },
  videoBadgeText: {
    fontSize: 12,
    fontWeight: '600',
  },
  meta: {
    fontSize: 11,
  },
});
