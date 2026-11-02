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

export const roleLabel: Record<AdminRole, string> = {
  owner: "Owner",
  city_admin: "City admin",
  park_admin: "Park admin",
};
