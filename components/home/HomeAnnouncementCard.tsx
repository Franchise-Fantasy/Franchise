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
  border: string;
  rail: string; // full-height accent down the card's left edge
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
        border: 'transparent',
        rail: c.gold,
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
        border: 'transparent',
        rail: c.primary,
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
        border: 'transparent',
        rail: c.gold,
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
        border: c.border,
        rail: c.gold,
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
      style={[styles.card, { backgroundColor: r.bg, borderColor: r.border }]}
      accessibilityRole={banner.type === 'urgent' ? 'alert' : 'summary'}
      accessibilityLabel={a11yLabel}
    >
      <View style={[styles.rail, { backgroundColor: r.rail }]} />

      {banner.dismissible ? (
        <TouchableOpacity
          onPress={() => onDismiss(banner.id)}
          style={styles.dismiss}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityRole="button"
          accessibilityLabel="Dismiss announcement"
        >
          <Ionicons name="close" size={ms(15)} color={r.fg} />
        </TouchableOpacity>
      ) : null}

      <View style={styles.row}>
        <View style={[styles.iconCircle, { backgroundColor: r.iconCircleBg }]}>
          <Ionicons name={r.iconName} size={ms(17)} color={r.iconColor} accessible={false} />
        </View>

        <View style={[styles.content, banner.dismissible ? styles.contentInset : null]}>
          <ThemedText
            type="sectionLabel"
            style={[styles.headline, { color: r.fg }]}
            numberOfLines={2}
          >
            {banner.headline}
          </ThemedText>
          {/* Wraps rather than clipping — CMS subtext is a full sentence and a
              1-line cap silently swallowed the back half of it. */}
          {banner.subtext ? (
            <ThemedText style={[styles.subtext, { color: r.fg }]} numberOfLines={3}>
              {banner.subtext}
            </ThemedText>
          ) : null}
          {hasCta ? (
            <TouchableOpacity
              onPress={() => onCtaPress(banner.ctaLink!)}
              style={[styles.cta, { backgroundColor: r.ctaBg }]}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityRole="link"
              accessibilityLabel={banner.ctaLabel}
            >
              <ThemedText
                type="varsitySmall"
                style={[styles.ctaText, { color: r.ctaText }]}
                numberOfLines={1}
              >
                {banner.ctaLabel}
              </ThemedText>
              <Ionicons
                name="chevron-forward"
                size={ms(10)}
                color={r.ctaText}
                accessible={false}
              />
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
    borderWidth: 1,
    paddingVertical: s(13),
    paddingRight: s(14),
    paddingLeft: s(16), // clears the rail
    overflow: 'hidden',
    ...cardShadow,
  },
  /** Full-height accent instead of a floating dash — it reads as part of the
   *  card's frame and carries the banner type at a glance. */
  rail: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: s(3),
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
    gap: s(11),
  },
  iconCircle: {
    width: s(32),
    height: s(32),
    borderRadius: s(16),
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: s(1),
  },
  content: { flex: 1 },
  contentInset: { paddingRight: s(18) }, // keeps the headline clear of the dismiss X
  headline: { fontSize: ms(16), lineHeight: ms(20) },
  subtext: { fontSize: ms(13), lineHeight: ms(18), marginTop: s(3), opacity: 0.85 },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(4),
    alignSelf: 'flex-start',
    marginTop: s(11),
    paddingHorizontal: s(11),
    paddingVertical: s(6),
    borderRadius: 999,
  },
  ctaText: { fontSize: ms(10) },
});
