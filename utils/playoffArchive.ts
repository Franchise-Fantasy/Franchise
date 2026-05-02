import { Image } from 'expo-image';

// Resolves a logo URL for a franchise. Logo files are stored in two places:
// - nba/{franchise_id}.png        — modern (current-era) logo
// - nba-historical/{era_key}.png  — period-specific historical logo
//
// `logo_key` on each franchise_season row is set to null when the modern
// logo applies (current-era seasons, or a historical era whose look is
// indistinguishable from the modern logo). Otherwise it carries the era_key
// pointing at the historical PNG. The importer maintains this invariant
// from logo-eras.json — every era with an `era_key` field has a real file
// in nba-historical/ via seed-pro-historical-logos.mjs.

const SUPABASE_URL =
  process.env.EXPO_PUBLIC_SUPABASE_URL ?? 'https://iuqbossmnsezzgocpcbo.supabase.co';

const STORAGE_BASE = `${SUPABASE_URL}/storage/v1/object/public/pro-team-logos`;

export function hasHistoricalLogo(logoKey?: string | null): boolean {
  return !!logoKey;
}

export function getProLogoUrl(
  franchiseId: string,
  logoKey?: string | null,
): string {
  if (logoKey) {
    return `${STORAGE_BASE}/nba-historical/${logoKey}.png`;
  }
  return `${STORAGE_BASE}/nba/${franchiseId}.png`;
}

// Prefetches every logo URL referenced by a season's franchises so the first
// render after switching seasons doesn't pop in. expo-image dedupes against
// the disk cache, so calling this multiple times is cheap.
export function prefetchSeasonLogos(
  franchises: { franchise_id: string; logo_key?: string | null }[],
): void {
  if (franchises.length === 0) return;
  const urls = Array.from(
    new Set(
      franchises.map((f) => getProLogoUrl(f.franchise_id, f.logo_key ?? null)),
    ),
  );
  // Fire and forget; expo-image handles failures internally.
  Image.prefetch(urls);
}
