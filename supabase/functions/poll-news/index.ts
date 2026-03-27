import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { CORS_HEADERS } from '../_shared/cors.ts';
import { normalizeName } from '../_shared/normalize.ts';

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const jsonHeaders = { ...CORS_HEADERS, 'Content-Type': 'application/json' };

const RSS_FEEDS: { url: string; source: string }[] = [
  { url: 'https://www.rotowire.com/basketball/rss/news.php', source: 'rotowire' },
  { url: 'https://www.fantasypros.com/nba/news/feed/', source: 'fantasypros' },
];

// ── RSS Parsing ────────────────────────────────

interface RssItem {
  title: string;
  link: string;
  description: string;
  pubDate: string;
  source: string;
}

function extractTag(xml: string, tag: string): string {
  // Handle CDATA sections: <tag><![CDATA[content]]></tag>
  const cdataRe = new RegExp(`<${tag}>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</${tag}>`, 'i');
  const cdataMatch = xml.match(cdataRe);
  if (cdataMatch) return cdataMatch[1].trim();

  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
  const match = xml.match(re);
  return match ? match[1].trim() : '';
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ').trim();
}

function parseRssFeed(xml: string, source: string): RssItem[] {
  const items: RssItem[] = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/gi;
  let match;
  while ((match = itemRe.exec(xml)) !== null) {
    const block = match[1];
    const title = stripHtml(extractTag(block, 'title'));
    const link = stripHtml(extractTag(block, 'link'));
    const description = stripHtml(extractTag(block, 'description'));
    const pubDate = extractTag(block, 'pubDate');
    if (title && link) {
      items.push({ title, link, description, pubDate, source });
    }
  }
  return items;
}

// ── Minutes Restriction Detection ──────────────

const MIN_RESTRICT_PATTERNS = [
  /minutes?\s+restriction/i,
  /minutes?\s+limit/i,
  /minutes?\s+cap/i,
  /restricted\s+minutes/i,
  /limited\s+minutes/i,
];

const MIN_RESTRICT_NEGATIONS = [
  /off\s+(his|the|a)\s+minutes?\s+(restriction|limit|cap)/i,
  /no\s+longer\s+on\s+a?\s*minutes/i,
  /removed?\s+from\s+.*minutes?\s+(restriction|limit)/i,
  /without\s+.*minutes?\s+(restriction|limit)/i,
];

function detectMinutesRestriction(text: string): boolean {
  const hasPositive = MIN_RESTRICT_PATTERNS.some(p => p.test(text));
  if (!hasPositive) return false;
  const hasNegation = MIN_RESTRICT_NEGATIONS.some(p => p.test(text));
  return !hasNegation;
}

// ── Return Estimate Extraction ─────────────────

interface ReturnPattern {
  re: RegExp;
  extract: (m: RegExpMatchArray) => string;
}

const RETURN_PATTERNS: ReturnPattern[] = [
  { re: /out\s+for\s+the\s+(season|year)/i, extract: () => 'out for season' },
  { re: /done\s+for\s+the\s+(season|year)/i, extract: () => 'out for season' },
  { re: /season[\s-]*ending/i, extract: () => 'out for season' },
  { re: /out\s+indefinitely/i, extract: () => 'out indefinitely' },
  { re: /no\s+timetable/i, extract: () => 'out indefinitely' },
  { re: /day[\s-]*to[\s-]*day/i, extract: () => 'day-to-day' },
  { re: /week[\s-]*to[\s-]*week/i, extract: () => 'week-to-week' },
  { re: /out\s+(\d+)[\s-]*(?:to|-)[\s-]*(\d+)\s+(weeks?|days?|months?)/i, extract: (m) => `${m[1]}-${m[2]} ${m[3]}` },
  { re: /out\s+(\d+)\s+(weeks?|days?|months?)/i, extract: (m) => `${m[1]} ${m[2]}` },
  { re: /miss\s+(\d+)[\s-]*(?:to|-)[\s-]*(\d+)\s+(weeks?|games?)/i, extract: (m) => `${m[1]}-${m[2]} ${m[3]}` },
  { re: /miss\s+(\d+)\s+(weeks?|games?)/i, extract: (m) => `${m[1]} ${m[2]}` },
  { re: /sidelined\s+(\d+)[\s-]*(?:to|-)[\s-]*(\d+)\s+(weeks?|days?|months?)/i, extract: (m) => `${m[1]}-${m[2]} ${m[3]}` },
  { re: /sidelined\s+(\d+)\s+(weeks?|days?|months?)/i, extract: (m) => `${m[1]} ${m[2]}` },
  { re: /expected\s+(?:back|to\s+return)\s+in\s+(\d+)[\s-]*(?:to|-)[\s-]*(\d+)\s+(weeks?|days?)/i, extract: (m) => `~${m[1]}-${m[2]} ${m[3]}` },
  { re: /expected\s+(?:back|to\s+return)\s+in\s+(\d+)\s+(weeks?|days?)/i, extract: (m) => `~${m[1]} ${m[2]}` },
  { re: /reevaluated?\s+in\s+(\d+)[\s-]*(?:to|-)[\s-]*(\d+)\s+(weeks?|days?)/i, extract: (m) => `reevaluation in ${m[1]}-${m[2]} ${m[3]}` },
  { re: /reevaluated?\s+in\s+(\d+)\s+(weeks?|days?)/i, extract: (m) => `reevaluation in ${m[1]} ${m[2]}` },
  { re: /targeting\s+.*return.*?(\d+)[\s-]*(?:to|-)[\s-]*(\d+)\s+(weeks?)/i, extract: (m) => `~${m[1]}-${m[2]} ${m[3]}` },
  { re: /targeting\s+.*return.*?(\d+)\s+(weeks?)/i, extract: (m) => `~${m[1]} ${m[2]}` },
];

function extractReturnEstimate(text: string): string | null {
  for (const { re, extract } of RETURN_PATTERNS) {
    const m = text.match(re);
    if (m) return extract(m);
  }
  return null;
}

// ── Hashing ────────────────────────────────────

async function hashExternalId(source: string, link: string): Promise<string> {
  const data = new TextEncoder().encode(`${source}:${link}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const arr = new Uint8Array(digest);
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 48);
}

// ── Main Handler ───────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  // Cron-only: check CRON_SECRET
  const authHeader = req.headers.get('authorization') ?? '';
  const cronSecret = Deno.env.get('CRON_SECRET');
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: jsonHeaders,
    });
  }

  try {
    // 1. Fetch RSS feeds in parallel
    const feedResults = await Promise.allSettled(
      RSS_FEEDS.map(async ({ url, source }) => {
        const res = await fetch(url, {
          headers: { 'User-Agent': 'Franchise-Fantasy-App/1.0' },
        });
        if (!res.ok) {
          console.warn(`Feed ${source} returned ${res.status}`);
          return [];
        }
        const xml = await res.text();
        return parseRssFeed(xml, source);
      }),
    );

    const allItems: RssItem[] = [];
    for (const result of feedResults) {
      if (result.status === 'fulfilled') allItems.push(...result.value);
    }

    if (allItems.length === 0) {
      return new Response(JSON.stringify({ message: 'No items fetched', inserted: 0 }), {
        headers: jsonHeaders,
      });
    }

    console.log(`Fetched ${allItems.length} RSS items`);

    // 2. Load all players for name matching
    const { data: allPlayers, error: playerErr } = await supabase
      .from('players').select('id, name');
    if (playerErr) throw new Error(`Failed to fetch players: ${playerErr.message}`);

    // Build normalized name → player IDs map
    // Only match names with at least 2 parts (first + last) to avoid false positives
    const nameToIds = new Map<string, string[]>();
    for (const p of allPlayers ?? []) {
      const norm = normalizeName(p.name);
      if (norm.split(' ').length < 2) continue;
      const existing = nameToIds.get(norm) ?? [];
      existing.push(p.id);
      nameToIds.set(norm, existing);
    }

    // 3. Process each article
    let inserted = 0;
    let mentionsInserted = 0;

    for (const item of allItems) {
      const publishedAt = item.pubDate ? new Date(item.pubDate) : new Date();
      if (isNaN(publishedAt.getTime())) continue;

      const externalId = await hashExternalId(item.source, item.link);
      const fullText = `${item.title} ${item.description}`;
      const normalizedText = normalizeName(fullText);

      // Detect minutes restriction and return estimate
      const hasMinutesRestriction = detectMinutesRestriction(fullText);
      const returnEstimate = extractReturnEstimate(fullText);

      // Match players by scanning for full names in article text
      const matchedPlayerIds: string[] = [];
      for (const [normalizedName, playerIds] of nameToIds) {
        // Word-boundary-aware check: ensure the match isn't part of a longer word
        const idx = normalizedText.indexOf(normalizedName);
        if (idx === -1) continue;

        const charBefore = idx > 0 ? normalizedText[idx - 1] : ' ';
        const charAfter = idx + normalizedName.length < normalizedText.length
          ? normalizedText[idx + normalizedName.length]
          : ' ';

        if (/[a-z]/.test(charBefore) || /[a-z]/.test(charAfter)) continue;

        matchedPlayerIds.push(...playerIds);
      }

      // Upsert article (skip if already exists)
      const { data: newsRow, error: newsErr } = await supabase
        .from('player_news')
        .upsert({
          external_id: externalId,
          title: item.title.slice(0, 500),
          description: item.description?.slice(0, 1000) || null,
          link: item.link,
          source: item.source,
          published_at: publishedAt.toISOString(),
          has_minutes_restriction: hasMinutesRestriction,
          return_estimate: returnEstimate,
        }, { onConflict: 'external_id', ignoreDuplicates: true })
        .select('id')
        .single();

      if (newsErr) {
        // ignoreDuplicates returns no row on conflict — fetch the existing one
        if (newsErr.code === 'PGRST116') {
          // No row returned (duplicate) — skip mentions for this article
          continue;
        }
        console.warn(`Upsert error for "${item.title.slice(0, 50)}":`, newsErr.message);
        continue;
      }

      if (newsRow) {
        inserted++;

        // Insert player mentions
        if (matchedPlayerIds.length > 0) {
          const mentions = matchedPlayerIds.map(pid => ({
            news_id: newsRow.id,
            player_id: pid,
          }));

          const { error: mentionErr } = await supabase
            .from('player_news_mentions')
            .upsert(mentions, { onConflict: 'news_id,player_id', ignoreDuplicates: true });

          if (mentionErr) {
            console.warn('Mention insert error:', mentionErr.message);
          } else {
            mentionsInserted += matchedPlayerIds.length;
          }
        }
      }
    }

    // 4. Cleanup old articles
    const { error: cleanupErr } = await supabase.rpc('cleanup_old_news');
    if (cleanupErr) console.warn('Cleanup error:', cleanupErr.message);

    const summary = {
      fetched: allItems.length,
      inserted,
      mentionsInserted,
      totalPlayers: nameToIds.size,
    };
    console.log('poll-news complete:', JSON.stringify(summary));

    return new Response(JSON.stringify(summary), { headers: jsonHeaders });
  } catch (err: any) {
    console.error('poll-news error:', err?.message ?? err);
    return new Response(
      JSON.stringify({ error: err?.message ?? 'Internal error' }),
      { status: 500, headers: jsonHeaders },
    );
  }
});
