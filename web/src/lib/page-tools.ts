import "server-only";

import type { Database } from "@/lib/database.types";
import type { HoursRow } from "@/lib/hours";
import { isPageLanguage, type PageLanguage } from "@/lib/page-fields";
import { createClient } from "@/lib/supabase/server";

/**
 * Reads for the brand and shop web tools (Nov 6), with the signed-in team
 * member's own session, so the database's access rules apply exactly as in
 * the app. Every write is a Server Function in
 * `app/(admin)/manage/[handle]/actions.ts` calling the same Postgres
 * functions the app's Edit page, Team and Inbox call.
 */

type Enums = Database["public"]["Enums"];
export type ShopLocationType = Enums["shop_location_type"];

export {
  isPageLanguage,
  languageName,
  MAX_CLOSED_NOTE,
  MAX_DESCRIPTION,
  MAX_OPEN_INVITES,
  MAX_PAGE_LINKS,
  PAGE_LANGUAGES,
  type PageLanguage,
} from "@/lib/page-fields";

export type CarriedBrand = { id: string; handle: string; name: string; city: string | null; country: string | null; logoPath: string | null };

export type ManagedPage = {
  id: string;
  handle: string;
  name: string;
  roles: string[];
  state: string;
  logoPath: string | null;
  suspended: boolean;
  city: string | null;
  mainLanguage: PageLanguage;
  descriptions: Partial<Record<PageLanguage, string>>;
  links: string[];
  locationType: ShopLocationType | null;
  address: string | null;
  pin: { latitude: number; longitude: number } | null;
  showPin: boolean;
  /** The shop's clock: its metro area's time zone, else the page's own. */
  timeZone: string | null;
  metro: { id: string; name: string } | null;
  hours: HoursRow[];
  tempClosed: { since: string; until: string | null; note: string } | null;
  brandsCarried: CarriedBrand[];
};

type PageRow = Database["public"]["Tables"]["pages"]["Row"] & {
  page_descriptions: { locale: string; body: string }[];
  page_links: { position: number; url: string }[];
  metro_areas: { id: string; name: string; timezone: string | null } | null;
  page_hours: HoursRow[];
  page_brands_carried: {
    position: number;
    brand: { id: string; handle: string; display_name: string; city: string | null; country: string | null; state: string; logo_path: string | null } | null;
  }[];
};

const PAGE_COLUMNS = `id, handle, display_name, roles, state, city, logo_path, suspended_at, main_language,
  temp_closed_at, temp_closed_until, temp_closed_note, location_type, address, latitude, longitude, show_pin,
  timezone, page_descriptions (locale, body), page_links (position, url),
  metro_areas (id, name, timezone),
  page_hours (id, season_start_month, season_start_day, season_end_month, season_end_day, days,
              start_anchor, start_time, end_anchor, end_time, note),
  page_brands_carried!page_brands_carried_shop_id_fkey (
    position, brand:pages!page_brands_carried_brand_id_fkey (id, handle, display_name, city, country, state, logo_path))`;

export async function fetchManagedPage(id: string): Promise<ManagedPage | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("pages").select(PAGE_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as unknown as PageRow;

  const descriptions: ManagedPage["descriptions"] = {};
  for (const d of row.page_descriptions ?? []) if (isPageLanguage(d.locale)) descriptions[d.locale] = d.body;

  return {
    id: row.id,
    handle: row.handle,
    name: row.display_name,
    roles: row.roles,
    state: row.state,
    logoPath: row.state === "managed" ? row.logo_path : null,
    suspended: Boolean(row.suspended_at),
    city: row.city,
    mainLanguage: isPageLanguage(row.main_language) ? row.main_language : "en",
    descriptions,
    links: [...(row.page_links ?? [])].sort((a, b) => a.position - b.position).map((l) => l.url),
    locationType: row.location_type,
    address: row.address,
    pin: row.latitude != null && row.longitude != null ? { latitude: row.latitude, longitude: row.longitude } : null,
    showPin: row.show_pin,
    timeZone: row.metro_areas?.timezone ?? row.timezone ?? null,
    metro: row.metro_areas ? { id: row.metro_areas.id, name: row.metro_areas.name } : null,
    hours: row.page_hours ?? [],
    tempClosed: row.temp_closed_at
      ? { since: row.temp_closed_at, until: row.temp_closed_until, note: row.temp_closed_note ?? "" }
      : null,
    // In the team's order. Retired brands are left out, as on the page.
    brandsCarried: [...(row.page_brands_carried ?? [])]
      .sort((a, b) => a.position - b.position)
      .map((b) => b.brand)
      .filter((b): b is NonNullable<typeof b> => Boolean(b) && b!.state !== "out_of_business")
      .map((b) => ({ id: b.id, handle: b.handle, name: b.display_name, city: b.city, country: b.country, logoPath: b.state === "managed" ? b.logo_path : null })),
  };
}

/* Location ----------------------------------------------------------------------------- */

/** Points for the Location section's wrong-city warning: the metro area's parks (metro areas have no outline). */
export async function fetchMetroParkPoints(metroId: string): Promise<{ latitude: number; longitude: number }[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("parks")
    .select("latitude, longitude")
    .eq("metro_area_id", metroId)
    .not("latitude", "is", null)
    .limit(500);
  if (error) throw error;
  return data.filter((p) => p.latitude != null && p.longitude != null) as { latitude: number; longitude: number }[];
}

/* Team ------------------------------------------------------------------------------------ */

export type TeamMember = { userId: string; username: string | null; role: "owner" | "manager" | "staff"; joinedAt: string; isMe: boolean };
export type TeamInvite = {
  id: string;
  kind: string;
  role: string | null;
  username: string | null;
  email: string | null;
  createdAt: string;
  expiresAt: string;
};
export type BlockedPerson = { userId: string; username: string | null; blockedAt: string; blockedBy: string | null };

const roleOrder = { owner: 0, manager: 1, staff: 2 } as const;

export async function fetchTeam(pageId: string, canSeeInvites: boolean) {
  const supabase = await createClient();
  const [team, invites, blocked] = await Promise.all([
    supabase.rpc("page_team", { page: pageId }),
    canSeeInvites ? supabase.rpc("page_team_invites", { page: pageId }) : null,
    canSeeInvites ? supabase.rpc("page_blocked_people", { page: pageId }) : null,
  ]);
  if (team.error) throw team.error;
  if (invites?.error) throw invites.error;
  if (blocked?.error) throw blocked.error;

  const members: TeamMember[] = team.data
    .map((m) => ({
      userId: m.user_id,
      username: m.username,
      role: m.role as TeamMember["role"],
      joinedAt: m.joined_at,
      isMe: m.is_me,
    }))
    .sort((a, b) => roleOrder[a.role] - roleOrder[b.role] || a.joinedAt.localeCompare(b.joinedAt));

  return {
    members,
    invites: (invites?.data ?? []).map(
      (i): TeamInvite => ({
        id: i.id,
        kind: i.kind,
        role: i.role,
        username: i.username,
        email: i.email,
        createdAt: i.created_at,
        expiresAt: i.expires_at,
      }),
    ),
    blocked: (blocked?.data ?? []).map(
      (b): BlockedPerson => ({ userId: b.user_id, username: b.username, blockedAt: b.blocked_at, blockedBy: b.blocked_by_username }),
    ),
  };
}

/* Inbox ----------------------------------------------------------------------------------- */

export type InboxKind = "caption" | "comment" | "meetup_comment" | "post_comment" | "reply";
export type InboxItem = {
  id: string;
  kind: InboxKind;
  createdAt: string;
  unread: boolean;
  /** "@mari.rolls", or another page's name when a page wrote it. */
  author: string;
  body: string | null;
  postId: string | null;
  commentId: string | null;
  eventId: string | null;
  eventTitle: string | null;
};

export async function fetchInbox(pageId: string): Promise<{ items: InboxItem[]; followers: number }> {
  const supabase = await createClient();
  const [inbox, followers] = await Promise.all([
    supabase.rpc("page_inbox", { page: pageId, max_rows: 100 }),
    supabase.rpc("page_follower_count", { page: pageId }),
  ]);
  if (inbox.error) throw inbox.error;
  if (followers.error) throw followers.error;
  return {
    followers: followers.data ?? 0,
    items: inbox.data.map((r) => {
      const page = r.author_page && typeof r.author_page === "object" ? (r.author_page as { display_name?: string }) : null;
      return {
        id: r.id,
        kind: r.kind as InboxKind,
        createdAt: r.created_at,
        unread: r.unread,
        author: page?.display_name ?? (r.author_username ? `@${r.author_username}` : "Someone"),
        body: r.body,
        postId: r.post_id,
        commentId: r.comment_id,
        eventId: r.event_id,
        eventTitle: r.event_title,
      };
    }),
  };
}

export type ThreadComment = {
  id: string;
  author: string;
  body: string | null;
  createdAt: string;
  /** Written by whoever made the post (the page itself on the page's own posts): the POSTER tag. */
  isPoster: boolean;
  highlighted: boolean;
};
export type InboxContext = {
  /** "8SET's post at Fælledparken", "@jo.blades's post", "Halloween jam". */
  title: string;
  /** "Posted Nov 3 by @freja.sk8", for the team's own posts. */
  byline: string | null;
  caption: string | null;
  comments: ThreadComment[];
  commentCount: number;
};

const THREAD_LIMIT = 30;

/**
 * The comment in context for the Inbox's detail pane: the post's caption (or
 * the meetup's title) and its comments, as the app's comment lists read them
 * (post_comments, meetup_comments), so hidden and blocked people stay out.
 * No post thumbnails on web (Rachel, Nov 6).
 */
export async function fetchInboxContext(page: { id: string; name: string }, item: InboxItem): Promise<InboxContext | null> {
  const pageId = page.id;
  const supabase = await createClient();
  const pageName = (author: unknown) =>
    author && typeof author === "object" ? (author as { display_name?: string; id?: string }) : null;

  if (item.postId) {
    const [post, comments] = await Promise.all([
      supabase.from("posts").select("id, caption, created_at, page_id, author_id, parks (display_name)").eq("id", item.postId).maybeSingle(),
      supabase.rpc("post_comments", { post: item.postId }),
    ]);
    if (post.error) throw post.error;
    if (!post.data) return null;
    const p = post.data as unknown as { caption: string | null; created_at: string; page_id: string | null; author_id: string | null; parks: { display_name: string } | null };
    const ours = p.page_id === pageId;

    let byline: string | null = null;
    let owner = "Someone";
    if (p.author_id) {
      const { data: author } = await supabase.from("profiles").select("username").eq("id", p.author_id).maybeSingle();
      if (ours) byline = `Posted ${shortDay(p.created_at)}${author?.username ? ` by @${author.username}` : ""}`;
      else if (author?.username) owner = `@${author.username}`;
    }
    const where = p.parks?.display_name ? ` at ${p.parks.display_name}` : "";
    const list = (comments.data ?? []).filter((c) => !c.deleted);
    return {
      title: `${ours ? page.name : owner}'s post${where}`,
      byline,
      caption: p.caption,
      commentCount: list.length,
      comments: list.slice(-THREAD_LIMIT).map((c) => {
        const by = pageName(c.page);
        return {
          id: c.id,
          author: by?.display_name ?? (c.username ? `@${c.username}` : "Someone"),
          body: c.body,
          createdAt: c.created_at,
          isPoster: c.is_poster,
          highlighted: c.id === item.commentId,
        };
      }),
    };
  }

  if (item.eventId) {
    const { data, error } = await supabase.rpc("meetup_comments", { event: item.eventId });
    if (error) throw error;
    const list = data.filter((c) => !c.deleted);
    return {
      title: item.eventTitle ?? "Meetup",
      byline: null,
      caption: null,
      commentCount: list.length,
      comments: list.slice(-THREAD_LIMIT).map((c) => {
        const by = pageName(c.page);
        return {
          id: c.id,
          author: by?.display_name ?? (c.username ? `@${c.username}` : "Someone"),
          body: c.body,
          createdAt: c.created_at,
          isPoster: false,
          highlighted: c.id === item.commentId,
        };
      }),
    };
  }
  return null;
}

function shortDay(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}
