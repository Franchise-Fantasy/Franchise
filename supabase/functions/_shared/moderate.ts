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
 * Fails open (allows) if the API key is missing or the API errors.
 */
export async function moderateImage(
  base64Image: string,
): Promise<{ safe: boolean; reason?: string }> {
  const apiKey = Deno.env.get("GOOGLE_CLOUD_VISION_KEY");
  if (!apiKey) {
    console.warn("GOOGLE_CLOUD_VISION_KEY not set — skipping moderation");
    return { safe: true };
  }

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
    console.error("Vision API error:", errText);
    return { safe: true };
  }

  const data = await response.json();
  const annotation: SafeSearchResult =
    data.responses?.[0]?.safeSearchAnnotation;
  if (!annotation) return { safe: true };

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
}
