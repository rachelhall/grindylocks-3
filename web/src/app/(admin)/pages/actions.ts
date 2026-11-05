"use server";

import { refresh } from "next/cache";

import { isOwner } from "@/lib/access-requests";
import { getAdmin } from "@/lib/admin";
import { createClient } from "@/lib/supabase/server";

/*
 * Rachel's page tools (PR 6b). Each Server Function checks the owner role,
 * then calls the database function that does the work and logs it in the
 * page's History. Errors come back as plain sentences for the dialog.
 */

type Result<T = null> = { ok: true; value: T } | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const messages: Record<string, string> = {
  not_found: "This page isn't here any more.",
  reason_needed: "Write the reason the team sees (up to 500 characters).",
  not_managed: "Only a managed page can be suspended. An unofficial page has nobody posting as it.",
  already_suspended: "This page is already suspended.",
  not_suspended: "This page isn't suspended.",
  nobody_on_team: "Nobody is on this page's team. Use Send claim invite in the Queue's Claims tab.",
  no_such_member: "No member has that username.",
  suspended: "That member is suspended or banned, so they can't own a page.",
  already_owner: "They already own this page.",
  invalid_name: "Names are 1 to 60 characters.",
  invalid_handle: "Handles are 2 to 30 letters, numbers, dots and underscores, without \"official\".",
  handle_taken: "That handle is taken.",
  nothing_changed: "Change the name or the handle first.",
  confirm_mismatch: "Type the target's handle exactly to confirm.",
  same_page: "Pick a different page to merge into.",
  unhandled_reference: "Merging is off until a new link to pages is handled in merge_pages(). Nothing changed.",
  invalid_line: "Write the factual line (up to 300 characters).",
  invalid_country: "Use a two-letter country code, like FR or US.",
  invalid_products: "Some of those products aren't on this page any more. Reload and pick again.",
  already_closed: "This page is already an archive.",
  not_closed: "This page isn't closed.",
  invalid_years: "Years look like 2014, or c. 2024 when it's approximate.",
};

const held: Record<string, string> = {
  username: "A member has this as their username.",
  page: "Another page has this handle.",
  held: "It's held: a member's old username, or another page's old handle still redirecting.",
};

async function run<T>(name: string, args: Record<string, unknown>): Promise<Result<T>> {
  if (!isOwner(await getAdmin())) return { ok: false, error: "Only the owner can use page tools." };
  const supabase = await createClient();
  // The function names are fixed strings from this file.
  const { data, error } = await supabase.rpc(name as "suspend_page", args as never);
  if (error) {
    if (error.message === "handle_taken" && error.details && held[error.details]) return { ok: false, error: held[error.details] };
    const known = messages[error.message] ?? (error.code === "P0002" ? messages.not_found : null);
    if (!known) console.error(`${name} failed`, error);
    return { ok: false, error: known ?? "Couldn't do that. Try again." };
  }
  refresh();
  return { ok: true, value: data as T };
}

function badId(...ids: (string | null | undefined)[]): Result<never> | null {
  return ids.every((id) => !id || UUID.test(id)) ? null : { ok: false, error: messages.not_found };
}

export async function suspendPage(page: string, reason: string, hideRecent: boolean): Promise<Result<number>> {
  return badId(page) ?? run<number>("suspend_page", { page, reason, hide_recent: hideRecent, cancel_meetups: false });
}

export async function liftSuspension(page: string): Promise<Result<number>> {
  return badId(page) ?? run<number>("lift_page_suspension", { page });
}

export async function transferPage(input: {
  page: string;
  newOwner: string | null;
  username: string | null;
  oldOwnerStays: boolean;
  note: string;
}): Promise<Result<string>> {
  return (
    badId(input.page, input.newOwner) ??
    run<string>("admin_transfer_page", {
      page: input.page,
      new_owner: input.newOwner ?? undefined,
      username: input.newOwner ? undefined : (input.username ?? undefined),
      old_owner_stays: input.oldOwnerStays,
      note: input.note.trim() || undefined,
    })
  );
}

/** The live handle check: ok, invalid, official, username, page or held. */
export async function checkHandle(handle: string, page: string | null): Promise<string> {
  if (!isOwner(await getAdmin())) return "invalid";
  if (page && !UUID.test(page)) return "invalid";
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_handle_check", { handle, page: page ?? undefined });
  if (error) {
    console.error("admin_handle_check failed", error);
    return "error";
  }
  return data;
}

export async function renamePage(page: string, name: string, handle: string, keepFormerly: boolean): Promise<Result> {
  return badId(page) ?? run<null>("admin_rename_page", { page, display_name: name, handle, keep_formerly: keepFormerly });
}

export type MergeOption = { id: string; name: string; handle: string; roles: string[]; state: string; place: string | null };

/** Pages to merge into: by name, handle or old name. */
export async function findPages(q: string, except: string): Promise<MergeOption[]> {
  if (!isOwner(await getAdmin())) return [];
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_pages", { q: q.trim() || undefined });
  if (error) {
    console.error("admin_pages failed", error);
    return [];
  }
  return data
    .filter((p) => p.id !== except)
    .slice(0, 12)
    .map((p) => ({ id: p.id, name: p.display_name, handle: p.handle, roles: p.roles, state: p.state, place: p.city ?? p.country }));
}

export type MergePreview = {
  followers: number;
  followersBoth: number;
  mentions: number;
  carriedBy: number;
  collabs: number;
  posts: number;
  products: number;
  clashes: number;
  openClaims: number;
  openReports: number;
  activeBlocks: number;
  sourceTeam: number;
  unhandled: string[];
};

export async function previewMerge(source: string, target: string): Promise<Result<MergePreview>> {
  const bad = badId(source, target);
  if (bad) return bad;
  if (!isOwner(await getAdmin())) return { ok: false, error: "Only the owner can use page tools." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("merge_preview", { source, target });
  if (error) return { ok: false, error: messages[error.message] ?? "Couldn't load the preview. Try again." };
  const j = data as Record<string, number | string[]>;
  const n = (k: string) => Number(j[k] ?? 0);
  return {
    ok: true,
    value: {
      followers: n("followers"),
      followersBoth: n("followers_both"),
      mentions: n("mentions"),
      carriedBy: n("carried_by"),
      collabs: n("collabs"),
      posts: n("posts"),
      products: n("products"),
      clashes: n("clashes"),
      openClaims: n("open_claims"),
      openReports: n("open_reports"),
      activeBlocks: n("active_blocks"),
      sourceTeam: n("source_team"),
      unhandled: (j.unhandled as string[]) ?? [],
    },
  };
}

export async function mergePages(source: string, target: string, confirm: string): Promise<Result> {
  const res = badId(source, target) ?? (await run<unknown>("merge_pages", { source, target, confirm }));
  return res.ok ? { ok: true, value: null } : res;
}

export async function splitPage(input: {
  page: string;
  name: string;
  handle: string;
  role: "brand" | "shop";
  line: string;
  city: string;
  country: string;
  products: string[];
}): Promise<Result<string>> {
  if (input.products.some((id) => !UUID.test(id))) return { ok: false, error: messages.invalid_products };
  return (
    badId(input.page) ??
    run<string>("split_page", {
      page: input.page,
      name: input.name,
      handle: input.handle,
      role: input.role,
      line: input.line,
      city: input.city.trim() || undefined,
      country: input.country.trim() || undefined,
      products: input.products,
    })
  );
}

export async function closePage(page: string, founded: string, ended: string): Promise<Result<string>> {
  return badId(page) ?? run<string>("admin_close_page", { page, founded: founded.trim() || undefined, ended: ended.trim() || undefined });
}

export async function reopenPage(page: string): Promise<Result<string>> {
  return badId(page) ?? run<string>("reopen_page", { page });
}
