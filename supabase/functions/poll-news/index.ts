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
import { fetchWithRetry } from '../_shared/retry.ts';
import { parseBody, z } from '../_shared/validate.ts';

const Body = z.object({
  sport: z.enum(['nba', 'wnba']).optional(),
});

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SB_SECRET_KEY")!,
);

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
    if (parsed.sport === 'wnba') sport = 'wnba';
  } catch {
    // No body / not JSON — default sport stays 'nba'.
  }
  const RSS_FEEDS = RSS_FEEDS_BY_SPORT[sport];

  try {
    // 1. Fetch RSS feed multiple times over ~45s to work around the 5-item cap.
    //    RotoWire's feed only holds ~5 items at a time, so a single fetch per
    //    minute misses articles during busy periods. We poll 4 times (0s, 15s,
    //    30s, 45s) and deduplicate by guid.
    const POLL_ROUNDS = 4;
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

    if (allItems.length === 0) {
      await recordHeartbeat(supabase, `poll-news:${sport}`, 'ok');
      return jsonResponse({ message: 'No items fetched', inserted: 0 });
    }

    console.log(`Fetched ${allItems.length} unique RSS items across ${POLL_ROUNDS} rounds`);

    // 2. Load all players for name matching, scoped to this sport so an NBA
    //    article can't accidentally match a WNBA name (or vice versa).
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

    // 3. Insert each article via the shared helper. requireMatch=false:
    //    RotoWire is curated, so a 0-match headline is still real news worth
    //    storing. (Player status is never updated from RSS — poll-injuries is
    //    authoritative; headline parsing like "Herro: Available Wednesday" is
    //    too imprecise to flip a status safely.)
    let inserted = 0;
    let mentionsInserted = 0;
    const newArticlePlayerIds = new Set<string>();
    // Map player name → most recent article title (for single-player notification body)
    const newArticleTitles = new Map<string, string>();

    for (const item of allItems) {
      const { inserted: didInsert, matchedPlayerIds } = await insertNewsArticle(
        supabase, item, sport, nameToIds, playerById, false,
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
      fetched: allItems.length,
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
