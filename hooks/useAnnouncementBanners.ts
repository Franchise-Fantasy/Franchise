import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { SPORT_DISPLAY, type Sport } from '@/constants/LeagueDefaults';
import { queryKeys } from '@/constants/queryKeys';
import { mapAlertBanner } from '@/lib/cms-mappers';
import { contentful } from '@/lib/contentful';
import type { HomeAnnouncement } from '@/types/cms';

interface Args {
  sport: Sport;
  leagueType?: string | null;
  scoringType?: string | null;
}

/**
 * The Contentful `leagueFormat` targeting enum is ['Dynasty','Redraft','CAT','ALL'].
 * The app splits that across two league columns, so translate the current
 * league into the set of format tokens it satisfies:
 *   - league_type dynasty|keeper → 'Dynasty' (keeper is dynasty-adjacent; no
 *     dedicated Keeper token exists in the CMS enum)
 *   - league_type redraft        → 'Redraft'
 *   - scoring_type h2h_categories → 'CAT'
 *   - points scoring has no token — a points league matches only via its
 *     league_type token or 'ALL'.
 */
function leagueFormatTokens(
  leagueType?: string | null,
  scoringType?: string | null,
): string[] {
  const tokens: string[] = [];
  if (leagueType === 'dynasty' || leagueType === 'keeper') tokens.push('Dynasty');
  if (leagueType === 'redraft') tokens.push('Redraft');
  if (scoringType === 'h2h_categories') tokens.push('CAT');
  return tokens;
}

/** A banner with no targeting on a dimension shows everywhere on that dimension. */
function matchesTarget(bannerValues: string[], leagueValues: string[]): boolean {
  if (bannerValues.length === 0) return true;
  if (bannerValues.includes('ALL')) return true;
  return bannerValues.some((v) => leagueValues.includes(v));
}

/**
 * Homepage announcement banners from Contentful (`alertBanner`), filtered to
 * the ones live for the current league right now: active + inside the date
 * window + audience/format targeting. Sorted by priority (desc) server-side.
 * Mirrors the useProspects Contentful pattern (direct client fetch, cached).
 */
export function useAnnouncementBanners({ sport, leagueType, scoringType }: Args) {
  const query = useQuery<HomeAnnouncement[]>({
    queryKey: queryKeys.announcementBanners(sport),
    queryFn: async () => {
      const res = await contentful.getEntries({
        content_type: 'alertBanner',
        'fields.active': true,
        order: ['-fields.priority'],
        limit: 20,
      });
      return res.items.map(mapAlertBanner);
    },
    staleTime: 1000 * 60 * 5,
  });

  const data = useMemo(() => {
    const all = query.data ?? [];
    const now = Date.now();
    const sportDisplay = SPORT_DISPLAY[sport];
    const formatTokens = leagueFormatTokens(leagueType, scoringType);

    return all.filter((b) => {
      const startOk = !b.startDate || Date.parse(b.startDate) <= now;
      const endOk = !b.endDate || Date.parse(b.endDate) >= now;
      if (!startOk || !endOk) return false;
      if (!matchesTarget(b.audience, [sportDisplay])) return false;
      if (!matchesTarget(b.leagueFormat, formatTokens)) return false;
      return true;
    });
  }, [query.data, sport, leagueType, scoringType]);

  return { data, isLoading: query.isLoading, error: query.error };
}
