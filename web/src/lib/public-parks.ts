import "server-only";

import { cacheLife, cacheTag } from "next/cache";

import type { Database } from "@/lib/database.types";
import { createPublicClient } from "@/lib/supabase/public";

/**
 * Reads for the public park and metro area pages (Nov 6). Each one calls a
 * signed-out database function (public_metro_areas, public_metro, public_park,
 * public_sitemap) through the cookie-less client, so the pages only ever see
 * what a stranger may see: park facts and photos, never people.
 *
 * Cached for about an hour (`cacheLife("hours")`), so pages are built ahead
 * and refresh on a timer. "Open now" is worked out in the browser instead
 * (open-now.tsx), so a cached page never shows a stale state.
 */

type Enums = Database["public"]["Enums"];

export type PublicMetroArea = { slug: string; name: string; region: string | null; country: string; parkCount: number };

export type PublicMetroPark = {
  slug: string;
  display_name: string;
  official_name: string | null;
  city: string | null;
  status: Enums["park_status"];
  park_type: Enums["park_type"];
  setting: Enums["park_setting"] | null;
  night_lighting: boolean | null;
  is_paid: boolean | null;
  latitude: number | null;
  longitude: number | null;
  obstacle_count: number;
};

export type PublicMetro = {
  slug: string;
  name: string;
  region: string | null;
  country: string;
  timezone: string | null;
  parks: PublicMetroPark[];
};

export type PublicSession = {
  season_start_month: number | null;
  season_start_day: number | null;
  season_end_month: number | null;
  season_end_day: number | null;
  days: number[];
  start_anchor: Enums["time_anchor"] | null;
  start_time: string | null;
  end_anchor: Enums["time_anchor"] | null;
  end_time: string | null;
  disciplines: Enums["discipline"][];
};

export type PublicPark = {
  slug: string;
  display_name: string;
  official_name: string | null;
  aliases: string[];
  address: string | null;
  city: string | null;
  region: string | null;
  country: string;
  latitude: number | null;
  longitude: number | null;
  status: Enums["park_status"];
  park_type: Enums["park_type"];
  setting: Enums["park_setting"] | null;
  night_lighting: boolean | null;
  surface: string | null;
  helmet_required: boolean | null;
  is_paid: boolean | null;
  entry_fee: string | null;
  verified_at: string | null;
  updated_at: string | null;
  metro: { slug: string; name: string; timezone: string | null };
  sessions: PublicSession[];
  obstacles: { name: string; general_type: Enums["obstacle_type"]; notes: string | null }[];
  descriptions: { locale: string; body: string }[];
  photos: { storage_path: string; width: number; height: number; photographer: string; source: string; license: string }[];
  post_count: number;
};

export type SitemapRow = { kind: "metro" | "park"; slug: string; metroSlug: string; updatedAt: string | null };

export async function getMetroAreas(): Promise<PublicMetroArea[]> {
  "use cache";
  cacheLife("hours");
  cacheTag("public-parks");
  const { data, error } = await createPublicClient().rpc("public_metro_areas");
  if (error) throw error;
  return (data ?? []).map((m) => ({ slug: m.slug, name: m.name, region: m.region, country: m.country, parkCount: m.park_count }));
}

export async function getMetro(slug: string): Promise<PublicMetro | null> {
  "use cache";
  cacheLife("hours");
  cacheTag("public-parks", `metro:${slug}`);
  const { data, error } = await createPublicClient().rpc("public_metro", { metro_slug: slug });
  if (error) throw error;
  return (data as unknown as PublicMetro | null) ?? null;
}

export async function getPark(slug: string): Promise<PublicPark | null> {
  "use cache";
  cacheLife("hours");
  cacheTag("public-parks", `park:${slug}`);
  const { data, error } = await createPublicClient().rpc("public_park", { park_slug: slug });
  if (error) throw error;
  return (data as unknown as PublicPark | null) ?? null;
}

export async function getSitemap(): Promise<SitemapRow[]> {
  "use cache";
  cacheLife("hours");
  cacheTag("public-parks");
  const { data, error } = await createPublicClient().rpc("public_sitemap");
  if (error) throw error;
  return (data ?? []).map((r) => ({
    kind: r.kind === "metro" ? "metro" : "park",
    slug: r.slug,
    metroSlug: r.metro_slug,
    updatedAt: r.updated_at,
  }));
}

/** The park description in English, else the first one there is. */
export function description(park: Pick<PublicPark, "descriptions">) {
  return park.descriptions.find((d) => d.locale === "en")?.body ?? park.descriptions[0]?.body ?? null;
}

/** Public URL of a park photo (the park-media bucket is public since Nov 6). */
export function photoUrl(supabaseUrl: string, storagePath: string) {
  return `${supabaseUrl}/storage/v1/object/public/park-media/${storagePath.split("/").map(encodeURIComponent).join("/")}`;
}
