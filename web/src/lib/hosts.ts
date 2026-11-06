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

/**
 * Public sections with pages under them (Nov 6): `/parks` (every city),
 * `/parks/<metro>` (a city's parks) and `/park/<slug>` (one park). Each public
 * prefix maps to its route prefix inside the app. Unlike SITE_PAGES, these
 * paths are also served as they are on the admin hosts, so previews and links
 * between the pages work there too.
 */
export const SITE_SECTIONS: Record<string, string> = {
  "/parks": `${SITE_PATH}/parks`,
  "/park": `${SITE_PATH}/park`,
};

/** Files every host serves to anyone: search engines read them on grindylocks.com. */
export const PUBLIC_FILES = ["/sitemap.xml", "/robots.txt"];

/** Public URL of the site, for canonical links, the sitemap and share images. */
export const SITE_ORIGIN = `https://${MARKETING_HOST}`;

function underPrefix(path: string, prefix: string) {
  return path === prefix || path.startsWith(`${prefix}/`);
}

/** The in-app route for a public path, or null if it isn't a public page. */
export function routeFor(pathname: string) {
  if (SITE_PAGES[pathname]) return SITE_PAGES[pathname];
  for (const [prefix, route] of Object.entries(SITE_SECTIONS)) {
    if (underPrefix(pathname, prefix)) return route + pathname.slice(prefix.length);
  }
  return null;
}

/** The public path for an in-app `/site` route, or null if it isn't one. */
export function publicPathFor(route: string) {
  const page = Object.entries(SITE_PAGES).find(([, r]) => r === route)?.[0];
  if (page) return page;
  for (const [prefix, sectionRoute] of Object.entries(SITE_SECTIONS)) {
    if (underPrefix(route, sectionRoute)) return prefix + route.slice(sectionRoute.length);
  }
  return null;
}

/** Is this a public section path (`/parks…`, `/park/…`) as people type it? */
export function isSectionPath(pathname: string) {
  return Object.keys(SITE_SECTIONS).some((prefix) => underPrefix(pathname, prefix));
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
