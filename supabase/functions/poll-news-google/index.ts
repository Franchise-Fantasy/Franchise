// poll-news-google
// ───────────────────────────────────────────────────────────────────────────
// FALLBACK / gap-fill companion to poll-news. RotoWire (poll-news) is the
// PREFERRED player-news source — curated, fantasy-focused, polled every minute.
// This function only covers players RotoWire hasn't produced an article for in
// the last GAP_HOURS, by querying Google News RSS per player. It never competes
// with RotoWire for a player who already has fresh coverage.
//
// Triggered by cron (recommend every 2 minutes — see README.md), one minute
// behind poll-news so RotoWire always lands first.
//
// Eligibility per cycle:
//   1. Player is rostered in any league OR mentioned in any article in the
//      last RECENT_ACTIVE_DAYS
//   2. No player_news article from ANY source in the last GAP_HOURS — this is
//      what keeps RotoWire preferred: a player RotoWire just covered is skipped
//   3. Picked in order of oldest players.last_google_news_check_at (NULLS FIRST)
//
// REQUIRED SCHEMA CHANGE (see migration 20260525000000_players_last_google_news_check.sql):
//   ALTER TABLE players ADD COLUMN last_google_news_check_at TIMESTAMPTZ;
//
// Mirrors the poll-news contract: writes to player_news + player_news_mentions
// (same row shape, so Google rows render identically — headshots included) and
// records a heartbeat under `poll-news-google:<sport>`.
//
// FEED-ONLY — this function NEVER sends a push notification. Google's ~40-outlet
// allowlist produces far more articles than RotoWire does, and pushing all of
// them buried users in notifications (the volume was pushing people toward
// turning notifications off entirely). Player-news pushes now come from
// poll-news (RotoWire, curated) alone; Google coverage still fills the in-app
// feed for players RotoWire never writes about. Don't re-add a push here without
// a dedicated, default-off preference key.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { Sport } from '../_shared/bdl.ts';
import { CORS_HEADERS } from '../_shared/cors.ts';
import { recordHeartbeat } from '../_shared/heartbeat.ts';
import { handleError, jsonResponse, errorResponse } from '../_shared/http.ts';
import { buildPlayerNameIndex, insertNewsArticle } from '../_shared/news-extract.ts';
import { isFantasyRelevant } from '../_shared/newsText.ts';
import { fetchWithRetry } from '../_shared/retry.ts';
import { parseBody, z } from '../_shared/validate.ts';
import { buildGoogleNewsUrl, parseGoogleNewsRss, type GoogleNewsItem } from './google-news.ts';

const Body = z.object({
  sport: z.enum(['nba', 'wnba']).optional(),
});

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SB_SECRET_KEY")!,
);

// Sport → query tag we append to Google News searches. Tight tags reduce
// cross-sport name collisions (e.g., "Josh Allen" NFL QB vs hypothetical NBA).
const SPORT_QUERY_TAG: Record<Sport, string> = {
  nba: 'NBA',
  wnba: 'WNBA',
  nfl: 'NFL', // not scheduled for NFL yet (Body enum gates it); tag ready if that changes
};

// Tuning knobs. Google News is undocumented and rate-limits aggressively, so we
// keep concurrency low and DON'T retry — a retried 429 just deepens the rate-
// limit hole, and a flaked player is simply re-queued on the next rotation.
//
// BATCH_SIZE is deliberately small: at CONCURRENCY 5 the run is ~BATCH_SIZE/5
// fetch waves, and the whole function must finish inside the edge wall-clock
// limit (a batch of 100 overran 72s and was killed with a 546). 25/run still
// rotates the full player pool every ~40 min on the 2-minute cron, which is
// plenty for gap-fill. REQUEST_TIMEOUT_MS caps a single slow Google response so
// it can't hold a pool lane for the whole run.
const BATCH_SIZE = 10;                 // players queried per cron run
const CONCURRENCY = 5;                 // parallel Google News requests
const FETCH_ATTEMPTS = 1;              // 1 = no retry (see above)
const REQUEST_TIMEOUT_MS = 6000;       // abort a single Google request after this
const MAX_STAGGER_MS = 200;            // jitter each request start to avoid bursts
const GAP_HOURS = 24;                  // skip players with coverage (any source) newer than this
const RECENT_ACTIVE_DAYS = 14;         // "recently active" = mentioned in any article this window
const MAX_ARTICLE_AGE_DAYS = 14;       // drop articles published before this — Google ranks by
                                       // relevance not recency, so a quiet player's query can return
                                       // years-old stories. `when:Nd` in the URL filters at the source;
                                       // this is the authoritative belt-and-suspenders insert gate.
const MAX_ARTICLE_AGE_MS = MAX_ARTICLE_AGE_DAYS * 86_400_000;
const MAX_ARTICLES_PER_PLAYER = 3;     // top-N Google results to keep per player/run (curbs same-event flooding)

// ── Concurrency helper ─────────────────────────
// Lightweight pool — runs `worker(item)` for each item with at most `limit`
// in flight at once. Returns settled results in input order.

async function pooledMap<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let cursor = 0;
  const runners = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      try {
        results[i] = { status: 'fulfilled', value: await worker(items[i]) };
      } catch (err) {
        results[i] = { status: 'rejected', reason: err };
      }
    }
  });
  await Promise.all(runners);
  return results;
}

// ── Main Handler ───────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  const cronSecret = Deno.env.get('CRON_SECRET');
  const authHeader = req.headers.get('Authorization');
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return errorResponse('Unauthorized', 401);
  }

  let sport: Sport = 'nba';
  try {
    const parsed = parseBody(Body, await req.json());
    if (parsed.sport === 'wnba') sport = 'wnba';
  } catch {
    // No body / not JSON → default sport stays 'nba'.
  }

  const sportTag = SPORT_QUERY_TAG[sport];
  if (!sportTag) {
    return errorResponse(`Unsupported sport: ${sport}`, 400);
  }

  try {
    // 0. Dedup/cap the news feeds at the top of every cycle. poll-news-google
    //    fires ~once a minute across the two sports, so hosting the prune here
    //    avoids a separate cron. Best-effort — a prune failure must not abort
    //    the poll.
    const { error: pruneErr } = await supabase.rpc('prune_player_news', { p_window_hours: 6, p_keep: 15 });
    if (pruneErr) console.warn('prune_player_news error:', pruneErr.message);

    // 1. Load all players for this sport. We need every player for the
    //    article-text matching step (an article fetched for player A may also
    //    mention player B). `playerById` keeps the SAME shape poll-news stores
    //    in mentioned_players so Google rows are indistinguishable from RotoWire
    //    rows on the client (headshots key off external_id_nba). `lastCheckById`
    //    is tracked separately and never written into article JSONB.
    const { data: allPlayers, error: playerErr } = await supabase
      .from('players')
      .select('id, name, external_id_nba, status, last_google_news_check_at')
      .eq('sport', sport);
    if (playerErr) throw playerErr;

    const nameToIds = buildPlayerNameIndex(allPlayers ?? []);
    const playerById = new Map<string, { name: string; external_id_nba: string | null; status: string }>();
    const lastCheckById = new Map<string, string | null>();
    for (const p of allPlayers ?? []) {
      playerById.set(p.id, { name: p.name, external_id_nba: p.external_id_nba, status: p.status });
      lastCheckById.set(p.id, p.last_google_news_check_at);
    }

    // 2. Build the eligible set: (rostered ∪ recently mentioned). A single
    //    mentions query covers BOTH eligibility (RECENT_ACTIVE_DAYS) and the
    //    fresh-coverage skip set (GAP_HOURS) — the GAP_HOURS window is a subset
    //    of the RECENT_ACTIVE_DAYS rows, so we filter the same rows in memory.
    const eligibleIds = new Set<string>();

    const { data: rostered, error: rostErr } = await supabase
      .from('league_players')
      .select('player_id, players!inner(sport)')
      .eq('players.sport', sport);
    if (rostErr) throw rostErr;
    for (const row of rostered ?? []) eligibleIds.add(row.player_id);

    const recentCutoff = new Date(Date.now() - RECENT_ACTIVE_DAYS * 86_400_000).toISOString();
    const gapCutoffMs = Date.now() - GAP_HOURS * 3_600_000;
    const { data: mentions, error: mErr } = await supabase
      .from('player_news_mentions')
      .select('player_id, player_news!inner(sport, published_at)')
      .eq('player_news.sport', sport)
      .gte('player_news.published_at', recentCutoff);
    if (mErr) throw mErr;

    // Players RotoWire (or a prior Google run) already covered recently — these
    // stay with the preferred source and are NOT re-queried via Google.
    const playersWithRecentCoverage = new Set<string>();
    for (const row of mentions ?? []) {
      eligibleIds.add(row.player_id);
      const publishedAt = (row as { player_news?: { published_at?: string } }).player_news?.published_at;
      if (publishedAt && new Date(publishedAt).getTime() >= gapCutoffMs) {
        playersWithRecentCoverage.add(row.player_id);
      }
    }

    if (eligibleIds.size === 0) {
      await recordHeartbeat(supabase, `poll-news-google:${sport}`, 'ok');
      return jsonResponse({ message: 'No eligible players', queried: 0, inserted: 0 });
    }

    // 3. Drop players who already have fresh coverage, then order the remainder
    //    oldest-checked first (never-checked → front of the queue).
    const gapPlayerIds = [...eligibleIds].filter(id => !playersWithRecentCoverage.has(id));
    gapPlayerIds.sort((a, b) => {
      const la = lastCheckById.get(a) ?? '';
      const lb = lastCheckById.get(b) ?? '';
      if (la === lb) return 0;
      if (la === '') return -1;
      if (lb === '') return 1;
      return la < lb ? -1 : 1;
    });

    const batch = gapPlayerIds.slice(0, BATCH_SIZE);

    if (batch.length === 0) {
      await recordHeartbeat(supabase, `poll-news-google:${sport}`, 'ok');
      return jsonResponse({
        message: 'All eligible players have fresh coverage',
        eligible: eligibleIds.size,
        queried: 0,
        inserted: 0,
      });
    }

    console.log(`Querying Google News for ${batch.length}/${eligibleIds.size} eligible players (sport=${sport})`);

    // 4. Fetch Google News in parallel (bounded, no retry, jittered start).
    const fetchResults = await pooledMap(batch, CONCURRENCY, async (playerId) => {
      const playerInfo = playerById.get(playerId);
      if (!playerInfo) return { playerId, items: [] as GoogleNewsItem[] };
      // Stagger so the pool doesn't fire synchronized bursts at Google.
      await new Promise(r => setTimeout(r, Math.floor(Math.random() * MAX_STAGGER_MS)));
      const url = buildGoogleNewsUrl(playerInfo.name, sportTag, MAX_ARTICLE_AGE_DAYS);
      const res = await fetchWithRetry(
        url,
        {
          headers: { 'User-Agent': 'Franchise-Fantasy-App/1.0' },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        },
        { attempts: FETCH_ATTEMPTS },
      );
      const xml = await res.text();
      return { playerId, items: parseGoogleNewsRss(xml) };
    });

    // 5. Gather items across all fetches. Keep only the top
    //    MAX_ARTICLES_PER_PLAYER per player (Google returns them in relevance
    //    order) so a single event — e.g. a game six outlets recap — doesn't
    //    flood one player's feed with near-duplicates. Then dedup globally by
    //    guid (a story co-mentioning two players surfaces from both queries).
    const seenGuids = new Set<string>();
    const allItems: GoogleNewsItem[] = [];
    let fetchErrors = 0;
    for (const r of fetchResults) {
      if (r.status !== 'fulfilled') { fetchErrors++; continue; }
      for (const item of r.value.items.slice(0, MAX_ARTICLES_PER_PLAYER)) {
        if (seenGuids.has(item.guid)) continue;
        seenGuids.add(item.guid);
        allItems.push(item);
      }
    }

    console.log(`Fetched ${allItems.length} unique allowlisted items, ${fetchErrors} fetch errors`);

    // 6. Insert each article via the shared helper. requireMatch=true drops
    //    drifted Google results that match no roster name. Inserting is all this
    //    function does — see the FEED-ONLY note in the header for why no push
    //    goes out from here.
    let inserted = 0;
    let mentionsInserted = 0;

    let skippedIrrelevant = 0;
    let skippedStale = 0;
    const staleCutoffMs = Date.now() - MAX_ARTICLE_AGE_MS;
    for (const item of allItems) {
      // Drop stale articles. Google ranks by relevance, not recency, so a quiet
      // player's query can return months- or years-old stories that would land
      // in the feed dated as if they were fresh news. A missing/unparseable
      // pubDate is treated as stale — we won't insert news we can't date.
      const publishedMs = item.pubDate ? new Date(item.pubDate).getTime() : NaN;
      if (isNaN(publishedMs) || publishedMs < staleCutoffMs) { skippedStale++; continue; }

      // Drop low-value content (highlight clips, box scores, game recaps) —
      // keep only fantasy-relevant news. Google gives us only the headline
      // (description is dropped), so we judge on the title.
      if (!isFantasyRelevant(item.title)) { skippedIrrelevant++; continue; }

      const { inserted: didInsert, matchedPlayerIds } = await insertNewsArticle(
        supabase, item, sport, nameToIds, playerById, true,
      );
      if (!didInsert) continue;

      inserted++;
      mentionsInserted += matchedPlayerIds.length;
    }

    // 7. Mark every queried player as checked, regardless of result. Prevents
    //    re-querying the same player on the next cron run before the queue
    //    rotates.
    const { error: updateErr } = await supabase
      .from('players')
      .update({ last_google_news_check_at: new Date().toISOString() })
      .in('id', batch);
    if (updateErr) console.warn('last_google_news_check_at update error:', updateErr.message);

    const summary = {
      sport,
      eligible: eligibleIds.size,
      queried: batch.length,
      fetchErrors,
      fetched: allItems.length,
      skippedStale,
      skippedIrrelevant,
      inserted,
      mentionsInserted,
    };
    console.log('poll-news-google complete:', JSON.stringify(summary));

    await recordHeartbeat(supabase, `poll-news-google:${sport}`, 'ok');
    return jsonResponse(summary);
  } catch (err) {
    await recordHeartbeat(supabase, `poll-news-google:${sport}`, 'error', err instanceof Error ? err.message : String(err));
    return handleError(err, 'poll-news-google');
  }
});
