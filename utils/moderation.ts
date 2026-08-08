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
// whitespace-free join, and a digit entry ("1488") can't survive normalization,
// which maps 1 -> i and 4 -> a. Both are already covered by the checks above.
// Mirrored by the blocked_words array in check_blocked_content() — see
// __tests__/moderation.test.ts for the parity assertion.
export const SPLITTABLE_WORDS = BLOCKED_WORDS.filter((w) => /^[a-z]+$/.test(w));
const LONGEST_BLOCKED_WORD = Math.max(...SPLITTABLE_WORDS.map((w) => w.length));
const SPLITTABLE_SET = new Set(SPLITTABLE_WORDS);

/** One normalized character, tagged with the index it came from in the input. */
interface MappedChar {
  char: string;
  source: number;
}

/** A normalized word, with the span of raw input it was derived from. */
interface MappedWord {
  text: string;
  /** Index in the original input of this word's first character. */
  start: number;
  /** Index in the original input of this word's last character (inclusive). */
  end: number;
}

/**
 * Lowercase, strip accents, and undo leet-speak — carrying each surviving
 * character's original index along, so a match can be quoted back to the user
 * in their own words instead of as the slur it normalized into. Nobody wants
 * "supports picks" reported to them as "spic".
 */
function normalizeMapped(input: string): MappedChar[] {
  const lower = input.toLowerCase();
  let chars: MappedChar[] = [];

  // Decompose accents (é → e) and drop the combining marks.
  for (let i = 0; i < lower.length; i++) {
    const base = lower[i].normalize("NFD").replace(/[̀-ͯ]/g, "");
    for (const char of base) chars.push({ char, source: i });
  }

  // Replace known substitution characters (@ → a, 3 → e, ...).
  chars = chars.map(({ char, source }) => ({ char: CHAR_MAP[char] ?? char, source }));

  // Collapse runs of 3+ identical characters down to 2 ("faaag" → "faag").
  // Only 3+, so legitimate doubles ("keeper") survive.
  const collapsed: MappedChar[] = [];
  for (const ch of chars) {
    const n = collapsed.length;
    const isExtraRepeat =
      n >= 2 && collapsed[n - 1].char === ch.char && collapsed[n - 2].char === ch.char;
    if (!isExtraRepeat) collapsed.push(ch);
  }

  // Drop separators (*, _, -, .) used to break a word up.
  return collapsed.filter(({ char }) => /[a-z0-9\s]/.test(char));
}

/** Splits normalized characters on whitespace, keeping each word's input span. */
function toWords(chars: MappedChar[]): MappedWord[] {
  const words: MappedWord[] = [];
  let current: MappedChar[] = [];

  const flush = () => {
    if (current.length === 0) return;
    words.push({
      text: current.map((c) => c.char).join(""),
      start: current[0].source,
      end: current[current.length - 1].source,
    });
    current = [];
  };

  for (const ch of chars) {
    if (/\s/.test(ch.char)) flush();
    else current.push(ch);
  }
  flush();
  return words;
}

/**
 * Finds a run of 2+ adjacent words that joins into a blocked term — how a slur
 * gets past the checks above when typed as "f a g g o t" or "n igger".
 *
 * The run must consume WHOLE words. An earlier version stripped every space and
 * substring-matched the result, which flagged any word pair that happened to
 * straddle a slur — "supports picks" and "hours/pick" both contain "spic", so
 * ordinary league surveys were rejected as hate speech.
 */
function findSplitBlockedWord(words: MappedWord[]): { start: number; end: number } | null {
  for (let start = 0; start < words.length; start++) {
    let joined = words[start].text;
    for (let end = start + 1; end < words.length; end++) {
      joined += words[end].text;
      if (joined.length > LONGEST_BLOCKED_WORD) break;
      if (SPLITTABLE_SET.has(joined)) return { start, end };
    }
  }
  return null;
}

/** Input span covering normalized character range [from, to). */
function spanFor(input: string, words: MappedWord[], wordAt: number[], from: number, to: number): string {
  const covered = wordAt.slice(from, to).filter((w) => w >= 0);
  if (covered.length === 0) return input.slice(from, to);
  return input.slice(words[covered[0]].start, words[covered[covered.length - 1]].end + 1);
}

export interface BlockedMatch {
  /** The offending span, quoted verbatim from the caller's own input. */
  text: string;
  /**
   * `word`  — the term appears as a word, possibly leet-spelled ("f@ggot").
   * `split` — adjacent words run together into it ("f a g", "go ok").
   */
  kind: "word" | "split";
}

/**
 * Returns the first blocked span in `text`, or null if it's clean.
 * Checks raw, normalized (leet-speak), and whitespace-split versions.
 */
export function findBlockedContent(input: string): BlockedMatch | null {
  if (!input || input.trim().length === 0) return null;

  // 1. Raw check — the match is already a verbatim slice of the input.
  const raw = BLOCKED_REGEX.exec(input);
  if (raw) return { text: raw[0], kind: "word" };

  const words = toWords(normalizeMapped(input));

  // Join the words back into the normalized text, tracking which word each
  // character belongs to (-1 for the single spaces added between them).
  let normalized = "";
  const wordAt: number[] = [];
  words.forEach((word, index) => {
    if (index > 0) {
      normalized += " ";
      wordAt.push(-1);
    }
    normalized += word.text;
    for (let i = 0; i < word.text.length; i++) wordAt.push(index);
  });

  // 2. Normalized leet-speak check.
  const norm = BLOCKED_REGEX.exec(normalized);
  if (norm) {
    return {
      text: spanFor(input, words, wordAt, norm.index, norm.index + norm[0].length),
      kind: "word",
    };
  }

  // 3. Whitespace-split check.
  const split = findSplitBlockedWord(words);
  if (split) {
    return {
      text: input.slice(words[split.start].start, words[split.end].end + 1),
      kind: "split",
    };
  }

  return null;
}

/**
 * User-facing copy for a rejection, naming the exact span that tripped the
 * filter. Without it a cross-word match reads as the app being broken — the
 * commissioner who hit "supports picks" had no way to tell which of a
 * seven-question survey was the problem, or why.
 *
 * `subject` is the noun for what was rejected: "survey", "team name", ...
 */
export function blockedContentMessage(match: BlockedMatch, subject: string): string {
  if (match.kind === "split") {
    return `“${match.text}” was flagged in your ${subject} — run together, those words spell a term the filter blocks. Rewording will clear it.`;
  }
  return `Your ${subject} contains language that isn’t allowed: “${match.text}”.`;
}
