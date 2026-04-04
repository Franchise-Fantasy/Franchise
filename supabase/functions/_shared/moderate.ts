const VISION_API_URL = "https://vision.googleapis.com/v1/images:annotate";

const LIKELIHOOD_VALUES: Record<string, number> = {
  UNKNOWN: 0,
  VERY_UNLIKELY: 1,
  UNLIKELY: 2,
  POSSIBLE: 3,
  LIKELY: 4,
  VERY_LIKELY: 5,
};

// Block if any category is LIKELY or VERY_LIKELY
const BLOCK_THRESHOLD = 4;

interface SafeSearchResult {
  adult: string;
  violence: string;
  racy: string;
  medical: string;
}

/**
 * Run Google Cloud Vision SafeSearch on a base64-encoded image.
 * Returns { safe: true } if the image passes, or { safe: false, reason } if blocked.
 * Fails CLOSED — rejects the image if the API key is missing or the API errors.
 */
export async function moderateImage(
  base64Image: string,
): Promise<{ safe: boolean; reason?: string }> {
  const apiKey = Deno.env.get("GOOGLE_CLOUD_VISION_KEY");
  if (!apiKey) {
    console.error("GOOGLE_CLOUD_VISION_KEY not set — blocking upload");
    return { safe: false, reason: "Image moderation unavailable" };
  }

  try {
    const response = await fetch(`${VISION_API_URL}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requests: [
          {
            image: { content: base64Image },
            features: [{ type: "SAFE_SEARCH_DETECTION" }],
          },
        ],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Vision API error:", response.status, errText);
      return { safe: false, reason: "Image moderation unavailable" };
    }

    const data = await response.json();

    // Check for per-image errors (e.g. invalid key, quota exceeded)
    const imgError = data.responses?.[0]?.error;
    if (imgError) {
      console.error("Vision API image error:", JSON.stringify(imgError));
      return { safe: false, reason: "Image moderation unavailable" };
    }

    const annotation: SafeSearchResult =
      data.responses?.[0]?.safeSearchAnnotation;
    if (!annotation) {
      console.error("Vision API returned no annotation:", JSON.stringify(data));
      return { safe: false, reason: "Image moderation unavailable" };
    }

    console.log("Vision SafeSearch result:", JSON.stringify(annotation));

    for (const [category, likelihood] of Object.entries(annotation)) {
      if (category === "spoof" || category === "medical") continue;
      const level = LIKELIHOOD_VALUES[likelihood] ?? 0;
      if (level >= BLOCK_THRESHOLD) {
        return {
          safe: false,
          reason: `Image flagged for ${category} content`,
        };
      }
    }

    return { safe: true };
  } catch (err) {
    console.error("Vision API fetch error:", err);
    return { safe: false, reason: "Image moderation unavailable" };
  }
}

// ─── Text moderation ────────────────────────────────────────

// Common character substitutions used to evade filters
const CHAR_MAP: Record<string, string> = {
  "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t",
  "@": "a", "!": "i", "|": "i", "$": "s", "+": "t",
  "(": "c", "{": "c", "<": "c", "l": "i",
};

/** Normalize text: lowercase, strip accents, replace leet-speak symbols. */
function normalizeText(text: string): string {
  let out = text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  out = out.replace(/[01345@!|$+({<7l]/g, (ch) => CHAR_MAP[ch] ?? ch);
  // Collapse runs of 3+ identical chars (e.g. "nigggerr" → "nigg")
  out = out.replace(/(.)\1{2,}/g, "$1$1");
  // Strip non-alphanumeric except spaces
  out = out.replace(/[^a-z0-9\s]/g, "");
  out = out.replace(/\s+/g, " ").trim();
  return out;
}

// Slurs, hate terms, and severe profanity — post-normalization forms only.
// Leet-speak variants are handled by normalizeText(), not duplicate entries.
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

interface TextModerationResult {
  safe: boolean;
  reason?: string;
}

/**
 * Check text against a local word list + Google Perspective API.
 * Word list runs first (both raw and normalized) for instant blocking.
 * Perspective catches subtler toxicity/harassment.
 */
export async function moderateText(
  text: string,
): Promise<TextModerationResult> {
  if (!text || text.trim().length === 0) return { safe: true };

  // 1. Local word list — check raw and normalized
  const wordListResult = checkWordList(text);
  if (!wordListResult.safe) return wordListResult;

  // 2. Claude Haiku — catches subtle toxicity, harassment, threats
  const aiResult = await checkWithHaiku(text);
  return aiResult;
}

/**
 * Lightweight word-list-only check (no API call).
 * Checks both raw text and a normalized version to catch leet-speak evasion.
 */
export function checkWordList(text: string): TextModerationResult {
  if (BLOCKED_REGEX.test(text) || BLOCKED_REGEX.test(normalizeText(text))) {
    return { safe: false, reason: "Message contains prohibited language" };
  }
  return { safe: true };
}

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";

/**
 * Use Claude Haiku to check for toxicity, harassment, hate speech, threats,
 * and sexually explicit content that the word list might miss.
 * Fails open — if the API is unavailable, rely on word list + DB trigger.
 */
async function checkWithHaiku(text: string): Promise<TextModerationResult> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    console.warn("ANTHROPIC_API_KEY not set — relying on word list only");
    return { safe: true };
  }

  try {
    const response = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 20,
        messages: [
          {
            role: "user",
            content: `You are a content moderator for a fantasy basketball app chat. Respond with ONLY "block" or "allow".

Block messages that contain:
- Hate speech, slurs, or identity-based attacks (including coded/obfuscated versions)
- Serious threats of violence or harm
- Sexually explicit content
- Encouraging self-harm or suicide

Allow messages that contain:
- Trash talk, banter, mild profanity (fuck, shit, damn, etc.)
- Sports-related heated discussion
- General conversation even if rude or sarcastic

Message: "${text.replace(/"/g, '\\"')}"`,
          },
        ],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Haiku moderation error:", response.status, errText);
      return { safe: true };
    }

    const data = await response.json();
    const reply = data.content?.[0]?.text?.trim().toLowerCase() ?? "";

    if (reply.startsWith("block")) {
      console.log(`Haiku flagged message: "${text.substring(0, 50)}"`);
      return { safe: false, reason: "Message flagged for inappropriate content" };
    }

    return { safe: true };
  } catch (err) {
    console.error("Haiku moderation fetch error:", err);
    return { safe: true };
  }
}
