import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, TouchableOpacity, View } from 'react-native';

import { ThemedText } from '@/components/ui/ThemedText';
import { Brand, cardShadow } from '@/constants/Colors';
import { useColors } from '@/hooks/useColors';
import type { AnnouncementType, HomeAnnouncement } from '@/types/cms';
import { ms, s } from '@/utils/scale';

type Colors = ReturnType<typeof useColors>;

interface RoleStyle {
  bg: string;
  fg: string; // headline + subtext + dismiss
  accent: string; // top-left accent bar
  iconName: keyof typeof Ionicons.glyphMap;
  iconColor: string;
  iconCircleBg: string;
  ctaBg: string;
  ctaText: string;
}

/**
 * Resolve the 4 banner types to concrete colors from the sport-aware palette
 * (`useColors()`), so banners stay in lockstep with the rest of the app's
 * theming — WNBA merlot vs NBA green, light vs dark — instead of a hardcoded
 * per-sport table. Only the "feature" accent is a dedicated token.
 */
function roleStyle(c: Colors, type: AnnouncementType): RoleStyle {
  switch (type) {
    case 'urgent':
      return {
        bg: c.primary,
        fg: c.onPrimary,
        accent: c.gold,
        iconName: 'warning',
        iconColor: c.gold,
        iconCircleBg: 'rgba(0,0,0,0.18)',
        ctaBg: c.gold,
        ctaText: Brand.ink,
      };
    case 'promo':
      return {
        bg: c.gold,
        fg: c.primary,
        accent: c.primary,
        iconName: 'pricetag',
        iconColor: c.primary,
        iconCircleBg: 'rgba(0,0,0,0.10)',
        ctaBg: c.primary,
        ctaText: c.onPrimary,
      };
    case 'feature':
      return {
        bg: c.bannerFeature,
        fg: c.bannerFeatureText,
        accent: c.gold,
        iconName: 'sparkles',
        iconColor: c.bannerFeatureText,
        iconCircleBg: 'rgba(0,0,0,0.15)',
        ctaBg: c.primary,
        ctaText: c.onPrimary,
      };
    case 'info':
    default:
      return {
        bg: c.cardAlt,
        fg: c.text,
        accent: c.gold,
        iconName: 'information-circle',
        iconColor: c.primary,
        iconCircleBg: c.goldMuted,
        ctaBg: c.gold,
        ctaText: Brand.ink,
      };
  }
}

interface Props {
  banner: HomeAnnouncement;
  onDismiss: (id: string) => void;
  onCtaPress: (link: string) => void;
}

export function HomeAnnouncementCard({ banner, onDismiss, onCtaPress }: Props) {
  const c = useColors();
  const r = roleStyle(c, banner.type);
  const hasCta = !!(banner.ctaLabel && banner.ctaLink);
  const a11yLabel = banner.subtext
    ? `${banner.headline}. ${banner.subtext}`
    : banner.headline;

  return (
    <View
      style={[styles.card, { backgroundColor: r.bg }]}
      accessibilityRole={banner.type === 'urgent' ? 'alert' : 'summary'}
      accessibilityLabel={a11yLabel}
    >
      <View style={[styles.accentBar, { backgroundColor: r.accent }]} />

      {banner.dismissible ? (
        <TouchableOpacity
          onPress={() => onDismiss(banner.id)}
          style={styles.dismiss}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityRole="button"
          accessibilityLabel="Dismiss announcement"
        >
          <Ionicons name="close" size={ms(16)} color={r.fg} />
        </TouchableOpacity>
      ) : null}

      <View style={styles.row}>
        <View style={[styles.iconCircle, { backgroundColor: r.iconCircleBg }]}>
          <Ionicons name={r.iconName} size={ms(20)} color={r.iconColor} accessible={false} />
        </View>

        <View style={styles.content}>
          <ThemedText
            type="defaultSemiBold"
            style={[styles.headline, { color: r.fg }]}
            numberOfLines={2}
          >
            {banner.headline}
          </ThemedText>
          {banner.subtext ? (
            <ThemedText style={[styles.subtext, { color: r.fg }]} numberOfLines={1}>
              {banner.subtext}
            </ThemedText>
          ) : null}
          {hasCta ? (
            <TouchableOpacity
              onPress={() => onCtaPress(banner.ctaLink!)}
              style={[styles.cta, { backgroundColor: r.ctaBg }]}
              accessibilityRole="link"
              accessibilityLabel={banner.ctaLabel}
            >
              <ThemedText type="defaultSemiBold" style={[styles.ctaText, { color: r.ctaText }]}>
                {banner.ctaLabel}
              </ThemedText>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    paddingTop: s(18),
    paddingBottom: s(14),
    paddingHorizontal: s(14),
    overflow: 'hidden',
    ...cardShadow,
  },
  accentBar: {
    position: 'absolute',
    top: s(12),
    left: s(14),
    width: s(28),
    height: s(4),
    borderRadius: 2,
  },
  dismiss: {
    position: 'absolute',
    top: s(8),
    right: s(8),
    padding: s(4),
    zIndex: 2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: s(12),
  },
  iconCircle: {
    width: s(40),
    height: s(40),
    borderRadius: s(20),
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    flex: 1,
    paddingRight: s(20), // keep the headline clear of the dismiss X
  },
  headline: { fontSize: ms(15), lineHeight: ms(20) },
  subtext: { fontSize: ms(13), lineHeight: ms(18), marginTop: s(2), opacity: 0.9 },
  cta: {
    alignSelf: 'flex-start',
    marginTop: s(10),
    paddingHorizontal: s(14),
    paddingVertical: s(7),
    borderRadius: 999,
  },
  ctaText: { fontSize: ms(13) },
});
