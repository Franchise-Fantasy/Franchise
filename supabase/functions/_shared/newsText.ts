// Pure text-extraction helpers shared by the player-news pollers (poll-news =
// RotoWire RSS, poll-news-google = Google News RSS).
//
// This module has ZERO imports on purpose: it's portable between the Deno edge
// runtime and Node, so the regex-heavy logic here can be unit-tested directly
// (see __tests__/newsText.test.ts). The supabase/push-coupled helpers live in
// news-extract.ts instead.

// ── XML helpers ────────────────────────────────

/** Inner text of the first <tag>…</tag>. Handles CDATA payloads and attributes. */
export function extractTag(xml: string, tag: string): string {
  const cdataRe = new RegExp(`<${tag}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</${tag}>`, 'i');
  const cdataMatch = xml.match(cdataRe);
  if (cdataMatch) return cdataMatch[1].trim();

  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
  const match = xml.match(re);
  return match ? match[1].trim() : '';
}

/**
 * Strip markup and decode the entities RSS feeds emit, returning plain text.
 *
 * Order matters: Google News *entity-encodes* the HTML inside its <description>
 * (e.g. `&lt;a href="…"&gt;Headline&lt;/a&gt;`). We must decode `&lt;`/`&gt;`
 * into real `<`/`>` FIRST, then strip tags — otherwise the encoded tags survive
 * the tag-strip and get decoded into visible `<a href=…>` garbage in the card.
 * `&amp;` is decoded last so we don't resurrect an entity out of decoded text.
 */
export function stripHtml(html: string): string {
  return html
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Minutes restriction detection ──────────────

const MIN_RESTRICT_PATTERNS = [
  /minutes?\s+restriction/i,
  /minutes?\s+limit/i,
  /minutes?\s+cap/i,
  /restricted\s+minutes/i,
  /limited\s+minutes/i,
  /load\s+manag/i,
  /ramp(ing|ed)?\s+(up|back)/i,
  /reduced\s+(role|usage|workload|minutes)/i,
  /ease[ds]?\s+(him|back|into)/i,
  /playing\s+time\s+(will be|is being)?\s*(monitored|limited|managed)/i,
  /won'?t\s+play\s+more\s+than\s+\d+\s+minutes/i,
  /pitch\s+count/i,
  /bringing\s+.{0,20}back\s+slowly/i,
  /not\s+expected\s+to\s+play\s+(his|a)\s+full/i,
  /workload\s+(will be|is being)?\s*(managed|monitored|limited)/i,
];

const MIN_RESTRICT_NEGATIONS = [
  /off\s+(his|the|a)\s+minutes?\s+(restriction|limit|cap)/i,
  /no\s+longer\s+on\s+a?\s*minutes/i,
  /removed?\s+from\s+.*minutes?\s+(restriction|limit)/i,
  /without\s+.*minutes?\s+(restriction|limit)/i,
  /no\s+(more\s+)?load\s+manag/i,
  /done\s+ramp/i,
  /full\s+go/i,
  /no\s+(minutes?|playing\s+time)\s+(restriction|limit)/i,
];

export function detectMinutesRestriction(text: string): boolean {
  const hasPositive = MIN_RESTRICT_PATTERNS.some(p => p.test(text));
  if (!hasPositive) return false;
  const hasNegation = MIN_RESTRICT_NEGATIONS.some(p => p.test(text));
  return !hasNegation;
}

// ── Return estimate extraction ─────────────────

interface ReturnPattern {
  re: RegExp;
  extract: (m: RegExpMatchArray) => string;
}

// The bare "season-ending" adjective is ambiguous: "season-ending surgery /
// injury / Achilles tear" is a real availability signal, but "season-ending
// loss / defeat / Game 7" describes a team's playoff elimination and must NOT
// produce an "Out For Season" label. We gate this one rule on an injury context
// appearing somewhere in the text (the explicit "out/done for the season"
// patterns below are unambiguous and stay unguarded).
const SEASON_ENDING_RE = /season[\s-]*ending/i;
const INJURY_CONTEXT_RE =
  /injur|surger|surgical|procedure|operation|\btears?\b|\btorn\b|ruptur|fracture|sprain|strain|ligament|\bACL\b|\bMCL\b|achilles|sideline|undergo/i;

const RETURN_PATTERNS: ReturnPattern[] = [
  { re: /out\s+for\s+the\s+(season|year)/i, extract: () => 'out for season' },
  { re: /done\s+for\s+the\s+(season|year)/i, extract: () => 'out for season' },
  { re: SEASON_ENDING_RE, extract: () => 'out for season' },
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

export function extractReturnEstimate(text: string): string | null {
  for (const { re, extract } of RETURN_PATTERNS) {
    const m = text.match(re);
    if (!m) continue;
    // "season-ending" only counts as an injury signal in an injury context.
    if (re === SEASON_ENDING_RE && !INJURY_CONTEXT_RE.test(text)) continue;
    return extract(m);
  }
  return null;
}

// ── Fantasy relevance ──────────────────────────

// Google News surfaces a lot of low-value content for a player — highlight
// clips ("Drains the Shot"), box scores, game recaps ("fall 91-76"). Fantasy
// managers only care about availability, role, and transactions, so we keep a
// Google article only if its headline carries one of these signals. (Applied
// to Google results only; RotoWire is already curated fantasy news.)
//
// This is a deliberately strict allowlist: gap-fill can afford to drop a
// borderline article since RotoWire/poll-injuries cover the important beats.
const FANTASY_RELEVANT_PATTERNS: RegExp[] = [
  // Injury / availability
  /injur/i, /questionable/i, /doubtful/i, /\bprobable\b/i,
  /day[\s-]?to[\s-]?day/i, /week[\s-]?to[\s-]?week/i, /sideline/i,
  /ruled out/i, /\bout (for|indefinitely|with|the)\b/i, /expected to miss/i,
  /sprain/i, /strain/i, /surgery/i, /\bMRI\b/i, /rehab/i, /setback/i,
  /soreness/i, /\billness\b/i, /load manag/i, /minutes? (restriction|limit|cap)/i,
  /\bDNP\b/i, /fracture/i, /concussion/i, /\bprotocol\b/i,
  /\breturn(s|ing|ed)?\b/i, /re-?evaluat/i, /\bcleared\b/i,
  /hamstring|ankle|\bknee\b|groin|\bcalf\b|achilles|shoulder|\bwrist\b|\bquad\b|plantar/i,
  // Role / usage
  /\bstart(er|ers|ing)\b/i, /\bbench(ed)?\b/i, /(reduced|expanded|bigger|larger) role/i,
  /\busage\b/i, /rotation/i, /\blineup\b/i, /promot/i, /demot/i,
  // Transactions
  /\btrade(d|s)?\b/i, /\bsign(s|ed|ing)?\b/i,
  /waiv(e|ed|er|ers)/i, /\bclaim(s|ed)?\b/i, /releas(e|ed)/i, /buyout/i,
  /two-?way/i, /10-day/i, /\bconvert(s|ed)?\b/i, /\bassign(s|ed|ment)?\b/i,
  /recall(s|ed)?\b/i, /suspen(d|ded|sion)/i, /\bfined?\b/i, /eject(s|ed)?\b/i,
  /\bcontract\b/i, /g[\s-]?league/i,
  // Status
  /\bdebut\b/i, /season[\s-]?ending/i, /\bactivated\b/i,
];

// Hard excludes: speculation/clickbait that often contains a relevant keyword
// (a "mock trade" has "trade") but is never actual news. Checked first.
const FANTASY_EXCLUDE_PATTERNS: RegExp[] = [
  /\bmock\b/i,            // mock trade / mock draft
  /\?\s*$/,              // headline phrased as a question ("Is X a buy?", "Should
                         // you start Y?") — speculation/clickbait, not reported
                         // news. RotoWire blurbs are statements, so this only
                         // trims the noisier Google gap-fill, never RotoWire.
];

/** True if the text reads like fantasy-relevant news (injury / role / transaction). */
export function isFantasyRelevant(text: string): boolean {
  if (FANTASY_EXCLUDE_PATTERNS.some(re => re.test(text))) return false;
  return FANTASY_RELEVANT_PATTERNS.some(re => re.test(text));
}

// ── Player name matching ───────────────────────

/**
 * Scan already-normalized article text for player full names. Word-boundary
 * aware: a match must not be flanked by letters, so "lebron james" won't fire
 * inside "lebron jameson". Returns every matched player id (duplicates if two
 * players share a normalized name). `nameToIds` is built by buildPlayerNameIndex
 * in news-extract.ts (it needs normalizeName); this scan stays pure.
 */
export function matchPlayersInText(
  normalizedText: string,
  nameToIds: ReadonlyMap<string, string[]>,
): string[] {
  const matched: string[] = [];
  for (const [normalizedName, playerIds] of nameToIds) {
    const idx = normalizedText.indexOf(normalizedName);
    if (idx === -1) continue;

    const charBefore = idx > 0 ? normalizedText[idx - 1] : ' ';
    const charAfter = idx + normalizedName.length < normalizedText.length
      ? normalizedText[idx + normalizedName.length]
      : ' ';

    if (/[a-z]/.test(charBefore) || /[a-z]/.test(charAfter)) continue;
    matched.push(...playerIds);
  }
  return matched;
}

// ── Hashing ────────────────────────────────────

/** Stable per-article id: sha256(`source:key`) truncated to 48 hex chars. */
export async function hashExternalId(source: string, key: string): Promise<string> {
  const data = new TextEncoder().encode(`${source}:${key}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const arr = new Uint8Array(digest);
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 48);
}
