/**
 * Brand and shop pages, app side (part A, PR 2: page screens).
 *
 * The rules live in the database (migrations `pages` and `page_screens`):
 * - Every signed-in member can read pages and their public details.
 * - Following, muting and blocking a page are your own rows; whether the
 *   page blocked you shows only as `canFollow: false` (page_viewer_state).
 * - Search and the @ list go through search_pages(), which matches handles,
 *   names and "Formerly" names and leaves out pages you blocked.
 * - Reports about a page go to Rachel (file_page_report); "Pretending to be
 *   a brand or shop" on a profile names the page (file_report's
 *   `impersonating`).
 * - "Suggest it" goes to Rachel's Suggested brands queue (suggest_page).
 *
 * A page's logo comes with claiming (PR 5) and its header photo with Edit
 * page (PR 7a); no page is OFFICIAL without a logo, the official signal.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { Database } from './database.types';
import type { HoursRow } from './hours';
import { fresh, keys } from './query';
import { supabase } from './supabase';

type Enums = Database['public']['Enums'];
export type PageRole = Enums['page_role'];
export type PageState = Enums['page_state'];
export type PageMemberRole = Enums['page_member_role'];

export type Page = {
  id: string;
  handle: string;
  displayName: string;
  roles: PageRole[];
  state: PageState;
  city: string | null;
  country: string | null;
  website: string | null;
  logoPath: string | null;
  /** A managed page's header photo (Edit page, PR 7a). */
  headerPath: string | null;
  foundedLabel: string | null;
  endedLabel: string | null;
  mainLanguage: string;
  managedAt: string | null;
  foundingPartnerAt: string | null;
  closedAt: string | null;
  suspendedAt: string | null;
  tempClosedAt: string | null;
  tempClosedUntil: string | null;
  tempClosedNote: string | null;
  descriptions: { locale: string; body: string }[];
  /** Up to 3, in order (managed pages; unofficial ones use `website`). */
  links: string[];
  /** "Formerly …" names, newest first. */
  formerly: string[];
  /* Shops (PR 3). Null or empty on brand pages. */
  locationType: Enums['shop_location_type'] | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  /** By-appointment shops choose whether their pin shows. */
  showPin: boolean;
  /** The shop's own clock: its metro area's time zone, else the page's. */
  timeZone: string | null;
  /** The page's metro area (Rachel sets it): needed to meet at an address (PR 9). */
  metroAreaId: string | null;
  hours: HoursRow[];
  /** "Brands we carry", by name. */
  brandsCarried: CarriedBrand[];
};

/** A brand on a shop's "Brands we carry". */
export type CarriedBrand = { id: string; handle: string; displayName: string; state: PageState; logoPath: string | null };

/** A page in Search or the @ list. */
export type PageResult = {
  id: string;
  handle: string;
  displayName: string;
  roles: PageRole[];
  state: PageState;
  city: string | null;
  country: string | null;
  logoPath: string | null;
  following: boolean;
  /** The "Formerly" name that matched, when it was neither the name nor the handle. */
  formerly: string | null;
};

export type PageViewerState = {
  following: boolean;
  muted: boolean;
  blocked: boolean;
  canFollow: boolean;
  teamRole: PageMemberRole | null;
};

/* What a page shows ----------------------------------------------------------------------- */

/**
 * What a page shows as: a shop first (8SET is a shop that also makes gear),
 * then a brand, else an organizer (Blading Camp, L.O.W. academy).
 */
export const pageKind = (p: { roles: PageRole[] }): PageRole =>
  p.roles.includes('shop') ? 'shop' : p.roles.includes('brand') ? 'brand' : 'organizer';

/** The logo is the official signal: only a managed page with a logo is OFFICIAL. */
export const isOfficial = (p: { state: PageState; logoPath: string | null }) => p.state === 'managed' && Boolean(p.logoPath);

export type Stamp = 'official' | 'unofficial' | 'retired' | 'closed' | 'inactive';

/** The stamp after the name. OFFICIAL is the only pink one; the rest are paper outlines. */
export function stampFor(p: { state: PageState; logoPath: string | null }): Stamp {
  if (p.state === 'out_of_business') return 'retired';
  if (p.state === 'closed') return 'closed';
  if (p.state === 'inactive') return 'inactive';
  return isOfficial(p) ? 'official' : 'unofficial';
}

/** Retired brands, closed shops and organizers no longer active are read-only archives. */
export const isArchive = (p: { state: PageState }) =>
  p.state === 'out_of_business' || p.state === 'closed' || p.state === 'inactive';

/**
 * Where it's from, for the tape and result lines: the city, or the country's
 * name in the viewer's language when no city is known.
 */
export function placeName(p: { city: string | null; country: string | null }, language: string): string | null {
  if (p.city) return p.city;
  if (!p.country) return null;
  try {
    return new Intl.DisplayNames([language], { type: 'region' }).of(p.country) ?? p.country;
  } catch {
    return p.country;
  }
}

/**
 * The page's description in the viewer's language if the page has it, else
 * its main language, else English.
 */
export function pageDescription(page: Pick<Page, 'descriptions' | 'mainLanguage'>, language: string): string | null {
  const pick = (locale: string) => page.descriptions.find((d) => d.locale === locale)?.body;
  return pick(language) ?? pick(page.mainLanguage) ?? pick('en') ?? page.descriptions[0]?.body ?? null;
}

/**
 * A page image (logo or header photo). Paths are in the public `page-images`
 * bucket that claiming brings (PR 5); a full URL is used as is.
 */
export function pageImageUrl(path: string | null): string | null {
  if (!path) return null;
  if (/^https?:\/\//.test(path)) return path;
  return supabase.storage.from('page-images').getPublicUrl(path).data.publicUrl;
}

/** Turns "endlessblading.com" or a full URL into something Linking can open. */
export function linkUrl(raw: string): string {
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
}

export type LinkKind = 'instagram' | 'youtube' | 'website';

export function linkKind(raw: string): LinkKind {
  const host = linkUrl(raw).replace(/^https?:\/\//i, '').split('/')[0].toLowerCase();
  if (host === 'instagram.com' || host.endsWith('.instagram.com')) return 'instagram';
  if (host === 'youtube.com' || host.endsWith('.youtube.com') || host === 'youtu.be') return 'youtube';
  return 'website';
}

/* Reads ------------------------------------------------------------------------------------- */

type PageRow = Database['public']['Tables']['pages']['Row'] & {
  page_descriptions: { locale: string; body: string }[];
  page_links: { position: number; url: string }[];
  page_aliases: { name: string; created_at: string; formerly: boolean }[];
  metro_areas: { timezone: string | null } | null;
  page_hours: HoursRow[];
  page_brands_carried: {
    position: number;
    brand: { id: string; handle: string; display_name: string; state: PageState; logo_path: string | null } | null;
  }[];
};

const PAGE_COLUMNS = `id, handle, display_name, roles, state, city, country, website, logo_path, header_path, founded_label,
  ended_label, main_language, managed_at, founding_partner_at, closed_at, suspended_at, temp_closed_at,
  temp_closed_until, temp_closed_note, page_descriptions (locale, body), page_links (position, url),
  page_aliases (name, created_at, formerly),
  location_type, address, latitude, longitude, show_pin, timezone, metro_area_id, metro_areas (timezone),
  page_hours (id, season_start_month, season_start_day, season_end_month, season_end_day, days,
              start_anchor, start_time, end_anchor, end_time, note),
  page_brands_carried!page_brands_carried_shop_id_fkey (position,
    brand:pages!page_brands_carried_brand_id_fkey (id, handle, display_name, state, logo_path))`;

function toPage(row: PageRow): Page {
  return {
    id: row.id,
    handle: row.handle,
    displayName: row.display_name,
    roles: row.roles,
    state: row.state,
    city: row.city,
    country: row.country,
    website: row.website,
    logoPath: row.logo_path,
    headerPath: row.header_path,
    foundedLabel: row.founded_label,
    endedLabel: row.ended_label,
    mainLanguage: row.main_language,
    managedAt: row.managed_at,
    foundingPartnerAt: row.founding_partner_at,
    closedAt: row.closed_at,
    suspendedAt: row.suspended_at,
    tempClosedAt: row.temp_closed_at,
    tempClosedUntil: row.temp_closed_until,
    tempClosedNote: row.temp_closed_note,
    descriptions: row.page_descriptions ?? [],
    links: [...(row.page_links ?? [])].sort((a, b) => a.position - b.position).map((l) => l.url),
    // An old name Rachel didn't keep as Formerly (PR 6b) only keeps the old handle redirecting.
    formerly: [...(row.page_aliases ?? [])]
      .filter((a) => a.formerly)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((a) => a.name)
      .filter((name, i, all) => name !== row.display_name && all.indexOf(name) === i),
    locationType: row.location_type,
    address: row.address,
    latitude: row.latitude,
    longitude: row.longitude,
    showPin: row.show_pin,
    timeZone: row.metro_areas?.timezone ?? row.timezone ?? null,
    metroAreaId: row.metro_area_id ?? null,
    hours: row.page_hours ?? [],
    // In the team's own order (set on the web, #69). Name-only brands still link (gear depends on
    // them); archives don't sell anything new.
    brandsCarried: [...(row.page_brands_carried ?? [])]
      .sort((a, b) => a.position - b.position)
      .map((b) => b.brand)
      .filter((b): b is NonNullable<typeof b> => Boolean(b) && b!.state !== 'out_of_business')
      .map((b) => ({ id: b.id, handle: b.handle, displayName: b.display_name, state: b.state, logoPath: b.logo_path })),
  };
}

/** The page a handle points at (an old handle still redirects), or null. */
export async function pageIdForHandle(handle: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('page_for_handle', { h: handle });
  if (error) throw error;
  return data ?? null;
}

async function fetchPage(handle: string): Promise<Page | null> {
  const id = await pageIdForHandle(handle);
  if (!id) return null;
  const { data, error } = await supabase.from('pages').select(PAGE_COLUMNS).eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? toPage(data as unknown as PageRow) : null;
}

/** A page by its handle (any capitals, or an old one). `null` means no page has it. */
export function usePage(handle: string | undefined) {
  return useQuery({
    queryKey: keys.page(handle ?? ''),
    queryFn: () => fetchPage(handle!),
    enabled: Boolean(handle),
    staleTime: fresh.parks,
  });
}

/** Whether a username is really a page's handle, for profile links that point at a page. */
export function usePageIdForHandle(handle: string | undefined) {
  return useQuery({
    queryKey: keys.pageHandle(handle ?? ''),
    queryFn: () => pageIdForHandle(handle!),
    enabled: Boolean(handle),
    staleTime: fresh.parks,
  });
}

export async function fetchViewerState(pageId: string): Promise<PageViewerState> {
  const { data, error } = await supabase.rpc('page_viewer_state', { page: pageId });
  if (error) throw error;
  const row = data?.[0];
  return {
    following: row?.following ?? false,
    muted: row?.muted ?? false,
    blocked: row?.blocked ?? false,
    canFollow: row?.can_follow ?? false,
    teamRole: row?.team_role ?? null,
  };
}

/** Your own follow, mute and block, so it's checked on every view. */
export function usePageViewerState(userId: string | undefined, pageId: string | undefined) {
  return useQuery({
    queryKey: keys.pageState(userId ?? '', pageId ?? ''),
    queryFn: () => fetchViewerState(pageId!),
    enabled: Boolean(userId && pageId),
    staleTime: fresh.mine,
  });
}

export async function searchPages(q: string, forMention = false, max = 20): Promise<PageResult[]> {
  const { data, error } = await supabase.rpc('search_pages', { q, for_mention: forMention, max_results: max });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id,
    handle: r.handle,
    displayName: r.display_name,
    roles: r.roles,
    state: r.state,
    city: r.city,
    country: r.country,
    logoPath: r.logo_path,
    following: r.following,
    formerly: r.formerly,
  }));
}

/** Pages for the @ list: the pages you follow with nothing typed yet, then matches. */
export const MAX_PAGE_SUGGESTIONS = 3;

export function usePageMentions(query: string | null, enabled: boolean) {
  const q = (query ?? '').toLowerCase();
  return useQuery({
    queryKey: keys.pageSearch(q, true),
    queryFn: () => searchPages(q, true, MAX_PAGE_SUGGESTIONS),
    enabled: enabled && query !== null && (q.length === 0 || q.length >= 2),
    staleTime: fresh.search,
  });
}

/* Follow, mute and block --------------------------------------------------------------------- */

/**
 * Follow, mute and block flip at once and roll back if refused. Blocking
 * also ends the follow (the database does that); unblocking doesn't bring
 * it back.
 */
export function usePageRelation(userId: string | undefined, pageId: string | undefined) {
  const client = useQueryClient();
  const key = keys.pageState(userId ?? '', pageId ?? '');
  return useMutation({
    mutationFn: async ({ what, on }: { what: 'follow' | 'mute' | 'block'; on: boolean }) => {
      if (!userId || !pageId) throw new Error('signed out');
      const table = what === 'follow' ? 'page_follows' : what === 'mute' ? 'page_mutes' : 'user_page_blocks';
      const { error } = on
        ? await supabase.from(table).insert({ user_id: userId, page_id: pageId })
        : await supabase.from(table).delete().eq('user_id', userId).eq('page_id', pageId);
      if (error && error.code !== '23505') throw error;
    },
    onMutate: async ({ what, on }) => {
      await client.cancelQueries({ queryKey: key });
      const previous = client.getQueryData<PageViewerState>(key);
      client.setQueryData<PageViewerState>(key, (s) => {
        if (!s) return s;
        if (what === 'follow') return { ...s, following: on };
        if (what === 'mute') return { ...s, muted: on };
        return { ...s, blocked: on, following: on ? false : s.following, canFollow: on ? false : s.canFollow };
      });
      return { previous };
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) client.setQueryData(key, context.previous);
    },
    onSettled: (_data, _error, { what }) => {
      void client.invalidateQueries({ queryKey: key });
      void client.invalidateQueries({ queryKey: ['page-search'] });
      // A shop you blocked leaves the map.
      if (what === 'block') void client.invalidateQueries({ queryKey: ['shops'] });
    },
  });
}

/* Reporting and suggesting -------------------------------------------------------------------- */

export type PageReportReason = Extract<
  Enums['report_reason'],
  'impersonation' | 'our_page' | 'wrong_info' | 'spam' | 'harassment' | 'other'
>;

/** The reasons, in the Page-Report mockup's order. */
export const PAGE_REPORT_REASONS: PageReportReason[] = ['impersonation', 'our_page', 'wrong_info', 'spam', 'harassment', 'other'];

export function useFilePageReport() {
  return useMutation({
    mutationFn: async ({ pageId, reason, details }: { pageId: string; reason: PageReportReason; details: string }) => {
      const { error } = await supabase.rpc('file_page_report', {
        page: pageId,
        reason,
        details: details.trim() || undefined,
      });
      if (error) throw error;
    },
  });
}

/** What a shop fix is about (Shop-Fix), in the mockup's order. */
export type PageFixField = Enums['page_fix_field'];
export const PAGE_FIX_FIELDS: PageFixField[] = ['hours', 'location_type', 'location', 'brands_carried', 'website', 'closed', 'other'];
export const MAX_PAGE_FIX = 300;

/**
 * Suggest a fix on an unofficial shop. Like a park fix, nothing changes until
 * the shop's city admin (or Rachel) checks it; the suggester hears when it's
 * live. A repeat of an open fix for the same thing is quietly accepted.
 */
export function useFilePageFix() {
  return useMutation({
    mutationFn: async ({ pageId, field, value, note }: { pageId: string; field: PageFixField; value: string; note: string }) => {
      const { error } = await supabase.rpc('file_page_fix', {
        page: pageId,
        field,
        value: field === 'closed' ? undefined : value.trim() || undefined,
        note: note.trim() || undefined,
      });
      if (error) throw error;
    },
  });
}

/** Same limits as the database. */
export const MAX_SUGGEST_NAME = 60;
export const MAX_SUGGEST_TEXT = 200;

export function useSuggestPage() {
  return useMutation({
    mutationFn: async ({ role, name, what, link }: { role: PageRole; name: string; what: string; link: string }) => {
      const { error } = await supabase.rpc('suggest_page', {
        role,
        name: name.trim(),
        what: what.trim() || undefined,
        link: link.trim() || undefined,
      });
      if (error) throw error;
    },
  });
}
