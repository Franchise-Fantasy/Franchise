import { memo } from 'react';
import { Image, Linking, StyleSheet, TouchableOpacity, View } from 'react-native';

import { ThemedText } from '@/components/ui/ThemedText';
import { Colors, cardShadow } from '@/constants/Colors';
import { useActiveLeagueSport } from "@/hooks/useActiveLeagueSport";
import { useColorScheme } from '@/hooks/useColorScheme';
import type { PlayerNewsArticle } from '@/types/news';
import { getPlayerHeadshotUrl } from '@/utils/playerHeadshot';
import { ms, s } from '@/utils/scale';


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

interface NewsCardProps {
  article: PlayerNewsArticle;
  /** Show circular player headshots (used on News screen, not in player modal). */
  showHeadshots?: boolean;
}

function NewsCardBase({ article, showHeadshots }: NewsCardProps) {
  const sport = useActiveLeagueSport();
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  const a11yParts = [`News: ${article.title}`];
  if (article.return_estimate) a11yParts.push(`estimated return: ${article.return_estimate}`);

  const players = article.mentioned_players ?? [];
  const headshots = showHeadshots
    ? players.map(p => getPlayerHeadshotUrl(p.external_id_nba, sport)).filter(Boolean)
    : [];

  return (
    <TouchableOpacity
      style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}
      onPress={() => Linking.openURL(article.link)}
      activeOpacity={0.7}
      accessibilityRole="link"
      accessibilityLabel={a11yParts.join(', ')}
    >
      {/* Title row: headshots + title */}
      <View style={styles.titleRow}>
        {headshots.length > 0 && (
          <View style={styles.headshots}>
            {headshots.slice(0, 2).map((url, i) => (
              <View
                key={i}
                style={[styles.headshotCircle, { borderColor: c.heritageGold, backgroundColor: c.cardAlt }]}
                accessibilityLabel={players[i]?.name ?? 'Player'}
              >
                <Image
                  source={{ uri: url! }}
                  style={styles.headshotImg}
                  resizeMode="cover"
                />
              </View>
            ))}
          </View>
        )}
        <ThemedText type="defaultSemiBold" style={styles.title} numberOfLines={2}>
          {article.title}
        </ThemedText>
      </View>

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

      {/* Footer: time left, source right */}
      <View style={styles.footer}>
        <ThemedText style={[styles.meta, { color: c.secondaryText }]}>
          {timeAgo(article.published_at)}
        </ThemedText>
        <ThemedText style={[styles.meta, { color: c.secondaryText }]}>
          RotoWire.com
        </ThemedText>
      </View>
    </TouchableOpacity>
  );
}

export const NewsCard = memo(NewsCardBase);

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
    borderWidth: 1,
    padding: s(14),
    gap: s(6),
    ...cardShadow,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(10),
  },
  headshots: {
    flexDirection: 'row',
    gap: s(-8),
  },
  headshotCircle: {
    width: s(38),
    height: s(38),
    borderRadius: 20,
    borderWidth: 1.5,
    overflow: 'hidden',
  },
  headshotImg: {
    position: 'absolute',
    bottom: s(-2),
    left: 0,
    right: 0,
    height: s(34),
  },
  title: {
    fontSize: ms(15),
    flex: 1,
  },
  returnBadge: {
    alignSelf: 'flex-start',
    borderRadius: 6,
    paddingHorizontal: s(8),
    paddingVertical: s(3),
  },
  returnText: {
    fontSize: ms(11),
    fontWeight: '600',
  },
  excerpt: {
    fontSize: ms(13),
    lineHeight: ms(18),
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  meta: {
    fontSize: ms(11),
  },
});
