import "server-only";

import type { Admin } from "@/lib/admin";
import type { Database } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/server";

export type Discipline = Database["public"]["Enums"]["discipline"];

/** One request as the Requests page shows it. */
export type AccessRequest = {
  id: string;
  email: string;
  homeCity: string | null;
  /** The city grouped the way the By city panel groups it; null when none was given. */
  cityKey: string | null;
  /** Whether that city matches a metro area with parks in the directory. */
  cityHasParks: boolean;
  disciplines: Discipline[];
  createdAt: string;
  /** "40 min", "3 h", "2 d": worked out on the server so it renders the same on both sides. */
  ago: string;
  invitedAt: string | null;
  /** How long ago they were marked invited, like `ago`; null while not invited. */
  invitedAgo: string | null;
  /** When the owner dismissed it; null while it isn't dismissed. */
  dismissedAt: string | null;
  /** How long ago it was dismissed, like `ago`; null while not dismissed. */
  dismissedAgo: string | null;
};

/** Only the owner sees requests (the table's access rules say the same). */
export function isOwner(admin: Admin | null): admin is Admin {
  return !!admin?.scopes.some((s) => s.role === "owner");
}

/**
 * Groups cities as typed, ignoring case, extra spaces and anything after a
 * comma, so "San Diego", " san diego " and "San Diego, CA" count as one.
 */
export function cityKey(city: string | null): string | null {
  const key = city?.split(",")[0].trim().replace(/\s+/g, " ").toLowerCase();
  return key ? key : null;
}

function ago(iso: string, now: number): string {
  const minutes = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000));
  if (minutes < 60) return `${Math.max(1, minutes)} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h`;
  return `${Math.floor(hours / 24)} d`;
}

/**
 * Every request, newest first, with the signed-in owner's own session (no
 * service-role key). Requests are rate-limited at 100 an hour, so the whole
 * list is small enough to filter in the browser.
 */
export async function fetchAccessRequests(): Promise<AccessRequest[]> {
  const supabase = await createClient();
  const [requests, metroAreas] = await Promise.all([
    supabase
      .from("access_requests")
      .select("id, email, home_city, disciplines, created_at, invited_at, dismissed_at")
      .order("created_at", { ascending: false }),
    supabase.rpc("welcome_metro_areas"),
  ]);
  if (requests.error) throw requests.error;
  if (metroAreas.error) throw metroAreas.error;

  const withParks = new Set(metroAreas.data.map((m) => cityKey(m.name)));
  const now = Date.now();

  return requests.data.map((r) => {
    const key = cityKey(r.home_city);
    return {
      id: r.id,
      email: r.email,
      homeCity: r.home_city,
      cityKey: key,
      cityHasParks: key !== null && withParks.has(key),
      disciplines: r.disciplines,
      createdAt: r.created_at,
      ago: ago(r.created_at, now),
      invitedAt: r.invited_at,
      invitedAgo: r.invited_at ? ago(r.invited_at, now) : null,
      dismissedAt: r.dismissed_at,
      dismissedAgo: r.dismissed_at ? ago(r.dismissed_at, now) : null,
    };
  });
}

/** How many requests are waiting for an invite (not invited, not dismissed), for the sidebar badge. */
export async function countNotInvited(): Promise<number> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("access_requests")
    .select("id", { count: "exact", head: true })
    .is("invited_at", null)
    .is("dismissed_at", null);
  if (error) throw error;
  return count ?? 0;
}

/** When the signed-in person last opened the Requests page; null the first time. */
export async function fetchRequestsSeenAt(userId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("admin_seen")
    .select("seen_at")
    .eq("user_id", userId)
    .eq("page", "access_requests")
    .maybeSingle();
  if (error) throw error;
  return data?.seen_at ?? null;
}
