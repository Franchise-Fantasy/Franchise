import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { CORS_HEADERS } from "../_shared/cors.ts";
import { normalizeName } from "../_shared/normalize.ts";

/**
 * poll-prospect-news — Cron-triggered RSS poller for prospect news
 *
 * Fetches headlines from draft/recruiting RSS feeds, matches them to
 * prospect player names, and stores in prospect_news tables.
 *
 * Auth: CRON_SECRET bearer token.
 * Schedule: every 3 hours.
 */

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const jsonHeaders = {
  ...CORS_HEADERS,
  "Content-Type": "application/json",
};

const RSS_FEEDS: { url: string; source: string }[] = [
  {
    url: "https://247sports.com/Sport/Basketball/rss/",
    source: "247sports",
  },
  { url: "https://www.on3.com/news/basketball/rss/", source: "on3" },
  { url: "https://thedraftnetwork.com/feed", source: "draft_network" },
];

// ── RSS Parsing (mirrors poll-news patterns) ─────

interface RssItem {
  title: string;
  link: string;
  description: string;
  pubDate: string;
  source: string;
}

function extractTag(xml: string, tag: string): string {
  const cdataRe = new RegExp(
    `<${tag}>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</${tag}>`,
    "i",
  );
  const cdataMatch = xml.match(cdataRe);
  if (cdataMatch) return cdataMatch[1].trim();

  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i");
  const match = xml.match(re);
  return match ? match[1].trim() : "";
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .trim();
}

function parseRssFeed(xml: string, source: string): RssItem[] {
  const items: RssItem[] = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/gi;
  let match;
  while ((match = itemRe.exec(xml)) !== null) {
    const block = match[1];
    const title = stripHtml(extractTag(block, "title"));
    const link = stripHtml(extractTag(block, "link"));
    const description = stripHtml(extractTag(block, "description"));
    const pubDate = extractTag(block, "pubDate");
    if (title && link) {
      items.push({ title, link, description, pubDate, source });
    }
  }
  return items;
}

/** SHA-256 hash for deduplication */
async function hashId(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  const cronSecret = Deno.env.get("CRON_SECRET");
  const authHeader = req.headers.get("Authorization");
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return new Response(
      JSON.stringify({ error: "Unauthorized" }),
      { status: 401, headers: jsonHeaders },
    );
  }

  try {
    // 1. Load all prospect names for matching
    const { data: prospects, error: pErr } = await supabase
      .from("players")
      .select("id, name")
      .eq("is_prospect", true);

    if (pErr) throw new Error(`Failed to load prospects: ${pErr.message}`);

    const prospectList = (prospects ?? []).map((p) => ({
      id: p.id as string,
      name: p.name as string,
      normName: normalizeName(p.name),
      // For matching, also prepare first/last separately
      parts: normalizeName(p.name).split(" "),
    }));

    // 2. Fetch all RSS feeds in parallel
    const allItems: RssItem[] = [];

    await Promise.all(
      RSS_FEEDS.map(async (feed) => {
        try {
          const res = await fetch(feed.url, {
            headers: { "User-Agent": "FranchiseFantasy/1.0" },
          });
          if (!res.ok) {
            console.warn(
              `RSS fetch failed: ${feed.source} (${res.status})`,
            );
            return;
          }
          const xml = await res.text();
          const items = parseRssFeed(xml, feed.source);
          allItems.push(...items);
        } catch (e) {
          console.warn(`RSS fetch error: ${feed.source}`, e);
        }
      }),
    );

    // 3. Process articles and match to prospects
    let inserted = 0;
    let mentionsInserted = 0;

    for (const item of allItems) {
      const externalId = await hashId(item.link || item.title);
      const titleNorm = normalizeName(item.title);
      const descNorm = normalizeName(item.description);
      const combinedText = `${titleNorm} ${descNorm}`;

      // Find mentioned prospects (word-boundary match on full name)
      const mentioned = prospectList.filter((p) => {
        if (p.parts.length < 2) return false;
        return combinedText.includes(p.normName);
      });

      // Parse publish date
      let publishedAt: string;
      try {
        publishedAt = new Date(item.pubDate).toISOString();
      } catch {
        publishedAt = new Date().toISOString();
      }

      // Upsert the article
      const { error: newsErr } = await supabase
        .from("prospect_news")
        .upsert(
          {
            external_id: externalId,
            title: item.title.slice(0, 500),
            description: item.description.slice(0, 2000),
            link: item.link,
            source: item.source,
            published_at: publishedAt,
          },
          { onConflict: "external_id", ignoreDuplicates: true },
        );

      if (newsErr) {
        console.warn(`News upsert failed: ${newsErr.message}`);
        continue;
      }

      if (mentioned.length === 0) continue;
      inserted++;

      // Get the news row ID for mentions
      const { data: newsRow } = await supabase
        .from("prospect_news")
        .select("id")
        .eq("external_id", externalId)
        .single();

      if (!newsRow) continue;

      // Insert mentions
      const mentionRows = mentioned.map((p) => ({
        news_id: newsRow.id,
        player_id: p.id,
      }));

      const { error: mentionErr } = await supabase
        .from("prospect_news_mentions")
        .upsert(mentionRows, {
          onConflict: "news_id,player_id",
          ignoreDuplicates: true,
        });

      if (!mentionErr) {
        mentionsInserted += mentionRows.length;
      }
    }

    return new Response(
      JSON.stringify({
        fetched: allItems.length,
        withMentions: inserted,
        mentionsInserted,
        totalProspects: prospectList.length,
      }),
      { status: 200, headers: jsonHeaders },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: jsonHeaders },
    );
  }
});
