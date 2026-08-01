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
  /** Shown in place of the silhouette when there's no storage headshot (or it
   *  failed to load) — rookie-draft prospects pass their Contentful scouting
   *  photo here, since they have no external_id_nba until they turn pro. */
  fallbackUri?: string;
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
  fallbackUri,
}: Props) {
  const url = getPlayerHeadshotUrl(externalIdNba, sport, res);
  const [failed, setFailed] = useState(false);
  const [fallbackFailed, setFallbackFailed] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const attemptsRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset retry state whenever the URLs change — handles recycled list rows
  // landing on a different player as well as prop changes on the same row.
  useEffect(() => {
    attemptsRef.current = 0;
    setFailed(false);
    setFallbackFailed(false);
    setRetryNonce(0);
    return () => {
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };
  }, [url, fallbackUri]);

  const showHeadshot = !!url && !failed;
  // No storage headshot → the caller's fallback photo (prospect scouting shot)
  // before the silhouette. One shot, no retry — the silhouette placeholder is
  // already showing underneath, so a failed fallback just stays there.
  const showFallback = !showHeadshot && !!fallbackUri && !fallbackFailed;
  const activeUri = showHeadshot ? url : showFallback ? fallbackUri : null;

  const handleError = useCallback(() => {
    if (showHeadshot) {
      if (attemptsRef.current === 0) {
        attemptsRef.current = 1;
        retryTimerRef.current = setTimeout(() => {
          retryTimerRef.current = null;
          setRetryNonce((n) => n + 1);
        }, RETRY_DELAY_MS);
      } else {
        setFailed(true);
      }
    } else {
      setFallbackFailed(true);
    }
  }, [showHeadshot]);

  return (
    <Image
      key={`${activeUri ?? 'silhouette'}-${retryNonce}`}
      source={activeUri ? { uri: activeUri } : PLAYER_SILHOUETTE}
      // The sport-specific crop offset compensates for the storage source's
      // framing — a Contentful fallback photo is framed on its own terms.
      style={[style, showHeadshot && HEADSHOT_OFFSETS[sport]]}
      contentFit={activeUri ? contentFit : 'contain'}
      cachePolicy="memory-disk"
      recyclingKey={activeUri ?? 'silhouette'}
      placeholder={PLAYER_SILHOUETTE}
      placeholderContentFit="contain"
      onError={activeUri ? handleError : undefined}
      transition={250}
      accessible={accessible}
    />
  );
}
