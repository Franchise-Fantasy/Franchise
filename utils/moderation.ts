/**
 * Client-side text moderation using a local word list + character normalization.
 * Mirrors the logic in supabase/functions/_shared/moderate.ts.
 * Keep both in sync when adding/removing terms.
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

const BLOCKED_WORDS: string[] = [
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

// No word boundaries — used for space-stripped check where boundaries don't apply
const BLOCKED_SUBSTRING_REGEX = new RegExp(
  `(${BLOCKED_WORDS.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`,
  "i",
);

/**
 * Returns true if the text contains blocked language.
 * Checks raw, normalized (leet-speak), and space-stripped versions.
 */
export function containsBlockedContent(text: string): boolean {
  if (!text || text.trim().length === 0) return false;
  // 1. Raw check
  if (BLOCKED_REGEX.test(text)) return true;
  // 2. Normalized leet-speak check
  const norm = normalize(text);
  if (BLOCKED_REGEX.test(norm)) return true;
  // 3. Space-stripped check (catches "n igger", "f a g", etc.)
  const noSpaces = norm.replace(/\s/g, "");
  if (BLOCKED_SUBSTRING_REGEX.test(noSpaces)) return true;
  return false;
}
