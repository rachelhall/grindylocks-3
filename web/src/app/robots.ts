import type { MetadataRoute } from "next";

import { SITE_ORIGIN } from "@/lib/hosts";

/**
 * robots.txt (Nov 6). Crawlers may read the public pages; the admin's paths
 * are listed so they're skipped, and every page on the admin's hosts also
 * carries `X-Robots-Tag: noindex` (next.config.ts).
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/site", "/sign-in", "/queue", "/requests", "/pages", "/page-blocks"],
    },
    sitemap: `${SITE_ORIGIN}/sitemap.xml`,
    host: SITE_ORIGIN,
  };
}
