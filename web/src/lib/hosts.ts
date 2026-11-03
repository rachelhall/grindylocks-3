/**
 * One Next.js app serves two sites (Nov 2):
 * - grindylocks.com (and www): the public marketing page, `/site` in this app.
 * - admin.grindylocks.com, Vercel preview URLs and localhost: the web admin.
 *
 * `/site` also opens on the admin hosts, so the marketing page can be tried on
 * a preview before the domain points here.
 */
export const MARKETING_HOST = "grindylocks.com";
export const ADMIN_ORIGIN = "https://admin.grindylocks.com";

/** The marketing page's route inside the app. */
export const SITE_PATH = "/site";

/**
 * Public pages on grindylocks.com and their routes inside the app. Each is
 * served at its public path there, and stays public at its `/site` route on
 * the admin hosts, for previews.
 */
export const SITE_PAGES: Record<string, string> = {
  "/": SITE_PATH,
  "/privacy": `${SITE_PATH}/privacy`,
};

/** The public path for an in-app `/site` route, or null if it isn't one. */
export function publicPathFor(route: string) {
  return Object.entries(SITE_PAGES).find(([, r]) => r === route)?.[0] ?? null;
}

/** Hostname without a port, lowercased. */
function hostname(host: string | null) {
  return (host ?? "").split(":")[0].toLowerCase();
}

export function isMarketingHost(host: string | null) {
  const name = hostname(host);
  return name === MARKETING_HOST || name === `www.${MARKETING_HOST}`;
}

export function isWwwHost(host: string | null) {
  return hostname(host) === `www.${MARKETING_HOST}`;
}
