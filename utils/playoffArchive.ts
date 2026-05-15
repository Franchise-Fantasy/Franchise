import { Image } from 'expo-image';

// Resolves a logo URL for a franchise. Logo files are stored under the
// pro-team-logos bucket, namespaced by sport:
// - {sport}/{franchise_id}.png             — modern (current-era) logo
// - {sport}-historical/{era_key}.png       — period-specific historical logo
//
// `logo_key` on each *_franchise_season row is set to null when the modern
// logo applies. Otherwise it carries the era_key pointing at the historical
// PNG. Per-sport seeders maintain this invariant.

const SUPABASE_URL =
  process.env.EXPO_PUBLIC_SUPABASE_URL ?? 'https://iuqbossmnsezzgocpcbo.supabase.co';

const STORAGE_BASE = `${SUPABASE_URL}/storage/v1/object/public/pro-team-logos`;

export type ArchiveSport = 'nba' | 'nhl' | 'nfl';

export function hasHistoricalLogo(logoKey?: string | null): boolean {
  return !!logoKey;
}

export function getProLogoUrl(
  franchiseId: string,
  logoKey?: string | null,
  sport: ArchiveSport = 'nba',
): string {
  if (logoKey) {
    return `${STORAGE_BASE}/${sport}-historical/${logoKey}.png`;
  }
  return `${STORAGE_BASE}/${sport}/${franchiseId}.png`;
}

// Prefetches every logo URL referenced by a season's franchises so the first
// render after switching seasons doesn't pop in. expo-image dedupes against
// the disk cache, so calling this multiple times is cheap.
export function prefetchSeasonLogos(
  franchises: { franchise_id: string; logo_key?: string | null }[],
  sport: ArchiveSport = 'nba',
): void {
  if (franchises.length === 0) return;
  const urls = Array.from(
    new Set(
      franchises.map((f) =>
        getProLogoUrl(f.franchise_id, f.logo_key ?? null, sport),
      ),
    ),
  );
  // Fire and forget; expo-image handles failures internally.
  Image.prefetch(urls);
}
