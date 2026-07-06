/* ──────────────────────────────────────────────
 *  Contentful entry → typed CMS card props
 *  Converts raw Contentful SDK entries into the
 *  typed interfaces consumed by components/cms/*.
 * ────────────────────────────────────────────── */

import type {
  AnnouncementBannerProps,
  AnnouncementType,
  ArticleCardProps,
  CmsMappedEntry,
  HomeAnnouncement,
  PollCardProps,
  RichTextDocument,
  SpotlightCardProps,
  TipCardProps,
} from '@/types/cms';

const ANNOUNCEMENT_TYPES: AnnouncementType[] = ['info', 'urgent', 'promo', 'feature'];

// ── Helpers ────────────────────────────────────

/** Recursively extract plain text from a Contentful rich text node tree. */
export function extractText(node: any): string {
  if (typeof node === 'string') return node;
  if (node?.nodeType === 'text') return node.value ?? '';
  if (Array.isArray(node?.content)) return node.content.map(extractText).join('');
  return '';
}

/** Normalise a Contentful asset URL (protocol-relative → https). */
function assetUrl(value: any): string | undefined {
  const url: string | undefined =
    typeof value === 'string' ? value : value?.fields?.file?.url;
  if (!url) return undefined;
  return url.startsWith('//') ? `https:${url}` : url;
}

/** Truncate text to a max character count, adding ellipsis. */
function truncate(text: string, max = 120): string {
  if (text.length <= max) return text;
  return text.slice(0, max).trimEnd() + '…';
}

/** Safely read a rich text document field. */
function richDoc(field: any): RichTextDocument | undefined {
  if (field?.nodeType === 'document') return field as RichTextDocument;
  return undefined;
}

// ── Per-type mappers ───────────────────────────

export function mapArticle(fields: Record<string, any>): ArticleCardProps {
  const bodyText = extractText(fields.body);
  return {
    title: fields.title ?? '',
    heroImageUrl: assetUrl(fields.image),
    bodyExcerpt: truncate(bodyText || extractText(fields.description) || ''),
    bodyDocument: richDoc(fields.body),
    videoUrl: assetUrl(fields.video),
    author: fields.author ?? undefined,
    category: fields.category ?? undefined,
    publishedDate: fields.publishedDate ?? undefined,
  };
}

export function mapAnnouncement(fields: Record<string, any>): AnnouncementBannerProps {
  const bodyText = extractText(fields.body);
  const severity = ['info', 'warning', 'urgent'].includes(fields.severity)
    ? (fields.severity as 'info' | 'warning' | 'urgent')
    : 'info';
  return {
    title: fields.title ?? '',
    bodyExcerpt: truncate(bodyText),
    bodyDocument: richDoc(fields.body),
    severity,
    pinned: fields.pinned === true,
  };
}

export function mapSpotlight(fields: Record<string, any>): SpotlightCardProps {
  const bodyText = extractText(fields.body);
  return {
    title: fields.title ?? '',
    playerName: fields.playerName ?? '',
    headshotUrl: assetUrl(fields.headshot),
    bodyExcerpt: truncate(bodyText),
    bodyDocument: richDoc(fields.body),
    statCallout: fields.statCallout ?? undefined,
  };
}

export function mapTip(fields: Record<string, any>): TipCardProps {
  const bodyText = typeof fields.body === 'string' ? fields.body : extractText(fields.body);
  return {
    title: fields.title ?? '',
    body: truncate(bodyText, 200),
    category: fields.category ?? undefined,
    iconName: fields.icon ?? undefined,
  };
}

/**
 * Map a Contentful `alertBanner` entry → homepage announcement.
 * Takes the FULL entry (not just fields) so the sys.id survives as the
 * per-device dismissal key. `type` is normalised defensively because
 * Contentful does not enforce an enum on that field — an unrecognised
 * value falls back to `info`.
 */
export function mapAlertBanner(entry: any): HomeAnnouncement {
  const f: Record<string, any> = entry?.fields ?? {};
  const rawType = String(f.type ?? '').toLowerCase();
  const type: AnnouncementType = (ANNOUNCEMENT_TYPES as string[]).includes(rawType)
    ? (rawType as AnnouncementType)
    : 'info';
  const toStringArray = (v: any): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

  return {
    id: entry?.sys?.id ?? '',
    type,
    headline: f.headline ?? '',
    subtext: f.subtext || undefined,
    ctaLabel: f.ctaLabel || undefined,
    ctaLink: f.ctaLink || undefined,
    dismissible: f.dismissible === true,
    priority: typeof f.priority === 'number' ? f.priority : 0,
    audience: toStringArray(f.audience),
    leagueFormat: toStringArray(f.leagueFormat),
    startDate: f.startDate ?? '',
    endDate: f.endDate || undefined,
  };
}

export function mapPoll(fields: Record<string, any>): PollCardProps {
  let options: string[] = [];
  if (Array.isArray(fields.options)) {
    options = fields.options.map((o: any) =>
      typeof o === 'string' ? o : o?.fields?.title ?? o?.fields?.name ?? String(o),
    );
  }
  return {
    question: fields.question ?? fields.title ?? '',
    options,
    expiryDate: fields.expiryDate ?? undefined,
  };
}

// ── Dispatcher ─────────────────────────────────

/**
 * Convert a raw Contentful entry into a typed CMS card payload.
 * Returns `{ type, props }` — the type string selects which
 * component to render, and props are ready to spread onto it.
 *
 * Content-type IDs must match your Contentful space.
 * Update the switch cases if your IDs differ.
 */
export function mapEntry(entry: any): CmsMappedEntry {
  const contentTypeId: string = entry?.sys?.contentType?.sys?.id ?? '';
  const fields: Record<string, any> = entry?.fields ?? {};

  switch (contentTypeId) {
    case 'articleWithImage':
      return { type: 'article', props: mapArticle(fields) };
    case 'text':
      return { type: 'article', props: mapArticle(fields) };
    case 'videoContent':
      return { type: 'article', props: mapArticle(fields) };
    case 'announcement':
      return { type: 'announcement', props: mapAnnouncement(fields) };
    case 'alertBanner':
      return { type: 'alertBanner', props: mapAlertBanner(entry) };
    case 'playerSpotlight':
      return { type: 'playerSpotlight', props: mapSpotlight(fields) };
    case 'quickTip':
      return { type: 'quickTip', props: mapTip(fields) };
    case 'poll':
      return { type: 'poll', props: mapPoll(fields) };
    default:
      return { type: 'unknown', props: null };
  }
}
