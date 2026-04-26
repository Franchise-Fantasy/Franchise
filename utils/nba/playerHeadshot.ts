import type { Sport } from '@/constants/LeagueDefaults';

// Self-hosted assets in Supabase Storage. Public read, no token required.
// Seeded once by `scripts/seed-pro-assets.mjs` and refreshed for new players
// by the `sync-headshots` edge function.
const STORAGE_BASE = 'https://iuqbossmnsezzgocpcbo.supabase.co/storage/v1/object/public';

// Bundled fallback silhouette. Used as the `placeholder` prop on every player
// Image so that (a) players without an `external_id_nba` and (b) players
// whose source CDN 404'd during seeding still render a recognizable figure
// instead of an empty circle. Regenerate via `scripts/generate-silhouette.mjs`.
export const PLAYER_SILHOUETTE = require('@/assets/images/player-silhouette.png');

/**
 * Returns the headshot URL for a player, or null if no external ID is set.
 *
 * `externalIdNba` is the column name; for WNBA players it stores the ESPN
 * athlete ID (used as the file key when seeding from ESPN's headshot CDN).
 *
 * The `size` parameter is preserved for API compatibility but ignored — we
 * store one resolution per headshot. expo-image scales as needed.
 */
export function getPlayerHeadshotUrl(
  externalIdNba: string | number | null | undefined,
  sport: Sport = 'nba',
  _size: '260x190' | '1040x760' = '260x190',
): string | null {
  if (!externalIdNba) return null;
  return `${STORAGE_BASE}/player-headshots/${sport}/${externalIdNba}.png`;
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
  return `${STORAGE_BASE}/pro-team-logos/${sport}/${proTeam}.png`;
}
