// RotoWire HTML news-list parser.
//
// Why this exists: RotoWire's RSS feed (rss/news.php?sport=NBA) only ever holds
// the latest 5 items. After a game, RotoWire publishes a whole team's worth of
// recap + injury blurbs within a couple of minutes — far more than 5 — so the
// burst overflows the RSS window and the older items fall out before our next
// poll. We permanently lose the tail, and because the window drops by RECENCY
// (not importance), real injury/availability news ("exits to locker room",
// "ruled out") gets dropped alongside box-score filler. An audit of May–June
// 2026 found we were capturing only ~44% of RotoWire's NBA blurbs this way.
//
// The HTML news page (/basketball/news.php) lists ~25 items — deep enough that a
// post-game burst never overflows between our once-a-minute polls.
//
// Returned items use the SAME shape and the SAME `guid` scheme as the RSS parser
// ('nba' + the trailing article id on the headline URL), so external_id dedup
// makes an item indistinguishable whether it arrived via RSS or HTML. The caller
// seeds its dedup set from the RSS items first, so RSS still wins on overlap —
// the RSS feed carries a precise publish time, whereas this list is date-only.
//
// Pure module (imports only the dependency-free newsText helpers) so the regex
// parsing is unit-testable in jest — see __tests__/newsText.test.ts siblings.

import { stripHtml } from '../_shared/newsText.ts';

export interface RotowireNewsItem {
  title: string;
  link: string;
  guid: string;
  description: string;
  pubDate: string;
  source: string;
}

const ROTOWIRE_ORIGIN = 'https://www.rotowire.com';

// Headline anchors are same-origin relative paths ("/basketball/headlines/…").
// Resolve against the origin and reject anything that isn't https on rotowire.com
// — protocol-relative ("//evil.com"), javascript:, or off-site absolute URLs — so
// a compromised/malformed page can't smuggle a hostile link into Linking.openURL
// on the client. Mirrors isValidGoogleNewsLink in poll-news-google/google-news.ts.
function toSafeRotowireUrl(href: string): string | null {
  try {
    const u = new URL(href, ROTOWIRE_ORIGIN);
    if (u.protocol !== 'https:') return null;
    if (u.hostname !== 'www.rotowire.com' && u.hostname !== 'rotowire.com') return null;
    return u.toString();
  } catch {
    return null;
  }
}

export function parseRotowireNewsHtml(html: string, source: string): RotowireNewsItem[] {
  const items: RotowireNewsItem[] = [];

  // Each news card opens with `<div class="news-update">` (optionally with a
  // state modifier like ` is-injured`). Inner elements use the `news-update__*`
  // double-underscore namespace, so requiring a `"` or ` is-…` immediately after
  // `news-update` keeps this split on the top-level card boundary only.
  const blocks = html.split(/<div class="news-update(?: is-[a-z-]+)?">/i).slice(1);

  for (const block of blocks) {
    const headline = block.match(
      /class="news-update__headline"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i,
    );
    const playerLink = block.match(
      /class="news-update__player-link"[^>]*href="[^"]*"[^>]*>([\s\S]*?)<\/a>/i,
    );
    if (!headline || !playerLink) continue;

    const headlineText = stripHtml(headline[2]);
    const playerName = stripHtml(playerLink[1]);
    if (!playerName || !headlineText) continue;

    const link = toSafeRotowireUrl(headline[1]);
    if (!link) continue;

    // The trailing `-<id>` on the headline URL is RotoWire's per-article id.
    // Reuse the RSS `nba<id>` guid scheme so external_id matches across sources.
    const idMatch = link.match(/-(\d+)\/?$/);
    if (!idMatch) continue;
    const guid = `nba${idMatch[1]}`;

    // `news-update__news` is the real blurb body. `news-update__analysis` is the
    // paywalled "Subscribe now" take — deliberately ignored.
    const newsBody = block.match(/class="news-update__news"[^>]*>([\s\S]*?)<\/div>/i);
    const description = newsBody ? stripHtml(newsBody[1]) : '';

    // The list view is date-only ("June 4, 2026") — no time of day. `new Date()`
    // in insertNewsArticle parses it to UTC midnight; the RSS feed supplies the
    // precise time for the freshest items, so this only affects the older tail.
    const timestamp = block.match(/class="news-update__timestamp"[^>]*>([\s\S]*?)<\/div>/i);
    const pubDate = timestamp ? stripHtml(timestamp[1]) : '';

    // Reconstruct the RSS-style "Player Name: Headline" title for parity.
    items.push({
      title: `${playerName}: ${headlineText}`,
      link,
      guid,
      description,
      pubDate,
      source,
    });
  }

  return items;
}
