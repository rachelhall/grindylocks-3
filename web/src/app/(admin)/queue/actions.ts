"use server";

import { refresh } from "next/cache";

import { getAdmin } from "@/lib/admin";
import type { Database, Json } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/server";

export type ActionResult = { ok: true } | { ok: false; error: string };

type ObstacleType = Database["public"]["Enums"]["obstacle_type"];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The database's error codes, in words. Every action is a Postgres function
 * that checks the admin's role and scope itself; these only decide what the
 * admin reads when one says no.
 */
const messages: Record<string, string> = {
  nothing_to_review: "Someone already handled this. The queue is up to date now.",
  already_reviewed: "Someone already handled this. The queue is up to date now.",
  not_found: "This isn't in your queue any more.",
  message_required: "Write what they'll see.",
  message_too_long: "Keep the message under 500 characters.",
  suspend_1_7_or_30_days: "Pick 1, 7 or 30 days.",
  owner_only: "Only the owner can ban.",
  escalate_role_holders: "This person holds a role. Escalate it to Rachel instead.",
  not_on_yourself: "You can't act on your own account.",
  not_on_the_owner: "The owner can't be banned.",
  already_with_the_owner: "It's already with you.",
  nothing_to_hide: "There's no post or comment to hide on a person report.",
  not_allowed: "You can't do that for this park.",
  park_admins_merge: "Only park and city admins can merge obstacles.",
  park_admins_decline: "Only park and city admins can decline obstacles.",
  pick_an_obstacle_at_this_park: "Pick an obstacle this park already has.",
  name_too_long: "Keep the name under 60 characters.",
  street_plaza_is_a_placeholder: "Street plaza is a placeholder area, not an obstacle type.",
  bad_days: "Pick at least one day.",
  bad_disciplines: "Pick at least one discipline.",
  bad_description: "The description needs 1 to 2,000 characters.",
  bad_coordinates: "Those coordinates aren't on the map.",
  // Brand and shop accounts (PR 6).
  not_pending: "Someone already handled this claim. The queue is up to date now.",
  not_checked: "Tick Checked it first: find the code on the brand's own account.",
  page_taken: "Someone already runs this page. Decline this claim instead.",
  claimant_unavailable: "This person can't take the page right now (suspended, banned or gone).",
  reason_needed: "Write the reason they'll see (up to 300 characters).",
  not_claimable: "That page already has an owner, or it's frozen by a dispute.",
  invalid_email: "That doesn't look like an email address.",
  invalid_logo: "The logo didn't upload. Try a square PNG.",
  invalid_name: "The name needs 1 to 60 characters.",
  invalid_handle: "Handles are 2 to 30 letters, numbers, dots or underscores, without \"official\".",
  handle_taken: "That handle is taken by a member or another page.",
  invalid_line: "The factual line needs 1 to 300 characters.",
  invalid_country: "Use the two-letter country code (SE, DK, US).",
  invalid_pin: "Those coordinates aren't on the map.",
  invalid_metro: "Pick a metro area from the list.",
  invalid_page: "Pick a page to merge into.",
  mark_done_instead: "This one can't be applied from here. Change it by hand, then mark it done.",
  part_type_required: "Pick which part it is.",
  invalid_value: "That value doesn't fit. Check it and try again.",
  product_gone: "That product isn't in the catalog any more.",
  invalid_action: "That isn't something you can do here.",
};

function fail(error: { message: string; code?: string }, what: string): ActionResult {
  const known = messages[error.message];
  if (!known) console.error(`${what} failed`, error);
  return { ok: false, error: known ?? "Couldn't save that. Try again." };
}

async function ready(id: string): Promise<ActionResult | null> {
  if (!(await getAdmin())) return { ok: false, error: "Sign in again to do that." };
  if (!UUID.test(id)) return { ok: false, error: "This isn't in your queue any more." };
  return null;
}

export type Decision = "dismiss" | "keep_hidden" | "warn" | "suspend" | "escalate" | "ban";

/** Acts on every open report about one post, comment or person. */
export async function moderate(input: {
  target: "post" | "comment" | "person" | "meetup" | "meetup_comment";
  id: string;
  decision: Decision;
  message?: string;
  days?: 1 | 7 | 30;
  hide?: boolean;
}): Promise<ActionResult> {
  const notReady = await ready(input.id);
  if (notReady) return notReady;

  const supabase = await createClient();
  const { error } = await supabase.rpc("moderate_reports", {
    target_kind: input.target,
    target: input.id,
    decision: input.decision,
    message: input.message?.trim() || undefined,
    days: input.days,
    hide: input.hide ?? false,
  });
  if (error) return fail(error, "moderate_reports");
  refresh();
  return { ok: true };
}

/** Approves (and applies) or declines a park info report. */
export async function reviewParkInfo(input: {
  id: string;
  approve: boolean;
  value?: Json | null;
  markVerified?: boolean;
}): Promise<ActionResult> {
  const notReady = await ready(input.id);
  if (notReady) return notReady;

  const supabase = await createClient();
  const { error } = await supabase.rpc("review_park_info", {
    report: input.id,
    approve: input.approve,
    value: input.value ?? undefined,
    mark_verified: input.markVerified ?? false,
  });
  if (error) return fail(error, "review_park_info");
  refresh();
  return { ok: true };
}

/** Approves, merges or declines a suggested obstacle. */
export async function reviewObstacle(input: {
  id: string;
  decision: "approve" | "merge" | "decline";
  name?: string;
  generalType?: ObstacleType;
  mergeInto?: string;
}): Promise<ActionResult> {
  const notReady = await ready(input.id);
  if (notReady) return notReady;
  if (input.mergeInto && !UUID.test(input.mergeInto)) return { ok: false, error: "Pick an obstacle this park already has." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("review_obstacle", {
    obstacle: input.id,
    decision: input.decision,
    name: input.name?.trim() || undefined,
    general_type: input.generalType,
    merge_into: input.mergeInto,
  });
  if (error) return fail(error, "review_obstacle");
  refresh();
  return { ok: true };
}

/* Brand and shop accounts (PR 6) ------------------------------------------------------ */

/** Ticks or unticks Checked it on a posted-code claim. */
export async function setClaimChecked(input: { id: string; checked: boolean }): Promise<ActionResult> {
  const notReady = await ready(input.id);
  if (notReady) return notReady;
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_claim_checked", { claim: input.id, checked: input.checked });
  if (error) return fail(error, "set_claim_checked");
  refresh();
  return { ok: true };
}

/** Approves a claim (the claimant becomes owner) or declines it with a reason they see. */
export async function decideClaim(input: { id: string; approve: boolean; reason?: string }): Promise<ActionResult> {
  const notReady = await ready(input.id);
  if (notReady) return notReady;
  const supabase = await createClient();
  const { error } = await supabase.rpc("decide_page_claim", {
    claim: input.id,
    approve: input.approve,
    reason: input.approve ? undefined : input.reason?.trim(),
  });
  if (error) return fail(error, "decide_page_claim");
  refresh();
  return { ok: true };
}

export type ClaimablePageOption = { id: string; name: string; handle: string; roles: string[]; place: string | null; followers: number };

/** Pages Send claim invite can offer, matching what's typed. */
export async function findClaimablePages(q: string): Promise<ClaimablePageOption[]> {
  if (!(await getAdmin())) return [];
  const { searchClaimablePages } = await import("@/lib/brands");
  return searchClaimablePages(q.slice(0, 60));
}

/**
 * Rachel's claim invite: an email with an invite code that makes the person
 * the page's owner. The logo (already a 512px PNG, made in the browser) goes
 * in the page's folder of page-images first, and comes along with the invite.
 */
export async function sendClaimInvite(form: FormData): Promise<ActionResult> {
  const pageId = String(form.get("page") ?? "");
  const email = String(form.get("email") ?? "").trim();
  const logo = form.get("logo");
  const notReady = await ready(pageId);
  if (notReady) return notReady;

  const supabase = await createClient();
  let logoPath: string | undefined;
  if (logo instanceof File && logo.size > 0) {
    if (logo.type !== "image/png" || logo.size > 2_000_000) return { ok: false, error: messages.invalid_logo };
    logoPath = `${pageId}/logo-${Date.now()}.png`;
    const upload = await supabase.storage.from("page-images").upload(logoPath, logo, { contentType: "image/png" });
    if (upload.error) {
      console.error("logo upload failed", upload.error);
      return { ok: false, error: messages.invalid_logo };
    }
  }

  const { error } = await supabase.rpc("send_claim_invite", { page: pageId, email, logo: logoPath, language: "en" });
  if (error) return fail(error, "send_claim_invite");
  refresh();
  return { ok: true };
}

/** Approves a suggested brand or shop as a new Unofficial page. */
export async function approvePageSuggestion(input: {
  id: string;
  role: "brand" | "shop";
  name: string;
  handle: string;
  line: string;
  city?: string;
  country?: string;
  website?: string;
  locationType?: "storefront" | "by_appointment" | "online_only";
  address?: string;
  latitude?: number;
  longitude?: number;
  metro?: string;
}): Promise<ActionResult> {
  const notReady = await ready(input.id);
  if (notReady) return notReady;
  if (input.metro && !UUID.test(input.metro)) return { ok: false, error: messages.invalid_metro };
  const supabase = await createClient();
  const { error } = await supabase.rpc("approve_page_suggestion", {
    suggestion: input.id,
    role: input.role,
    name: input.name,
    handle: input.handle,
    line: input.line,
    city: input.city?.trim() || undefined,
    country: input.country?.trim() || undefined,
    website: input.website?.trim() || undefined,
    location_type: input.role === "shop" ? input.locationType : undefined,
    address: input.role === "shop" ? input.address?.trim() || undefined : undefined,
    latitude: input.role === "shop" ? input.latitude : undefined,
    longitude: input.role === "shop" ? input.longitude : undefined,
    metro: input.metro || undefined,
  });
  if (error) return fail(error, "approve_page_suggestion");
  refresh();
  return { ok: true };
}

/** Is this handle free (not a username, a page's handle or a held name)? */
export async function handleFree(handle: string): Promise<boolean | null> {
  if (!(await getAdmin()) || !/^[a-zA-Z0-9_.]{2,30}$/.test(handle)) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("username_available", { name: handle });
  if (error) return null;
  return data;
}

/** Merges a suggestion into an existing page, or declines it. Neither tells the suggester. */
export async function reviewPageSuggestion(input: { id: string; action: "merge" | "decline"; page?: string }): Promise<ActionResult> {
  const notReady = await ready(input.id);
  if (notReady) return notReady;
  if (input.page && !UUID.test(input.page)) return { ok: false, error: messages.invalid_page };
  const supabase = await createClient();
  const { error } = await supabase.rpc("review_page_suggestion", {
    suggestion: input.id,
    action: input.action,
    page: input.page,
  });
  if (error) return fail(error, "review_page_suggestion");
  refresh();
  return { ok: true };
}

/** Approves (with an edited value), marks done or declines a product suggestion. */
export async function reviewProductSuggestion(input: {
  id: string;
  action: "approve" | "done" | "decline";
  value?: string;
  partType?: string;
}): Promise<ActionResult> {
  const notReady = await ready(input.id);
  if (notReady) return notReady;
  const supabase = await createClient();
  const { error } = await supabase.rpc("review_product_suggestion", {
    suggestion: input.id,
    action: input.action,
    value: input.value?.trim() || undefined,
    part_type: input.partType || undefined,
  });
  if (error) return fail(error, "review_product_suggestion");
  refresh();
  return { ok: true };
}

/** A brand's catalog as the repo's CSV, to copy back before the next import. */
export async function exportCatalog(pageId: string): Promise<{ ok: true; csv: string } | { ok: false; error: string }> {
  const notReady = await ready(pageId);
  if (notReady) return notReady as { ok: false; error: string };
  try {
    const { catalogCsv } = await import("@/lib/brands");
    return { ok: true, csv: await catalogCsv(pageId) };
  } catch (error) {
    console.error("catalog_export failed", error);
    return { ok: false, error: "Couldn't export the catalog. Try again." };
  }
}

/** Closes every open report about a page: dismissed, or dealt with. */
export async function resolvePageReports(input: { pageId: string; actioned: boolean }): Promise<ActionResult> {
  const notReady = await ready(input.pageId);
  if (notReady) return notReady;
  const supabase = await createClient();
  const { error } = await supabase.rpc("resolve_page_reports", { page: input.pageId, actioned: input.actioned });
  if (error) return fail(error, "resolve_page_reports");
  refresh();
  return { ok: true };
}

/** Applies, marks done, declines or sends on a shop fix. */
export async function reviewPageFix(input: {
  id: string;
  action: "approve" | "done" | "decline" | "escalate";
  value?: string;
}): Promise<ActionResult> {
  const notReady = await ready(input.id);
  if (notReady) return notReady;
  const supabase = await createClient();
  const { error } = await supabase.rpc("review_page_fix", {
    report: input.id,
    action: input.action,
    value: input.value?.trim() || undefined,
  });
  if (error) return fail(error, "review_page_fix");
  refresh();
  return { ok: true };
}
