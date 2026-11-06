/**
 * Limits and languages for a page's fields, shared by the web tools' server
 * reads (page-tools.ts) and their client forms. They match the database's
 * checks and the app's Edit page (src/lib/page-team.ts).
 */
/** The languages a page can write in: the app's four, in the app's order. */
export const PAGE_LANGUAGES = ["en", "es", "da", "de"] as const;
export type PageLanguage = (typeof PAGE_LANGUAGES)[number];
export const languageName: Record<PageLanguage, string> = { en: "English", es: "Español", da: "Dansk", de: "Deutsch" };
export const isPageLanguage = (v: string): v is PageLanguage => (PAGE_LANGUAGES as readonly string[]).includes(v);

export const MAX_PAGE_LINKS = 3;
export const MAX_DESCRIPTION = 300;
export const MAX_CLOSED_NOTE = 200;
export const MAX_OPEN_INVITES = 10;
