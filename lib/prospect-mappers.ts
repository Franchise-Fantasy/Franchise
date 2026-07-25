/* ──────────────────────────────────────────────
 *  Contentful prospect entry → typed prospect props
 *  Converts raw Contentful SDK entries into the
 *  typed interfaces consumed by prospect screens.
 * ────────────────────────────────────────────── */

import type { RichTextDocument } from '@/types/cms';
import type { ProspectCardData, ProspectProfileData } from '@/types/prospect';

import { extractText } from './cms-mappers';

/** Normalise a Contentful asset URL (protocol-relative → https). */
function assetUrl(value: any): string | undefined {
  const url: string | undefined =
    typeof value === 'string' ? value : value?.fields?.file?.url;
  if (!url) return undefined;
  return url.startsWith('//') ? `https:${url}` : url;
}

/** Safely read a rich text document field. */
function richDoc(field: any): RichTextDocument | undefined {
  if (field?.nodeType === 'document') return field as RichTextDocument;
  return undefined;
}

/**
 * Map a `prospectProfile` Contentful entry to card-level data. Rank/movement/
 * currentTeam come from the Supabase prospect_board (joined on slug in the
 * hook), and playerId from the slug→players.id bridge — not from Contentful.
 */
export function mapProspectCard(entry: any): ProspectCardData {
  const f = entry?.fields ?? {};
  return {
    playerId: '', // filled by the hook via the slug→players.id bridge
    contentfulEntryId: entry?.sys?.id ?? '',
    slug: f.slug ?? '',
    name: f.name ?? '',
    position: f.position ?? '',
    school: f.school ?? '',
    classYear: f.classYear ?? undefined,
    photoUrl: assetUrl(f.photo),
    draftYear: typeof f.draftYear === 'number' ? f.draftYear : undefined,
    currentTeam: f.currentTeam ?? undefined,
    // displayRank / rankChange / lastUpdated are merged from prospect_board.
  };
}

/** Map a `prospectProfile` Contentful entry to full profile data. */
export function mapProspectProfile(entry: any): ProspectProfileData {
  const f = entry?.fields ?? {};
  const card = mapProspectCard(entry);

  return {
    ...card,
    height: f.height ?? undefined,
    weight: f.weight ?? undefined,
    hometown: f.hometown ?? undefined,
    scoutingReport: richDoc(f.scoutingReport),
    youtubeId: f.youTubeId ?? undefined,
    recentGames: [], // filled by the hook from player_last_games
  };
}

/** Extract plain text from a scouting report for the preview (free tier). */
export function scoutingReportPreview(doc: RichTextDocument | undefined, wordLimit = 30): string {
  if (!doc) return '';
  const fullText = extractText(doc);
  const words = fullText.split(/\s+/);
  if (words.length <= wordLimit) return fullText;
  return words.slice(0, wordLimit).join(' ') + '...';
}
