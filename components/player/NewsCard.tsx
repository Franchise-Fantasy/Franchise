import { Image } from 'expo-image';
import { memo } from 'react';
import { Linking, StyleSheet, TouchableOpacity, View } from 'react-native';

import { Badge, type BadgeVariant } from '@/components/ui/Badge';
import { ThemedText } from '@/components/ui/ThemedText';
import { Fonts, cardShadow } from '@/constants/Colors';
import { useActiveLeagueSport } from '@/hooks/useActiveLeagueSport';
import { useColors } from '@/hooks/useColors';
import type { PlayerNewsArticle } from '@/types/news';
import { PLAYER_SILHOUETTE, getPlayerHeadshotUrl } from '@/utils/nba/playerHeadshot';
import { ms, s } from '@/utils/scale';

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'JUST NOW';
  if (mins < 60) return `${mins}M AGO`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}H AGO`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return 'YESTERDAY';
  if (days < 7) return `${days}D AGO`;
  return new Date(dateStr)
    .toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    .toUpperCase();
}

function returnEstimateVariant(estimate: string): BadgeVariant {
  // Season-ending / indefinite injuries get the merlot danger treatment;
  // everything else (day-to-day, GTD, week-to-week) reads as a gold warning.
  // We collapsed the previous day-to-day vs short-term split because both
  // produced visually identical gold chips in our palette.
  const lower = estimate.toLowerCase();
  if (lower.includes('season') || lower.includes('indefinitely')) {
    return 'danger';
  }
  return 'warning';
}

function sourceLabel(source: PlayerNewsArticle['source']): string {
  switch (source) {
    case 'rotowire':
      return 'ROTOWIRE';
    case 'cbssports':
      return 'CBS SPORTS';
    default:
      return String(source).toUpperCase();
  }
}

interface NewsCardProps {
  article: PlayerNewsArticle;
  /** Show circular player headshots (used on News screen, not in player modal). */
  showHeadshots?: boolean;
}

function NewsCardBase({ article, showHeadshots }: NewsCardProps) {
  const sport = useActiveLeagueSport();
  const c = useColors();

  const a11yParts = [`News: ${article.title}`];
  if (article.return_estimate) {
    a11yParts.push(`estimated return: ${article.return_estimate}`);
  }
  if (article.has_minutes_restriction) {
    a11yParts.push('minutes restriction');
  }

  const players = article.mentioned_players ?? [];
  const headshots = showHeadshots
    ? players.map((p) => getPlayerHeadshotUrl(p.external_id_nba, sport)).filter(Boolean)
    : [];

  const hasBadgeRow =
    !!article.return_estimate || article.has_minutes_restriction;

  return (
    <TouchableOpacity
      style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}
      onPress={() => Linking.openURL(article.link)}
      activeOpacity={0.7}
      accessibilityRole="link"
      accessibilityLabel={a11yParts.join(', ')}
    >
      {/* Title row: headshots + Alfa Slab title */}
      <View style={styles.titleRow}>
        {headshots.length > 0 && (
          <View style={styles.headshots}>
            {headshots.slice(0, 2).map((url, i) => (
              <View
                key={i}
                style={[
                  styles.headshotCircle,
                  { borderColor: c.heritageGold, backgroundColor: c.cardAlt },
                ]}
                accessibilityLabel={players[i]?.name ?? 'Player'}
              >
                <Image
                  source={{ uri: url! }}
                  style={styles.headshotImg}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                  recyclingKey={url!}
                  placeholder={PLAYER_SILHOUETTE}
                />
              </View>
            ))}
          </View>
        )}
        <ThemedText style={[styles.title, { color: c.text }]} numberOfLines={3}>
          {article.title}
        </ThemedText>
      </View>

      {/* Status badge row: return estimate + minutes restriction */}
      {hasBadgeRow && (
        <View style={styles.badgeRow}>
          {article.return_estimate && (
            <Badge
              label={article.return_estimate.toUpperCase()}
              variant={returnEstimateVariant(article.return_estimate)}
              size="small"
            />
          )}
          {article.has_minutes_restriction && (
            <Badge label="MIN RESTRICTION" variant="gold" size="small" />
          )}
        </View>
      )}

      {/* Description excerpt */}
      {article.description ? (
        <ThemedText
          style={[styles.excerpt, { color: c.secondaryText }]}
          numberOfLines={3}
        >
          {article.description}
        </ThemedText>
      ) : null}

      {/* Footer: time left, source right — varsity caps */}
      <View style={styles.footer}>
        <ThemedText
          type="varsitySmall"
          style={[styles.meta, { color: c.secondaryText }]}
        >
          {timeAgo(article.published_at)}
        </ThemedText>
        <ThemedText
          type="varsitySmall"
          style={[styles.meta, { color: c.secondaryText }]}
        >
          {sourceLabel(article.source)}
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
    gap: s(10),
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
    fontFamily: Fonts.display,
    fontSize: ms(15),
    lineHeight: ms(20),
    letterSpacing: -0.2,
    flex: 1,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: s(6),
  },
  excerpt: {
    fontSize: ms(13),
    lineHeight: ms(18),
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: s(2),
  },
  meta: {
    fontSize: ms(10),
    letterSpacing: 1.0,
  },
});
