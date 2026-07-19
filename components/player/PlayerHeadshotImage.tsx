import { Image, type ImageContentFit } from 'expo-image';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ImageStyle, StyleProp } from 'react-native';

import type { Sport } from '@/constants/LeagueDefaults';
import { getPlayerHeadshotUrl, HEADSHOT_OFFSETS, PLAYER_SILHOUETTE } from '@/utils/nba/playerHeadshot';

type Props = {
  externalIdNba: string | number | null | undefined;
  sport: Sport;
  style: StyleProp<ImageStyle>;
  /** Real-headshot fit. Silhouette always uses 'contain' so its small
   *  centered figure isn't cropped by the circle. */
  contentFit?: ImageContentFit;
  accessible?: boolean;
  /** Delivery size: 'sm' (default) serves a right-sized transform for list/row/
   *  cell surfaces; 'full' serves the untransformed master for large heroes. */
  res?: 'sm' | 'full';
};

// Single retry after a transient image-fetch failure. Mobile networks
// drop frames often enough that a one-and-done error hides real headshots
// for well-known players (saw it with SGA). One retry catches the blip
// without thrashing on genuinely missing assets.
const RETRY_DELAY_MS = 1500;

// Centralizes player-headshot rendering. Concerns the inline pattern kept
// getting wrong: (1) silhouette fallback needs `contain` so the figure isn't
// zoomed/cropped, (2) WNBA's ESPN source has extra headroom and needs a small
// upward shift, (3) when the URL exists but storage 404s, we need an explicit
// onError fallback to the silhouette — expo-image's placeholder alone doesn't
// survive a load failure, (4) one transient failure shouldn't permanently
// silhouette the player for the rest of the mount, so we retry once before
// giving up.
export function PlayerHeadshotImage({
  externalIdNba,
  sport,
  style,
  contentFit = 'cover',
  accessible,
  res = 'sm',
}: Props) {
  const url = getPlayerHeadshotUrl(externalIdNba, sport, res);
  const [failed, setFailed] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const attemptsRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset retry state whenever the URL changes — handles recycled list rows
  // landing on a different player as well as prop changes on the same row.
  useEffect(() => {
    attemptsRef.current = 0;
    setFailed(false);
    setRetryNonce(0);
    return () => {
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };
  }, [url]);

  const showHeadshot = !!url && !failed;

  const handleError = useCallback(() => {
    if (!url) return;
    if (attemptsRef.current === 0) {
      attemptsRef.current = 1;
      retryTimerRef.current = setTimeout(() => {
        retryTimerRef.current = null;
        setRetryNonce((n) => n + 1);
      }, RETRY_DELAY_MS);
    } else {
      setFailed(true);
    }
  }, [url]);

  return (
    <Image
      key={`${url ?? 'silhouette'}-${retryNonce}`}
      source={showHeadshot ? { uri: url } : PLAYER_SILHOUETTE}
      style={[style, showHeadshot && HEADSHOT_OFFSETS[sport]]}
      contentFit={showHeadshot ? contentFit : 'contain'}
      cachePolicy="memory-disk"
      recyclingKey={url ?? 'silhouette'}
      placeholder={PLAYER_SILHOUETTE}
      placeholderContentFit="contain"
      onError={showHeadshot ? handleError : undefined}
      transition={250}
      accessible={accessible}
    />
  );
}
