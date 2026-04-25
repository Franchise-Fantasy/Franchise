import { Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useProspectNews } from '@/hooks/useProspectNews';
import { ms, s } from '@/utils/scale';

interface ProspectNewsSectionProps {
  playerId: string;
}

export function ProspectNewsSection({ playerId }: ProspectNewsSectionProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const { data: news } = useProspectNews(playerId);

  if (!news?.length) return null;

  return (
    <View style={styles.section}>
      <Text style={[styles.label, { color: c.tint }]}>LATEST NEWS</Text>
      {news.slice(0, 5).map(item => {
        let timeAgo = '';
        try {
          const diff = Date.now() - new Date(item.published_at).getTime();
          const hours = Math.floor(diff / (1000 * 60 * 60));
          if (hours < 1) timeAgo = 'Just now';
          else if (hours < 24) timeAgo = `${hours}h ago`;
          else timeAgo = `${Math.floor(hours / 24)}d ago`;
        } catch {
          timeAgo = '';
        }

        return (
          <TouchableOpacity
            key={item.id}
            style={[styles.newsCard, { backgroundColor: c.card, borderColor: c.border }]}
            onPress={() => Linking.openURL(item.link)}
            accessibilityRole="link"
            accessibilityLabel={`${item.title}, from ${item.source}`}
          >
            <Text style={[styles.newsTitle, { color: c.text }]} numberOfLines={2}>
              {item.title}
            </Text>
            <Text style={[styles.newsMeta, { color: c.secondaryText }]}>
              {timeAgo}{timeAgo && item.source ? ' · ' : ''}{item.source}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    paddingHorizontal: s(16),
    marginBottom: s(16),
  },
  label: {
    fontSize: ms(11),
    fontWeight: '700',
    letterSpacing: 0.5,
    marginBottom: s(8),
  },
  newsCard: {
    padding: s(12),
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: s(6),
  },
  newsTitle: {
    fontSize: ms(13),
    fontWeight: '600',
    lineHeight: ms(18),
  },
  newsMeta: {
    fontSize: ms(10),
    marginTop: s(4),
  },
});
