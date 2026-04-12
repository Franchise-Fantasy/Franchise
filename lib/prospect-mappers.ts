/* ──────────────────────────────────────────────
 *  Contentful prospect entry → typed prospect props
 *  Converts raw Contentful SDK entries into the
 *  typed interfaces consumed by prospect screens.
 * ────────────────────────────────────────────── */

import type { RichTextDocument } from '@/types/cms';
import type { LandingSpot, ProspectCardData, ProspectProfileData } from '@/types/prospect';
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

/** Map a Contentful prospect entry to card-level data. */
export function mapProspectCard(entry: any): ProspectCardData {
  const f = entry?.fields ?? {};
  return {
    playerId: '', // filled in by the hook after matching to players table
    contentfulEntryId: entry?.sys?.id ?? '',
    name: f.name ?? '',
    position: f.position ?? '',
    school: f.school ?? '',
    classYear: f.classYear ?? undefined,
    photoUrl: assetUrl(f.photo),
    dynastyValueScore: f.dynastyValueScore ?? 0,
    projectedDraftYear: f.projectedDraftYear ?? '',
    recruitingRank: f.recruitingRank ?? undefined,
    lastUpdated: f.lastUpdated ?? undefined,
  };
}

/** Map a Contentful prospect entry to full profile data. */
export function mapProspectProfile(entry: any): ProspectProfileData {
  const f = entry?.fields ?? {};
  const card = mapProspectCard(entry);

  const projectedTeams: LandingSpot[] = [];
  if (f.projectedTeam1) {
    projectedTeams.push({ team: f.projectedTeam1, odds: f.projectedTeam1Odds ?? '' });
  }
  if (f.projectedTeam2) {
    projectedTeams.push({ team: f.projectedTeam2, odds: f.projectedTeam2Odds ?? '' });
  }
  if (f.projectedTeam3) {
    projectedTeams.push({ team: f.projectedTeam3, odds: f.projectedTeam3Odds ?? '' });
  }

  return {
    ...card,
    height: f.height ?? undefined,
    weight: f.weight ?? undefined,
    hometown: f.hometown ?? undefined,
    scoutingReport: richDoc(f.scoutingReport),
    landingSpotAnalysis: richDoc(f.landingSpotAnalysis),
    projectedTeams,
    youtubeId: f.youTubeId ?? undefined,
    hudlUrl: f.hudlUrl ?? undefined,
    xEmbedUrl: f.xEmbedUrl ?? undefined,
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
