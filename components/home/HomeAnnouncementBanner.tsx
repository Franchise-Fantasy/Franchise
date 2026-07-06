import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, ScrollView, StyleSheet, View } from 'react-native';

import { HomeAnnouncementCard } from '@/components/home/HomeAnnouncementCard';
import { type Sport } from '@/constants/LeagueDefaults';
import { useAnnouncementBanners } from '@/hooks/useAnnouncementBanners';
import { useColors } from '@/hooks/useColors';
import { useDismissedAnnouncements } from '@/hooks/useDismissedAnnouncements';
import type { HomeAnnouncement } from '@/types/cms';
import { s } from '@/utils/scale';

const AUTO_ADVANCE_MS = 7000;

interface Props {
  sport: Sport;
  leagueType?: string | null;
  scoringType?: string | null;
}

/**
 * Homepage announcement banner surface. Fetches Contentful `alertBanner`
 * entries targeted to the current league, drops locally-dismissed ones, and
 * renders the survivor(s): a single card, or a swipeable carousel when more
 * than one is live. Renders nothing when there's nothing to show.
 */
export function HomeAnnouncementBanner({ sport, leagueType, scoringType }: Props) {
  const router = useRouter();
  const { data } = useAnnouncementBanners({ sport, leagueType, scoringType });
  const { dismissedIds, dismiss } = useDismissedAnnouncements();

  const visible = useMemo(
    () => data.filter((b) => !dismissedIds.has(b.id)),
    [data, dismissedIds],
  );

  // External (`http…`) → in-app browser. Internal path (`/…`) → in-app
  // navigation (expo-router resolves dynamic segments natively). Anything
  // else is a malformed ctaLink and is ignored, so a bad CMS value can
  // never crash or misroute the banner.
  const handleCtaPress = useCallback(
    (link: string) => {
      if (link.startsWith('http')) {
        WebBrowser.openBrowserAsync(link).catch(() => {});
      } else if (link.startsWith('/')) {
        router.push(link as never);
      }
    },
    [router],
  );

  if (visible.length === 0) return null;

  if (visible.length === 1) {
    return (
      <View style={styles.wrap}>
        <HomeAnnouncementCard banner={visible[0]} onDismiss={dismiss} onCtaPress={handleCtaPress} />
      </View>
    );
  }

  return (
    <AnnouncementCarousel banners={visible} onDismiss={dismiss} onCtaPress={handleCtaPress} />
  );
}

interface CarouselProps {
  banners: HomeAnnouncement[];
  onDismiss: (id: string) => void;
  onCtaPress: (link: string) => void;
}

function AnnouncementCarousel({ banners, onDismiss, onCtaPress }: CarouselProps) {
  const c = useColors();
  const [width, setWidth] = useState(0);
  const [index, setIndex] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  const reduceMotion = useRef(false);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => {
        reduceMotion.current = v;
      })
      .catch(() => {});
  }, []);

  // Keep the active index valid when the list shrinks (a banner was dismissed).
  useEffect(() => {
    if (index > banners.length - 1) {
      const next = Math.max(0, banners.length - 1);
      setIndex(next);
      if (width > 0) scrollRef.current?.scrollTo({ x: next * width, animated: false });
    }
  }, [banners.length, index, width]);

  // Gentle auto-advance — skipped when the OS reduce-motion setting is on.
  useEffect(() => {
    if (banners.length <= 1 || width === 0) return;
    const id = setInterval(() => {
      if (reduceMotion.current) return;
      setIndex((prev) => {
        const next = (prev + 1) % banners.length;
        scrollRef.current?.scrollTo({ x: next * width, animated: true });
        return next;
      });
    }, AUTO_ADVANCE_MS);
    return () => clearInterval(id);
  }, [banners.length, width]);

  return (
    <View style={styles.wrap} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) => {
          if (width > 0) setIndex(Math.round(e.nativeEvent.contentOffset.x / width));
        }}
      >
        {banners.map((b) => (
          <View key={b.id} style={{ width }}>
            <HomeAnnouncementCard banner={b} onDismiss={onDismiss} onCtaPress={onCtaPress} />
          </View>
        ))}
      </ScrollView>
      <View
        style={styles.dots}
        accessibilityLabel={`Banner ${index + 1} of ${banners.length}`}
      >
        {banners.map((b, i) => (
          <View
            key={b.id}
            style={[styles.dot, { backgroundColor: i === index ? c.accent : c.border }]}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: s(16) },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: s(5),
    marginTop: s(8),
  },
  dot: { width: s(6), height: s(6), borderRadius: s(3) },
});
