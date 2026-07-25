import type { MetadataRoute } from "next";
import { SITE_URL } from "@/config/site";

// Allow everything — there are no private routes, and we WANT AI crawlers
// (GPTBot, ClaudeBot, PerplexityBot, Google-Extended) so Franchise can be cited
// in LLM answers. Deliberately no per-bot disallow rules.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
