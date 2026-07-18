import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { Sport } from '../_shared/bdl.ts';
import { CORS_HEADERS } from '../_shared/cors.ts';
import { recordHeartbeat } from '../_shared/heartbeat.ts';
import { handleError, jsonResponse, errorResponse } from '../_shared/http.ts';
import {
  buildPlayerNameIndex,
  extractTag,
  insertNewsArticle,
  notifyRosteredPlayerNews,
  stripHtml,
} from '../_shared/news-extract.ts';
import { hashExternalId, matchPlayersInText } from '../_shared/newsText.ts';
import { normalizeName } from '../_shared/normalize.ts';
import { fetchWithRetry } from '../_shared/retry.ts';
import { parseBody, z } from '../_shared/validate.ts';
import { parseRotowireNewsHtml } from './rotowire-html.ts';

const Body = z.object({
  sport: z.enum(['nba', 'wnba', 'nfl']).optional(),
});

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SB_SECRET_KEY")!,
);

// External ids we've already decided NOT to insert (HTML-page minors/G-League
// blurbs that fail requireMatch, items with unparseable dates). They never
// land in player_news, so the duplicate pre-check below can't filter them —
// without this cache every such blurb would force the full player-table load
// on every tick for as long as it stays on RotoWire's news page. Module scope
// = warm-isolate lifetime; a cold start pays one full pass, then re-learns.
const rejectedExternalIds = new Set<string>();
const REJECTED_CACHE_MAX = 1000;

function rememberRejected(id: string) {
  rejectedExternalIds.add(id);
  if (rejectedExternalIds.size > REJECTED_CACHE_MAX) {
    // Sets iterate in insertion order — drop the oldest half.
    let toDrop = REJECTED_CACHE_MAX / 2;
    for (const v of rejectedExternalIds) {
      rejectedExternalIds.delete(v);
      if (--toDrop <= 0) break;
    }
  }
}

// RotoWire is the PRIMARY, preferred player-news source — curated, fantasy-
// focused, and polled every minute. poll-news-google only fills coverage gaps
// for players RotoWire hasn't touched recently.
//
// `expectedChannelTag` is matched against the feed's <title> as a guard against
// Rotowire 301'ing an unrecognized sport param to the generic /rss/news.php feed
// (which during NFL Draft season streams football items). Drop items if the
// channel title doesn't include the tag — auto-recovers if RotoWire reactivates
// the endpoint.
const RSS_FEEDS_BY_SPORT: Record<Sport, { url: string; source: string; expectedChannelTag: string }[]> = {
  nba: [
    { url: 'https://www.rotowire.com/rss/news.php?sport=NBA', source: 'rotowire', expectedChannelTag: 'NBA' },
  ],
  wnba: [
    { url: 'https://www.rotowire.com/rss/news.php?sport=WNBA', source: 'rotowire', expectedChannelTag: 'WNBA' },
  ],
  nfl: [
    { url: 'https://www.rotowire.com/rss/news.php?sport=NFL', source: 'rotowire', expectedChannelTag: 'NFL' },
  ],
};

// The RSS feed only holds the latest 5 items, so a post-game burst overflows it
// and we lose the tail (including real injury news — the window drops by recency,
// not importance). RotoWire's HTML news page lists ~25 items: deep enough that
// the burst never overflows between our once-a-minute polls. HTML items are
// inserted with requireMatch=true so the shared NBA player index scopes out the
// G-League / euro / minors blurbs that also live on the basketball news page.
// NFL needs the HTML page even more than the NBA does: a Sunday slate dumps
// dozens of blurbs in minutes, so a 5-item RSS window overflows almost
// immediately. WNBA stays RSS-only until its news-page URL/markup is confirmed
// (lower volume there, so the 5-item cap rarely bites).
const HTML_NEWS_BY_SPORT: Partial<Record<Sport, { url: string; source: string }>> = {
  nba: { url: 'https://www.rotowire.com/basketball/news.php', source: 'rotowire' },
  nfl: { url: 'https://www.rotowire.com/football/news.php', source: 'rotowire' },
};

// ── RSS Parsing ────────────────────────────────

interface RssItem {
  title: string;
  link: string;
  guid: string;
  description: string;
  pubDate: string;
  source: string;
}

function parseRssFeed(xml: string, source: string, expectedChannelTag: string): RssItem[] {
  // Channel title sits in the <channel><title> wrapper, e.g.
  // "RotoWire.com Latest NBA News". If it doesn't include the expected tag,
  // we were redirected to a different sport's feed — drop everything.
  const channelTitleMatch = xml.match(/<channel>[\s\S]*?<title[^>]*>([\s\S]*?)<\/title>/i);
  const channelTitle = channelTitleMatch ? stripHtml(channelTitleMatch[1]) : '';
  if (!new RegExp(`\\b${expectedChannelTag}\\b`, 'i').test(channelTitle)) {
    console.warn(`Feed ${source} channel title "${channelTitle}" missing tag "${expectedChannelTag}" — skipping`);
    return [];
  }

  const items: RssItem[] = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/gi;
  let match;
  while ((match = itemRe.exec(xml)) !== null) {
    const block = match[1];
    const title = stripHtml(extractTag(block, 'title'));
    const link = stripHtml(extractTag(block, 'link'));
    // RotoWire's <link> is the player page URL — identical across every article
    // for the same player. <guid> (e.g. "nba529909") is unique per article and
    // is what we hash for external_id. Fall back to link only if guid is absent.
    const guid = stripHtml(extractTag(block, 'guid')) || link;
    const description = stripHtml(extractTag(block, 'description'))
      .replace(/\s*Visit RotoWire\.com for more analysis on this update\.?/i, '')
      .trim();
    const pubDate = extractTag(block, 'pubDate');
    if (title && link) {
      items.push({ title, link, guid, description, pubDate, source });
    }
  }
  return items;
}

// ── Main Handler ───────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  // Cron-only: check CRON_SECRET
  const cronSecret = Deno.env.get('CRON_SECRET');
  const authHeader = req.headers.get('Authorization');
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return errorResponse('Unauthorized', 401);
  }

  // Sport from request body. Defaults to 'nba' so legacy cron entries keep working.
  let sport: Sport = 'nba';
  try {
    const parsed = parseBody(Body, await req.json());
    // Assign whatever the (validated) body says. This used to be a hand-rolled
    // `if (parsed.sport === 'wnba')`, which silently ran EVERY nfl call as NBA
    // even after the Zod enum was widened — the same trap that bit poll-injuries.
    if (parsed.sport) sport = parsed.sport;
  } catch {
    // No body / not JSON — default sport stays 'nba'.
  }
  const RSS_FEEDS = RSS_FEEDS_BY_SPORT[sport];

  try {
    // 1. Fetch the RSS feed. The RSS feed only holds ~5 items, and rounds
    //    exist purely to beat that cap between once-a-minute polls. Sports
    //    with an HTML news list (step 1b, ~25 items) get their overflow depth
    //    from it, so a single RSS round suffices — the second round was a
    //    15-second sleep holding an edge worker every tick (the source of
    //    poll-news's 16s execution times and the pg_net 5s wait-timeouts).
    //    WNBA has no confirmed HTML page yet, so it keeps two rounds.
    const POLL_ROUNDS = HTML_NEWS_BY_SPORT[sport] ? 1 : 2;
    const POLL_INTERVAL_MS = 15_000;
    const seenGuids = new Set<string>();
    const allItems: RssItem[] = [];

    for (let round = 0; round < POLL_ROUNDS; round++) {
      if (round > 0) await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));

      const feedResults = await Promise.allSettled(
        RSS_FEEDS.map(async ({ url, source, expectedChannelTag }) => {
          // RSS endpoints flake periodically — retry transient failures so
          // one bad tick doesn't drop the whole round
          const res = await fetchWithRetry(
            url,
            { headers: { 'User-Agent': 'Franchise-Fantasy-App/1.0' } },
            { attempts: 3, baseMs: 300, maxMs: 2500 },
          );
          const xml = await res.text();
          return parseRssFeed(xml, source, expectedChannelTag);
        }),
      );

      for (const result of feedResults) {
        if (result.status !== 'fulfilled') continue;
        for (const item of result.value) {
          if (seenGuids.has(item.guid)) continue;
          seenGuids.add(item.guid);
          allItems.push(item);
        }
      }
    }

    // 1b. Fetch RotoWire's HTML news list (~25 items) to recover anything the
    //     5-item RSS window overflowed during a post-game burst. Items already
    //     seen via RSS are skipped (RSS keeps its precise time); HTML-only items
    //     are tracked separately so they can be inserted with requireMatch=true.
    //     Best-effort: a failure here must not abort the RSS path.
    const htmlSource = HTML_NEWS_BY_SPORT[sport];
    const htmlOverflowItems: RssItem[] = [];
    if (htmlSource) {
      try {
        const res = await fetchWithRetry(
          htmlSource.url,
          {
            headers: { 'User-Agent': 'Franchise-Fantasy-App/1.0' },
            // The HTML page is ~350KB; cap a slow fetch so it can't eat the edge
            // wall-clock budget (retries still apply on transient failures).
            signal: AbortSignal.timeout(8000),
          },
          { attempts: 3, baseMs: 300, maxMs: 2500 },
        );
        const html = await res.text();
        for (const item of parseRotowireNewsHtml(html, htmlSource.source)) {
          if (seenGuids.has(item.guid)) continue;
          seenGuids.add(item.guid);
          htmlOverflowItems.push(item);
        }
      } catch (err) {
        console.warn('RotoWire HTML news fetch failed:', err instanceof Error ? err.message : String(err));
      }
    }

    if (allItems.length === 0 && htmlOverflowItems.length === 0) {
      await recordHeartbeat(supabase, `poll-news:${sport}`, 'ok');
      return jsonResponse({ message: 'No items fetched', inserted: 0 });
    }

    console.log(`Fetched ${allItems.length} RSS + ${htmlOverflowItems.length} HTML-overflow unique items`);

    // 1c. Duplicate pre-check: on a typical tick every fetched item is already
    //     in player_news (or in the rejected cache), so ONE indexed id lookup
    //     lets us exit before the full player-table load + per-item upsert
    //     parade that used to run every minute regardless.
    const candidates: { item: RssItem; requireMatch: boolean; externalId: string }[] = [];
    for (const item of allItems) {
      candidates.push({ item, requireMatch: false, externalId: await hashExternalId(item.source, item.guid) });
    }
    for (const item of htmlOverflowItems) {
      candidates.push({ item, requireMatch: true, externalId: await hashExternalId(item.source, item.guid) });
    }

    const unrejected = candidates.filter((c) => !rejectedExternalIds.has(c.externalId));
    let knownIds = new Set<string>();
    if (unrejected.length > 0) {
      const { data: knownRows, error: knownErr } = await supabase
        .from('player_news')
        .select('external_id')
        .eq('sport', sport)
        .in('external_id', unrejected.map((c) => c.externalId));
      if (knownErr) {
        // Fail open: with an empty known-set every item proceeds to the
        // upsert path, whose own ignoreDuplicates dedup still holds.
        console.warn('player_news known-id pre-check failed:', knownErr.message);
      }
      knownIds = new Set((knownRows ?? []).map((r) => r.external_id as string));
    }
    const toProcess = unrejected.filter((c) => !knownIds.has(c.externalId));

    if (toProcess.length === 0) {
      await recordHeartbeat(supabase, `poll-news:${sport}`, 'ok');
      return jsonResponse({
        message: 'No new items',
        fetched: candidates.length,
        inserted: 0,
      });
    }

    // 2. Load all players for name matching, scoped to this sport so an NBA
    //    article can't accidentally match a WNBA name (or vice versa). Only
    //    reached when genuinely new items exist.
    const { data: allPlayers, error: playerErr } = await supabase
      .from('players').select('id, name, external_id_nba, status').eq('sport', sport);
    if (playerErr) throw playerErr;

    // Normalized name → player IDs (for matching) + player info lookup (for the
    // mentioned_players JSONB and notification names).
    const nameToIds = buildPlayerNameIndex(allPlayers ?? []);
    const playerById = new Map<string, { name: string; external_id_nba: string | null; status: string }>();
    for (const p of allPlayers ?? []) {
      playerById.set(p.id, { name: p.name, external_id_nba: p.external_id_nba, status: p.status });
    }

    // 3. Insert each article via the shared helper.
    //    - RSS items use requireMatch=false: the curated feed is trusted, so a
    //      0-match headline (e.g. a coach or a player not in our DB) is still
    //      real news worth storing.
    //    - HTML-overflow items use requireMatch=true: the basketball news page
    //      also carries G-League / euro / minors blurbs, so we keep only those
    //      whose subject matches a known NBA player — that match IS the NBA
    //      scope filter.
    //    (Player status is never updated from RotoWire — poll-injuries is
    //    authoritative; headline parsing like "Herro: Available Wednesday" is
    //    too imprecise to flip a status safely.)
    let inserted = 0;
    let mentionsInserted = 0;
    const newArticlePlayerIds = new Set<string>();
    // Map player name → most recent article title (for single-player notification body)
    const newArticleTitles = new Map<string, string>();

    for (const { item, requireMatch, externalId } of toProcess) {
      // A requireMatch item with no known-player match is never inserted, so
      // remember its id — otherwise it defeats the pre-check's early exit on
      // every tick for as long as it stays on the news page.
      if (requireMatch) {
        const matched = matchPlayersInText(
          normalizeName(`${item.title} ${item.description}`), nameToIds,
        );
        if (matched.length === 0) {
          rememberRejected(externalId);
          continue;
        }
      }
      const { inserted: didInsert, matchedPlayerIds } = await insertNewsArticle(
        supabase, item, sport, nameToIds, playerById, requireMatch,
      );
      if (!didInsert) continue;

      inserted++;
      mentionsInserted += matchedPlayerIds.length;
      for (const pid of matchedPlayerIds) {
        newArticlePlayerIds.add(pid);
        const pName = playerById.get(pid)?.name;
        if (pName) newArticleTitles.set(pName, item.title);
      }
    }

    // 4. Send push notifications for newly inserted articles.
    const notificationsSent = await notifyRosteredPlayerNews(
      supabase,
      [...newArticlePlayerIds],
      playerById,
      newArticleTitles,
    );

    const summary = {
      fetched: allItems.length + htmlOverflowItems.length,
      rssFetched: allItems.length,
      htmlOverflow: htmlOverflowItems.length,
      newCandidates: toProcess.length,
      inserted,
      mentionsInserted,
      notificationsSent,
      totalPlayers: nameToIds.size,
    };
    console.log('poll-news complete:', JSON.stringify(summary));

    await recordHeartbeat(supabase, `poll-news:${sport}`, 'ok');
    return jsonResponse(summary);
  } catch (err) {
    await recordHeartbeat(supabase, `poll-news:${sport}`, 'error', err instanceof Error ? err.message : String(err));
    return handleError(err, 'poll-news');
  }
});
