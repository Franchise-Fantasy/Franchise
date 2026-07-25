// Central site constants — single source of truth for URL, name, socials, and
// the route list. Consumed by metadata (layout.tsx), robots.ts, sitemap.ts, the
// JSON-LD builders, and Footer, so these facts can't drift between them.

export const SITE_URL = "https://franchisefantasy.co";
export const SITE_NAME = "Franchise";
export const SITE_LEGAL_NAME = "Franchise Fantasy";
export const PUBLISHER = "chewers";
export const TAGLINE = "Own the dynasty.";

export const SITE_DESCRIPTION =
  "Dynasty-first fantasy basketball. Build, manage, and evolve a franchise over time — with every decision carrying weight across seasons.";

// The X/Twitter handle used for card attribution.
export const TWITTER_HANDLE = "@Franchise_App";

// Canonical social profiles — also emitted as schema.org `sameAs` for the
// Organization entity, so keep these in sync with the real accounts.
export const SOCIALS = {
  bluesky: "https://bsky.app/profile/franchisefantasy.bsky.social",
  tiktok: "https://www.tiktok.com/@FranchiseFantasy",
  instagram: "https://www.instagram.com/Franchise_Fantasy",
  x: "https://x.com/Franchise_App",
} as const;

export const SOCIAL_URLS = Object.values(SOCIALS);

// Every indexable route. `sitemap.ts` maps over this; add new content pages here
// as they ship so they're crawled without touching sitemap logic.
export const ROUTES = [
  { path: "/", changeFrequency: "monthly", priority: 1.0 },
  { path: "/faq", changeFrequency: "monthly", priority: 0.8 },
  { path: "/glossary", changeFrequency: "monthly", priority: 0.7 },
  { path: "/dynasty-vs-redraft", changeFrequency: "monthly", priority: 0.7 },
  { path: "/privacy", changeFrequency: "yearly", priority: 0.3 },
  { path: "/terms", changeFrequency: "yearly", priority: 0.3 },
] as const satisfies ReadonlyArray<{
  path: string;
  changeFrequency:
    | "always"
    | "hourly"
    | "daily"
    | "weekly"
    | "monthly"
    | "yearly"
    | "never";
  priority: number;
}>;
