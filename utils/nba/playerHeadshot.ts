import type { ImageStyle } from 'react-native';

import type { Sport } from '@/constants/LeagueDefaults';

// Self-hosted assets in Supabase Storage. Public read, no token required.
// Seeded once by `scripts/seed-pro-assets.mjs` and refreshed for new players
// by the `sync-headshots` edge function.
const STORAGE_BASE = 'https://iuqbossmnsezzgocpcbo.supabase.co/storage/v1';

// We deliberately DON'T use Storage's on-the-fly `/render/image` transform
// endpoint. The seed + `sync-headshots` pipeline already writes a right-sized
// 256x192 compressed PNG (~55KB), so transforming down to ~168px only shaved
// ~30KB off an already-small, on-device-cached image — while billing one
// *origin image* per player against the Pro plan's 100/month image-transform
// quota. Hundreds of players blew the quota in days. Serve the stored object
// directly; bandwidth stays fine and transform usage drops to zero.

// Bundled fallback silhouette. Used as the `placeholder` prop on every player
// Image so that (a) players without an `external_id_nba` and (b) players
// whose source CDN 404'd during seeding still render a recognizable figure
// instead of an empty circle. Regenerate via `scripts/generate-silhouette.mjs`.
export const PLAYER_SILHOUETTE = require('@/assets/images/player-silhouette.png');

// ESPN's WNBA headshot CDN frames players with noticeably more headroom
// than cdn.nba.com does, so dropped into our circle layouts (which lean the
// image to the bottom edge) the head sits a bit too low. Apply this style
// only on WNBA real headshots — not on the silhouette fallback.
export const WNBA_HEADSHOT_OFFSET: ImageStyle = {
  transform: [{ translateY: '-10%' }],
};

// NFL.com's portrait master (400x400, center-cropped to 256x192 with no face
// gravity) frames the head smaller and higher than cdn.nba.com, so in the
// bottom-anchored circles the face reads small and sits low. Scale up slightly
// and shift upward. Real NFL headshots only — not the silhouette. Tune the two
// numbers if the crop still feels off.
export const NFL_HEADSHOT_OFFSET: ImageStyle = {
  transform: [{ scale: 1.18 }, { translateY: '-8%' }],
};

// Per-sport framing correction applied to real headshots (never the silhouette).
// Sports absent from the map render with no transform.
export const HEADSHOT_OFFSETS: Partial<Record<Sport, ImageStyle>> = {
  wnba: WNBA_HEADSHOT_OFFSET,
  nfl: NFL_HEADSHOT_OFFSET,
};

/**
 * Returns the headshot URL for a player, or null if no external ID is set.
 *
 * `externalIdNba` is the column name; for WNBA players it stores the ESPN
 * athlete ID (used as the file key when seeding from ESPN's headshot CDN).
 *
 * `res` is retained for a future pre-generated small variant (`{id}_sm.png`
 * written at seed time) that would restore the bandwidth win without any
 * transform quota; today both tiers resolve to the same 256x192 stored object
 * via the plain object endpoint, so no image-transform quota is consumed.
 */
export function getPlayerHeadshotUrl(
  externalIdNba: string | number | null | undefined,
  sport: Sport = 'nba',
  res: 'sm' | 'full' = 'sm',
): string | null {
  if (!externalIdNba) return null;
  const path = `player-headshots/${sport}/${externalIdNba}.png`;
  return `${STORAGE_BASE}/object/public/${path}`;
}

/**
 * Returns the team logo URL for a tricode, or null for sentinel values.
 * All logos are PNG — NBA's source is SVG but we rasterize during seeding so
 * react-native's Image component renders them without an SVG dependency.
 */
export function getTeamLogoUrl(
  proTeam: string | null | undefined,
  sport: Sport = 'nba',
): string | null {
  if (!proTeam || proTeam === 'Active' || proTeam === 'Inactive') return null;
  return `${STORAGE_BASE}/object/public/pro-team-logos/${sport}/${proTeam}.png`;
}
