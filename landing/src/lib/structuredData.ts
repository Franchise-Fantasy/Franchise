// schema.org JSON-LD payloads, populated from the shared site config so the
// structured data can't drift from the visible metadata. Rendered via <JsonLd />.
//
// Pre-launch honesty note: Franchise is waitlist/TestFlight with no public store
// listing, so the MobileApplication schema intentionally omits `offers`,
// `downloadUrl`, and `aggregateRating`. Add those at public launch — fabricated
// price/rating fields are a Google structured-data violation.

import { features } from "@/config/features";
import {
  PUBLISHER,
  SITE_DESCRIPTION,
  SITE_LEGAL_NAME,
  SITE_NAME,
  SITE_URL,
  SOCIAL_URLS,
} from "@/config/site";

export function organizationSchema(): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: SITE_NAME,
    alternateName: SITE_LEGAL_NAME,
    url: SITE_URL,
    logo: `${SITE_URL}/logo.png`,
    description: SITE_DESCRIPTION,
    sameAs: SOCIAL_URLS,
  };
}

export function websiteSchema(): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE_NAME,
    url: SITE_URL,
    publisher: { "@type": "Organization", name: PUBLISHER },
  };
}

export function mobileApplicationSchema(): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "MobileApplication",
    name: SITE_NAME,
    applicationCategory: "SportsApplication",
    applicationSubCategory: "Fantasy Sports",
    operatingSystem: "iOS, Android",
    url: SITE_URL,
    description:
      "Dynasty-first fantasy basketball built to replicate a GM experience — real pick swaps & protections, multi-team trades, a working trade block, consistency scouting, and prospect boards. Year-round, multi-sport (NBA, WNBA).",
    featureList: features.map((f) => f.title),
    publisher: { "@type": "Organization", name: PUBLISHER },
  };
}

export function articleSchema(args: {
  headline: string;
  description: string;
  path: string;
  datePublished: string;
}): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: args.headline,
    description: args.description,
    url: `${SITE_URL}${args.path}`,
    datePublished: args.datePublished,
    author: { "@type": "Organization", name: SITE_NAME },
    publisher: {
      "@type": "Organization",
      name: SITE_NAME,
      logo: { "@type": "ImageObject", url: `${SITE_URL}/logo.png` },
    },
  };
}

export function breadcrumbSchema(
  items: { name: string; path: string }[],
): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      item: `${SITE_URL}${item.path}`,
    })),
  };
}

export function definedTermSetSchema(
  name: string,
  path: string,
  terms: { term: string; definition: string }[],
): Record<string, unknown> {
  const url = `${SITE_URL}${path}`;
  return {
    "@context": "https://schema.org",
    "@type": "DefinedTermSet",
    name,
    url,
    hasDefinedTerm: terms.map((t) => ({
      "@type": "DefinedTerm",
      name: t.term,
      description: t.definition,
      inDefinedTermSet: url,
    })),
  };
}

export function faqSchema(
  items: { question: string; answer: string }[],
): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: { "@type": "Answer", text: item.answer },
    })),
  };
}
