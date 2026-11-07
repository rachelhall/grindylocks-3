"use server";

import { getMyPage, type MyPage } from "@/lib/admin";
import type { Json } from "@/lib/database.types";
import { geocode, type Found } from "@/lib/geocode";
import type { rowsFromSets } from "@/lib/page-hours";
import { atLeast } from "@/lib/page-sections";
import {
  isPageLanguage,
  MAX_CLOSED_NOTE,
  MAX_DESCRIPTION,
  MAX_PAGE_LINKS,
  type PageLanguage,
  type ShopLocationType,
} from "@/lib/page-tools";
import { createClient } from "@/lib/supabase/server";

/**
 * The page sections' writes (brand and shop web tools, Nov 6). Each one
 * checks that the signed-in person is on the page's team, then calls the
 * same Postgres function the app calls, with their own session: the
 * database decides whether their role may do it. No page logic lives here.
 */

type Failure = { ok: false; error: string };
export type Result = { ok: true } | Failure;

const messages: Record<string, string> = {
  not_allowed: "Your role on this page can't change that. Ask a manager or the owner.",
  not_a_shop: "Only shops have this.",
  invalid_language: "Pick one of the languages listed.",
  too_many_links: `Up to ${MAX_PAGE_LINKS} links.`,
  invalid_link: "One of the links doesn't look like a web address. Use something like 8setstore.com.",
  too_long: "That's too long.",
  main_language_needed: "The main language needs a description. Pick another main language first.",
  invalid_logo: "The logo didn't upload. Try a square PNG.",
  invalid_pin: "The pin is off the map. Find the address again.",
  invalid_hours: "Some hours don't add up. Check each opening has a start and an end, and they aren't the same.",
  too_many: "That's more than the page can hold.",
  invalid_date: "Pick today or a later date.",
  note_needed: "Add a note for your page, like why you're closed.",
  not_a_brand: "Only brands with a page can be listed.",
  not_found: "No one on Grindylocks has that username. Check it, or invite them by email.",
  already_on_team: "They're already on the team.",
  invalid_email: "That doesn't look like an email address.",
  invalid_role: "Pick Staff or Manager.",
  too_many_invites: "There are 10 invites waiting already. Cancel one first.",
  not_on_the_team: "They aren't on the team any more.",
  suspended: "They're suspended right now, so the page can't go to them.",
};

function fail(error: { message?: string } | null | undefined, fallback = "Something went wrong. Try again."): Failure {
  console.error("page tools", error);
  return { ok: false, error: (error?.message && messages[error.message]) || fallback };
}

const NOT_ON_TEAM: Failure = { ok: false, error: "You aren't on this page's team any more. Reload the page." };

async function team(handle: string): Promise<MyPage | null> {
  return getMyPage(handle);
}

/* Details ----------------------------------------------------------------------------- */

export type DetailsInput = {
  mainLanguage: PageLanguage;
  links: string[];
  /** Only the languages that changed; an empty body takes that language off. */
  descriptions: { locale: PageLanguage; body: string }[];
};

/**
 * Description, main language and links in one go, in the order the app's
 * Edit page saves them: the main language's text first, so it's never empty
 * when the main language changes, and removals last.
 */
export async function saveDetails(handle: string, input: DetailsInput): Promise<Result> {
  const page = await team(handle);
  if (!page) return NOT_ON_TEAM;
  if (!isPageLanguage(input.mainLanguage) || input.descriptions.some((d) => !isPageLanguage(d.locale))) {
    return fail({ message: "invalid_language" });
  }
  if (input.descriptions.some((d) => d.body.trim().length > MAX_DESCRIPTION)) return fail({ message: "too_long" });
  const links = input.links.map((l) => l.trim()).filter(Boolean);
  if (links.length > MAX_PAGE_LINKS) return fail({ message: "too_many_links" });

  const supabase = await createClient();
  const ordered = [...input.descriptions].sort((a, b) =>
    a.locale === input.mainLanguage ? -1 : b.locale === input.mainLanguage ? 1 : 0,
  );
  for (const d of ordered.filter((x) => x.body.trim())) {
    const { error } = await supabase.rpc("set_page_description", { page: page.id, locale: d.locale, body: d.body });
    if (error) return fail(error);
  }
  const { error } = await supabase.rpc("update_page_details", { page: page.id, main_language: input.mainLanguage, links });
  if (error) return fail(error);
  for (const d of ordered.filter((x) => !x.body.trim())) {
    const { error: removeError } = await supabase.rpc("set_page_description", { page: page.id, locale: d.locale, body: "" });
    if (removeError) return fail(removeError);
  }
  return { ok: true };
}

/**
 * Change logo: the browser has already cropped it to a 512 px PNG (as the
 * app does). It goes into the page's own folder of `page-images`, then
 * set_page_logo points the page at it; the old file stays, like the app's.
 */
export async function saveLogo(handle: string, form: FormData): Promise<Result> {
  const page = await team(handle);
  if (!page) return NOT_ON_TEAM;
  if (!atLeast(page.role, "manager")) return fail({ message: "not_allowed" });
  const logo = form.get("logo");
  if (!(logo instanceof File) || logo.type !== "image/png" || logo.size === 0 || logo.size > 2_000_000) {
    return fail({ message: "invalid_logo" });
  }

  const supabase = await createClient();
  const path = `${page.id}/logo-${Date.now()}.png`;
  const upload = await supabase.storage.from("page-images").upload(path, logo, { contentType: "image/png" });
  if (upload.error) return fail({ message: "invalid_logo" });
  const { error } = await supabase.rpc("set_page_logo", { page: page.id, path });
  if (error) return fail(error);
  return { ok: true };
}

/* Location ---------------------------------------------------------------------------- */

export type LocationInput = {
  /** Shops only; organizers have a base without a type. */
  locationType: { value: ShopLocationType; showPin: boolean } | null;
  address: string;
  pin: { latitude: number; longitude: number } | null;
};

export async function saveLocation(handle: string, input: LocationInput): Promise<Result> {
  const page = await team(handle);
  if (!page) return NOT_ON_TEAM;
  const supabase = await createClient();

  if (input.locationType) {
    const { error } = await supabase.rpc("set_page_location_type", {
      page: page.id,
      location_type: input.locationType.value,
      show_pin: input.locationType.showPin,
    });
    if (error) return fail(error);
  }
  // Online-only shops keep no address or pin.
  const online = input.locationType?.value === "online_only";
  const { error } = await supabase.rpc("set_page_location", {
    page: page.id,
    address: online ? "" : input.address.trim(),
    // null, not undefined: the function has no defaults, and undefined drops out of the request.
    latitude: (online ? null : (input.pin?.latitude ?? null)) as number,
    longitude: (online ? null : (input.pin?.longitude ?? null)) as number,
  });
  if (error) return fail(error);
  return { ok: true };
}

/** Find on the map: only for people on a page's team, only on the button (never as they type). */
export async function findAddress(handle: string, address: string): Promise<{ ok: true; found: Found | null } | Failure> {
  const page = await team(handle);
  if (!page) return NOT_ON_TEAM;
  const query = address.trim().replace(/\s+/g, " ");
  if (query.length < 4) return { ok: false, error: "Type the street address first." };
  if (query.length > 200) return fail({ message: "too_long" });
  try {
    return { ok: true, found: await geocode(query) };
  } catch (error) {
    console.error("geocode", error);
    return { ok: false, error: "Couldn't reach the address lookup. Try again, or drag the map to place the pin." };
  }
}

/* Hours and closures ------------------------------------------------------------------- */

export async function saveHours(
  handle: string,
  input: {
    hours: ReturnType<typeof rowsFromSets> | null;
    closed: { closed: boolean; until: string | null; note: string } | null;
  },
): Promise<Result> {
  const page = await team(handle);
  if (!page) return NOT_ON_TEAM;
  const supabase = await createClient();

  if (input.closed) {
    if (input.closed.closed && input.closed.note.trim().length > MAX_CLOSED_NOTE) return fail({ message: "too_long" });
    if (input.closed.until && !/^\d{4}-\d{2}-\d{2}$/.test(input.closed.until)) return fail({ message: "invalid_date" });
    const { error } = await supabase.rpc("set_page_temp_closed", {
      page: page.id,
      closed: input.closed.closed,
      closed_until: input.closed.closed && input.closed.until ? input.closed.until : undefined,
      note: input.closed.closed ? input.closed.note.trim() : undefined,
    });
    if (error) return fail(error);
  }
  if (input.hours) {
    const { error } = await supabase.rpc("set_page_hours", { page: page.id, hours: input.hours as unknown as Json });
    if (error) return fail(error);
  }
  return { ok: true };
}

/* Brands we carry ---------------------------------------------------------------------- */

export async function saveBrands(handle: string, brandIds: string[]): Promise<Result> {
  const page = await team(handle);
  if (!page) return NOT_ON_TEAM;
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_page_brands_carried", { page: page.id, brands: brandIds });
  if (error) return fail(error);
  return { ok: true };
}

export type BrandOption = { id: string; handle: string; name: string; city: string | null; country: string | null; logoPath: string | null };

/** Search to add: brand pages only, retired brands left out, through search_pages as the app's Search does. */
export async function findBrands(handle: string, q: string): Promise<BrandOption[]> {
  const page = await team(handle);
  const query = q.trim();
  if (!page || query.length < 1 || query.length > 60) return [];
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("search_pages", { q: query, max_results: 20 });
  if (error) {
    console.error("search_pages", error);
    return [];
  }
  return data
    .filter((p) => p.roles.includes("brand") && p.state !== "out_of_business" && p.id !== page.id)
    .slice(0, 8)
    .map((p) => ({
      id: p.id,
      handle: p.handle,
      name: p.display_name,
      city: p.city,
      country: p.country,
      logoPath: p.state === "managed" ? p.logo_path : null,
    }));
}

/* Team -------------------------------------------------------------------------------- */

export async function inviteToTeam(handle: string, who: string, role: "staff" | "manager"): Promise<Result> {
  const page = await team(handle);
  if (!page) return NOT_ON_TEAM;
  const target = who.trim();
  if (!target) return { ok: false, error: "Type a username or an email address." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("invite_to_page", { page: page.id, who: target, role, language: "en" });
  if (error) return fail(error);
  return { ok: true };
}

export async function cancelInvite(handle: string, inviteId: string): Promise<Result> {
  if (!(await team(handle))) return NOT_ON_TEAM;
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_page_invite", { invite: inviteId });
  if (error) return fail(error);
  return { ok: true };
}

export async function setMemberRole(handle: string, member: string, role: "staff" | "manager"): Promise<Result> {
  const page = await team(handle);
  if (!page) return NOT_ON_TEAM;
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_page_member_role", { page: page.id, member, role });
  if (error) return fail(error);
  return { ok: true };
}

export async function removeMember(handle: string, member: string): Promise<Result> {
  const page = await team(handle);
  if (!page) return NOT_ON_TEAM;
  const supabase = await createClient();
  const { error } = await supabase.rpc("remove_page_member", { page: page.id, member });
  if (error) return fail(error);
  return { ok: true };
}

export async function offerOwnership(handle: string, member: string): Promise<Result> {
  const page = await team(handle);
  if (!page) return NOT_ON_TEAM;
  const supabase = await createClient();
  const { error } = await supabase.rpc("offer_page_ownership", { page: page.id, member });
  if (error) return fail(error);
  return { ok: true };
}

export async function unblock(handle: string, who: string): Promise<Result> {
  const page = await team(handle);
  if (!page) return NOT_ON_TEAM;
  const supabase = await createClient();
  const { error } = await supabase.rpc("unblock_from_page", { page: page.id, who });
  if (error) return fail(error);
  return { ok: true };
}

/* Inbox ------------------------------------------------------------------------------- */

/** Opening the inbox: what's there now becomes Earlier next time, and the sidebar count goes. */
export async function markInboxSeen(handle: string): Promise<void> {
  const page = await team(handle);
  if (!page) return;
  const supabase = await createClient();
  const { error } = await supabase.rpc("mark_page_inbox_seen", { page: page.id });
  if (error) console.error("mark_page_inbox_seen", error);
}
