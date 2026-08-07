/**
 * Client-side text moderation using a local word list + character normalization.
 * The word list is shared with supabase/functions/_shared/moderate.ts and with
 * the check_blocked_content() trigger in SQL — the trigger is what actually
 * enforces this, so any change to the terms OR the matching rules has to land
 * in a migration in the same commit. Keep all three in sync.
 */

// Common character substitutions used to evade filters
const CHAR_MAP: Record<string, string> = {
  "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t",
  "@": "a", "!": "i", "|": "i", "$": "s", "+": "t",
  "(": "c", "{": "c", "<": "c", "l": "i",
};

/** Normalize text: lowercase, strip accents, replace leet-speak symbols. */
function normalize(text: string): string {
  // Lowercase and decompose accents (é → e)
  let out = text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  // Replace known substitution characters
  out = out.replace(/[01345@!|$+({<7l]/g, (ch) => CHAR_MAP[ch] ?? ch);
  // Collapse repeated characters (e.g. "nigggerr" → "niger" won't help, but "faaag" → "fag")
  // Only collapse runs of 3+  to avoid breaking legit words
  out = out.replace(/(.)\1{2,}/g, "$1$1");
  // Strip non-alphanumeric except spaces (removes *,_,-, etc. used as separators)
  out = out.replace(/[^a-z0-9\s]/g, "");
  // Collapse whitespace
  out = out.replace(/\s+/g, " ").trim();
  return out;
}

export const BLOCKED_WORDS: string[] = [
  // Racial slurs
  "nigger", "nigga", "niggas", "niga", "nigg",
  "chink", "gook", "spic", "wetback",
  "kike", "beaner",
  "coon", "darkie",
  "raghead", "towelhead", "sandnigger",
  // Homophobic slurs
  "faggot", "faggit", "fag", "fags", "dyke",
  // Other slurs / hate terms
  "retard", "retarded", "retards",
  "tranny",
  // Extreme profanity
  "cunt",
  // White supremacy
  "1488", "heil hitler", "sieg heil", "white power", "white supremacy",
  "gas the jews",
];

const BLOCKED_REGEX = new RegExp(
  `\\b(${BLOCKED_WORDS.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`,
  "i",
);

// Pure-alpha entries only. A multi-word phrase ("white power") can never equal a
// whitespace-free join, and a digit entry ("1488") can't survive normalize(),
// which maps 1 -> i and 4 -> a. Both are already covered by the checks above.
// Mirrored by the blocked_words array in check_blocked_content() — see
// __tests__/moderation.test.ts for the parity assertion.
export const SPLITTABLE_WORDS = BLOCKED_WORDS.filter((w) => /^[a-z]+$/.test(w));
const LONGEST_BLOCKED_WORD = Math.max(...SPLITTABLE_WORDS.map((w) => w.length));
const SPLITTABLE_SET = new Set(SPLITTABLE_WORDS);

/**
 * Catches a slur split across whitespace ("f a g g o t", "n igger") by joining
 * runs of adjacent words and testing each join for an exact match.
 *
 * The span must consume WHOLE words. An earlier version stripped every space
 * and substring-matched the result, which flagged any word pair that happened
 * to straddle a slur — "supports picks" and "hours/pick" both contain "spic",
 * so ordinary league surveys were rejected as hate speech.
 */
function containsSplitBlockedWord(normalized: string): boolean {
  const words = normalized.split(" ").filter(Boolean);
  for (let start = 0; start < words.length; start++) {
    let joined = words[start];
    for (let end = start + 1; end < words.length; end++) {
      joined += words[end];
      if (joined.length > LONGEST_BLOCKED_WORD) break;
      if (SPLITTABLE_SET.has(joined)) return true;
    }
  }
  return false;
}

/**
 * Returns true if the text contains blocked language.
 * Checks raw, normalized (leet-speak), and whitespace-split versions.
 */
export function containsBlockedContent(text: string): boolean {
  if (!text || text.trim().length === 0) return false;
  // 1. Raw check
  if (BLOCKED_REGEX.test(text)) return true;
  // 2. Normalized leet-speak check
  const norm = normalize(text);
  if (BLOCKED_REGEX.test(norm)) return true;
  // 3. Whitespace-split check (catches "n igger", "f a g", etc.)
  return containsSplitBlockedWord(norm);
}
