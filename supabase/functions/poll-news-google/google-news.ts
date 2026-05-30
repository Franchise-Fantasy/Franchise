// Google News RSS search parsing. The endpoint is undocumented but stable:
//
//   https://news.google.com/rss/search?q=<query>&hl=en-US&gl=US&ceid=US:en
//
// Each <item> looks like:
//   <title>Article headline - Source Name</title>
//   <link>https://news.google.com/rss/articles/CBM…?oc=5</link>   → redirects
//   <guid isPermaLink="false">CBM…</guid>
//   <pubDate>Sat, 25 Apr 2026 19:32:00 GMT</pubDate>
//   <description>… HTML snippet …</description>
//   <source url="https://www.espn.com">ESPN</source>
//
// The <link> is a Google redirect — that's fine, clicking it lands on the real
// article. We dedup by guid (stable across runs). Source comes from either the
// <source> tag or the trailing " - Source" suffix in <title>.
//
// extractTag/stripHtml are the pure parsing helpers shared with poll-news.

import { extractTag, stripHtml } from '../_shared/newsText.ts';
import { lookupSource } from './sources.ts';

export interface GoogleNewsItem {
  title: string;        // Cleaned (trailing " - Source" stripped)
  link: string;         // Google News redirect URL (validated https + news.google.com)
  guid: string;         // Stable Google News article ID
  description: string;  // Always '' — Google's <description> is just the linked headline, no summary
  pubDate: string;
  source: string;       // Allowlisted display name (e.g. 'espn', 'the athletic')
}

// Google News item links are always https redirects on news.google.com. We
// validate before trusting one — the stored link is opened with Linking.openURL
// on the client, so a hostile/malformed feed item must not smuggle a
// javascript: or arbitrary-host URL through.
function isValidGoogleNewsLink(link: string): boolean {
  try {
    const u = new URL(link);
    return u.protocol === 'https:' && u.hostname === 'news.google.com';
  } catch {
    return false;
  }
}

function extractSourceAttr(xml: string): { name: string; url: string } | null {
  const m = xml.match(/<source(?:\s+url="([^"]*)")?[^>]*>([\s\S]*?)<\/source>/i);
  if (!m) return null;
  return { url: (m[1] ?? '').trim(), name: m[2].replace(/<!\[CDATA\[|\]\]>/g, '').trim() };
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

// Google News titles end with " - Source Name". Strip it; return both pieces.
function splitTitleSuffix(rawTitle: string): { title: string; trailingSource: string } {
  const idx = rawTitle.lastIndexOf(' - ');
  if (idx === -1) return { title: rawTitle, trailingSource: '' };
  return {
    title: rawTitle.slice(0, idx).trim(),
    trailingSource: rawTitle.slice(idx + 3).trim(),
  };
}

export function buildGoogleNewsUrl(playerName: string, sportTag: string, maxAgeDays: number): string {
  // Quoted player name + sport tag keeps results tight. The `when:Nd` operator
  // restricts Google News to the last N days so it can't hand back years-old
  // articles for quiet players (Google ranks by relevance, not recency, so a
  // bare query happily returns a 2018 story). ceid/hl/gl pin US English.
  const q = encodeURIComponent(`"${playerName}" ${sportTag} when:${maxAgeDays}d`);
  return `https://news.google.com/rss/search?q=${q}&hl=en-US&gl=US&ceid=US:en`;
}

export function parseGoogleNewsRss(xml: string): GoogleNewsItem[] {
  // Sanity check the feed is well-formed Google News output.
  if (!/<rss[\s>]/i.test(xml) || !/news\.google\.com/i.test(xml.slice(0, 2000))) {
    return [];
  }

  const items: GoogleNewsItem[] = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/gi;
  let match;
  while ((match = itemRe.exec(xml)) !== null) {
    const block = match[1];

    const rawTitle = stripHtml(extractTag(block, 'title'));
    const link = stripHtml(extractTag(block, 'link'));
    const guid = stripHtml(extractTag(block, 'guid')) || link;
    const pubDate = extractTag(block, 'pubDate');

    if (!rawTitle || !isValidGoogleNewsLink(link)) continue;

    // Resolve source: prefer <source> tag, fall back to title suffix.
    const sourceTag = extractSourceAttr(block);
    const { title: cleanedTitle, trailingSource } = splitTitleSuffix(rawTitle);

    const candidates = [
      sourceTag?.name,
      sourceTag?.url ? hostnameOf(sourceTag.url) : '',
      trailingSource,
    ].filter(Boolean) as string[];

    let displaySource: string | null = null;
    for (const candidate of candidates) {
      displaySource = lookupSource(candidate);
      if (displaySource) break;
    }

    // Drop articles from outlets that aren't on the allowlist.
    if (!displaySource) continue;

    items.push({
      title: cleanedTitle,
      link,
      guid,
      description: '',
      pubDate,
      source: displaySource,
    });
  }

  return items;
}
