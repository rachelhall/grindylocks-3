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
