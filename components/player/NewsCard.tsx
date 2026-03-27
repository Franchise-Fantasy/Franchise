import { ThemedText } from '@/components/ThemedText';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import type { PlayerNewsArticle } from '@/types/news';
import { Linking, StyleSheet, TouchableOpacity, View } from 'react-native';

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const SOURCE_LABELS: Record<string, string> = {
  rotowire: 'RotoWire',
  fantasypros: 'FantasyPros',
};

function returnEstimateColor(
  estimate: string,
  c: (typeof Colors)['light'],
): { bg: string; text: string } {
  const lower = estimate.toLowerCase();
  if (lower.includes('season') || lower.includes('indefinitely')) {
    return { bg: c.dangerMuted, text: c.danger };
  }
  if (lower.includes('day-to-day')) {
    return { bg: c.goldMuted, text: c.gold };
  }
  return { bg: c.warningMuted, text: c.warning };
}

export function NewsCard({ article }: { article: PlayerNewsArticle }) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  const sourceLabel = SOURCE_LABELS[article.source] ?? article.source;

  const a11yParts = [`News: ${article.title}`, `from ${sourceLabel}`];
  if (article.has_minutes_restriction) a11yParts.push('minutes restriction');
  if (article.return_estimate) a11yParts.push(`estimated return: ${article.return_estimate}`);

  return (
    <TouchableOpacity
      style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}
      onPress={() => Linking.openURL(article.link)}
      activeOpacity={0.7}
      accessibilityRole="link"
      accessibilityLabel={a11yParts.join(', ')}
    >
      {/* Top row: source + badges + time */}
      <View style={styles.topRow}>
        <View style={styles.badges}>
          <View style={[styles.pill, { backgroundColor: c.accent }]}>
            <ThemedText style={[styles.pillText, { color: c.statusText }]}>
              {sourceLabel}
            </ThemedText>
          </View>
          {article.has_minutes_restriction && (
            <View style={[styles.pill, { backgroundColor: c.warningMuted }]}>
              <ThemedText style={[styles.pillText, { color: c.warning }]}>
                MIN RESTRICT
              </ThemedText>
            </View>
          )}
        </View>
        <ThemedText style={[styles.time, { color: c.secondaryText }]}>
          {timeAgo(article.published_at)}
        </ThemedText>
      </View>

      {/* Title */}
      <ThemedText type="defaultSemiBold" style={styles.title} numberOfLines={2}>
        {article.title}
      </ThemedText>

      {/* Return estimate badge */}
      {article.return_estimate && (
        <View
          style={[
            styles.returnBadge,
            { backgroundColor: returnEstimateColor(article.return_estimate, c).bg },
          ]}
        >
          <ThemedText
            style={[
              styles.returnText,
              { color: returnEstimateColor(article.return_estimate, c).text },
            ]}
          >
            {article.return_estimate}
          </ThemedText>
        </View>
      )}

      {/* Description excerpt */}
      {article.description ? (
        <ThemedText style={[styles.excerpt, { color: c.secondaryText }]} numberOfLines={3}>
          {article.description}
        </ThemedText>
      ) : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 14,
    gap: 6,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  badges: {
    flexDirection: 'row',
    gap: 6,
    flexShrink: 1,
  },
  pill: {
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  pillText: {
    fontSize: 11,
    fontWeight: '600',
  },
  time: {
    fontSize: 11,
    flexShrink: 0,
    marginLeft: 8,
  },
  title: {
    fontSize: 15,
  },
  returnBadge: {
    alignSelf: 'flex-start',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  returnText: {
    fontSize: 11,
    fontWeight: '600',
  },
  excerpt: {
    fontSize: 13,
    lineHeight: 18,
  },
});
