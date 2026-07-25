import type { MetadataRoute } from "next";
import { ROUTES, SITE_URL } from "@/config/site";

// Built from the shared ROUTES list so new content pages appear here just by
// being added to config/site.ts.
export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return ROUTES.map((route) => ({
    url: `${SITE_URL}${route.path}`,
    lastModified,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));
}
