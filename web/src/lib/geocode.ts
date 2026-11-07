import "server-only";

import { cacheLife } from "next/cache";

/**
 * Find on the map (Nov 6, Rachel's option 2): looks an address up with
 * OpenStreetMap's Nominatim, always from our own server, never the browser,
 * following its usage policy:
 * - at most one request a second (a queue per server instance, on top of
 *   the cache, since only page teams can ask and only by pressing Find);
 * - the app named in every request (User-Agent with a contact address);
 * - answers kept (`use cache`, for weeks), so the same address is never
 *   asked twice;
 * - no search-as-you-type: the Location section only calls this on Find.
 * Swap for a hosted lookup (MapTiler or Stadia) with the public pages' tile
 * swap if matches miss or traffic grows; nothing else needs to change.
 */
const USER_AGENT = "Grindylocks/1.0 (https://grindylocks.com; support@grindylocks.com)";
const MIN_GAP_MS = 1100;

export type Found = { latitude: number; longitude: number; label: string };

let lastRequest = 0;
let queue: Promise<void> = Promise.resolve();

/** Waits its turn so requests from this server are at least a second apart. */
function turn(): Promise<void> {
  queue = queue.then(async () => {
    const wait = lastRequest + MIN_GAP_MS - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    lastRequest = Date.now();
  });
  return queue;
}

/** The best match for an address, or null when Nominatim has none. Throws when it can't be reached. */
export async function geocode(query: string): Promise<Found | null> {
  "use cache";
  cacheLife("weeks");

  await turn();
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, "Accept-Language": "en" },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Nominatim answered ${res.status}`);
  const [hit] = (await res.json()) as { lat: string; lon: string; display_name: string }[];
  if (!hit) return null;
  const latitude = Number(hit.lat);
  const longitude = Number(hit.lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return { latitude, longitude, label: hit.display_name };
}
