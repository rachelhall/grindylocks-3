import type { MetadataRoute } from "next";

import { SITE_ORIGIN } from "@/lib/hosts";
import { getSitemap } from "@/lib/public-parks";

/**
 * grindylocks.com/sitemap.xml (Nov 6): the homepage, the privacy policy, the
 * parks index, every metro area page and every park page, with the time each
 * last changed (from public_sitemap()). Refreshed about hourly with the pages.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const rows = await getSitemap();
  const latest = rows.reduce<string | null>((max, r) => (r.updatedAt && (!max || r.updatedAt > max) ? r.updatedAt : max), null);
  return [
    { url: SITE_ORIGIN, changeFrequency: "monthly", priority: 1 },
    { url: `${SITE_ORIGIN}/privacy`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${SITE_ORIGIN}/parks`, ...(latest ? { lastModified: latest } : {}), changeFrequency: "weekly", priority: 0.8 },
    ...rows.map((r) => ({
      url: r.kind === "metro" ? `${SITE_ORIGIN}/parks/${r.slug}` : `${SITE_ORIGIN}/park/${r.slug}`,
      ...(r.updatedAt ? { lastModified: r.updatedAt } : {}),
      changeFrequency: "weekly" as const,
      priority: r.kind === "metro" ? 0.7 : 0.6,
    })),
  ];
}
