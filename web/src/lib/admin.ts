import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { cache } from "react";

import type { Database } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/server";

type RoleName = Database["public"]["Enums"]["role_name"];

/** The roles that may use the web admin. Park contributors use the app. */
export const ADMIN_ROLES = ["owner", "city_admin", "park_admin"] as const satisfies readonly RoleName[];
export type AdminRole = (typeof ADMIN_ROLES)[number];

export type AdminScope = {
  role: AdminRole;
  metroAreaId: string | null;
  parkId: string | null;
};

export type Admin = {
  id: string;
  username: string | null;
  /** The highest role held, for the sidebar badge: owner, then city, then park. */
  role: AdminRole;
  /** Every active admin role, each with its metro area or park. */
  scopes: AdminScope[];
};

const rank: Record<AdminRole, number> = { owner: 0, city_admin: 1, park_admin: 2 };

/**
 * The signed-in person, if they hold an active admin role; otherwise null.
 * This is the role check: admin pages (Queue, Requests, Pages, Page blocks)
 * and their Server Functions use it. Who gets past sign-in at all is
 * `getViewer()` below (admin roles or page teams, Nov 6).
 *
 * Reads with the person's own session, so the database's access rules decide
 * what comes back (members can read their own role assignments). An active
 * role is accepted and not ended, the same test as private.has_role().
 * Cached per request, so the gate and the sidebar share one lookup.
 */
export const getAdmin = cache(async (): Promise<Admin | null> => fetchAdmin(await createClient()));

/** The same lookup on a client you already have (sign-in uses the one it verified with). */
export async function fetchAdmin(supabase: SupabaseClient<Database>): Promise<Admin | null> {
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId) return null;

  const [roles, profile] = await Promise.all([
    supabase
      .from("role_assignments")
      .select("role, metro_area_id, park_id")
      .eq("user_id", userId)
      .in("role", ADMIN_ROLES)
      .not("accepted_at", "is", null)
      .is("ended_at", null),
    // Only columns members may read: profiles has column-level grants, and
    // banned_at isn't one of them (bans will end roles in the M5 functions).
    supabase.from("profiles").select("username, deleted_at").eq("id", userId).maybeSingle(),
  ]);

  if (roles.error) throw roles.error;
  if (profile.error) throw profile.error;
  if (!roles.data.length || profile.data?.deleted_at) return null;

  const scopes: AdminScope[] = roles.data
    .map((r) => ({ role: r.role as AdminRole, metroAreaId: r.metro_area_id, parkId: r.park_id }))
    .sort((a, b) => rank[a.role] - rank[b.role]);

  return { id: userId, username: profile.data?.username ?? null, role: scopes[0].role, scopes };
}

/* Page teams (brand and shop web tools, Nov 6) ---------------------------------------- */

type PageMemberRole = Database["public"]["Enums"]["page_member_role"];

/** A page the signed-in person is on the team of, from my_pages(). */
export type MyPage = {
  id: string;
  handle: string;
  name: string;
  roles: string[];
  state: string;
  /** Only a managed page's logo (my_pages() leaves the rest out). */
  logoPath: string | null;
  role: PageMemberRole;
  /** New in the page's inbox since this person last opened it. */
  inboxNew: number;
  city: string | null;
};

/**
 * Who's signed in to the web: admin role holders and anyone on a brand,
 * shop or organizer page's team (owner, manager or staff). `admin` is set for
 * role holders; `pages` lists the person's pages (admins can have them too).
 */
export type Viewer = {
  id: string;
  username: string | null;
  admin: Admin | null;
  pages: MyPage[];
};

/**
 * The door (Nov 6): the signed-in person if they hold an admin role or are
 * on a page's team; otherwise null. Cached per request, so the layout, the
 * sidebar and the page share one lookup. Reads use the person's own session.
 */
export const getViewer = cache(async (): Promise<Viewer | null> => fetchViewer(await createClient()));

/** The same lookup on a client you already have (sign-in uses the one it verified with). */
export async function fetchViewer(supabase: SupabaseClient<Database>): Promise<Viewer | null> {
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId) return null;

  const [admin, mine, profile] = await Promise.all([
    fetchAdmin(supabase),
    supabase.rpc("my_pages"),
    supabase.from("profiles").select("username, deleted_at").eq("id", userId).maybeSingle(),
  ]);
  if (mine.error) throw mine.error;
  if (profile.error) throw profile.error;
  if (profile.data?.deleted_at) return null;

  // my_pages() has no city, which the sidebar shows under each name.
  const ids = mine.data.map((p) => p.page_id);
  const cities = new Map<string, string | null>();
  if (ids.length) {
    const { data, error } = await supabase.from("pages").select("id, city").in("id", ids);
    if (error) throw error;
    for (const p of data) cities.set(p.id, p.city);
  }

  const pages: MyPage[] = mine.data.map((p) => ({
    id: p.page_id,
    handle: p.handle,
    name: p.display_name,
    roles: p.roles,
    state: p.state,
    logoPath: p.logo_path,
    role: p.role as PageMemberRole,
    inboxNew: p.inbox_new,
    city: cities.get(p.page_id) ?? null,
  }));

  if (!admin && !pages.length) return null;
  return { id: userId, username: profile.data?.username ?? null, admin, pages };
}

/**
 * The signed-in person's role on a page, by handle (any capitals), or null
 * if they aren't on its team. Every page section starts here; the database
 * still checks each action itself.
 */
export async function getMyPage(handle: string): Promise<MyPage | null> {
  const viewer = await getViewer();
  const h = handle.toLowerCase();
  return viewer?.pages.find((p) => p.handle.toLowerCase() === h) ?? null;
}

export const roleLabel: Record<AdminRole, string> = {
  owner: "Owner",
  city_admin: "City admin",
  park_admin: "Park admin",
};
