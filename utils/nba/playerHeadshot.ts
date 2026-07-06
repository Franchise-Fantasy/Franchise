import type { ImageStyle } from 'react-native';

import type { Sport } from '@/constants/LeagueDefaults';

// Self-hosted assets in Supabase Storage. Public read, no token required.
// Seeded once by `scripts/seed-pro-assets.mjs` and refreshed for new players
// by the `sync-headshots` edge function.
const STORAGE_BASE = 'https://iuqbossmnsezzgocpcbo.supabase.co/storage/v1';

// Compact-surface render size. The vast majority of on-screen headshots are
// ~48-54px list/row/cell/chip circles; serving them through Storage's on-the-fly
// image-transform endpoint ships a ~168px thumbnail (~15KB) instead of the full
// 260px master (~60KB) — a big bandwidth win on long free-agent/roster lists.
// Keeps the master's 260:190 aspect ratio so the `cover` crop and the WNBA
// headroom offset behave identically. Large hero portraits pass res='full'.
const HEADSHOT_SM = { width: 168, height: 123 } as const;

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

/**
 * Returns the headshot URL for a player, or null if no external ID is set.
 *
 * `externalIdNba` is the column name; for WNBA players it stores the ESPN
 * athlete ID (used as the file key when seeding from ESPN's headshot CDN).
 *
 * `res` selects delivery size:
 *  - 'sm' (default) — a transformed ~168px thumbnail via Storage's render
 *    endpoint, right-sized for list rows / cells / chips / cards.
 *  - 'full' — the untransformed master (object endpoint), for the player-detail
 *    hero and other large single-player portraits.
 */
export function getPlayerHeadshotUrl(
  externalIdNba: string | number | null | undefined,
  sport: Sport = 'nba',
  res: 'sm' | 'full' = 'sm',
): string | null {
  if (!externalIdNba) return null;
  const path = `player-headshots/${sport}/${externalIdNba}.png`;
  if (res === 'full') return `${STORAGE_BASE}/object/public/${path}`;
  const { width, height } = HEADSHOT_SM;
  return `${STORAGE_BASE}/render/image/public/${path}?width=${width}&height=${height}&resize=cover&quality=80`;
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
