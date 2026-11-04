import "server-only";

import type { Json } from "@/lib/database.types";
import { ago } from "@/lib/queue";
import { createClient } from "@/lib/supabase/server";

/*
 * Reads for the brand and shop rows of the queue and for Page blocks (part
 * A, PR 6). Every one is a database function that checks the admin itself:
 * Rachel only, except shop fixes, which the shop's city admin also reviews.
 * A function that says not_found (P0002) means the row is gone or out of
 * scope, and the pane shows "someone already handled this".
 */

export type PageSummary = {
  id: string;
  name: string;
  handle: string;
  roles: string[];
  state: string;
  city: string | null;
  country: string | null;
  website: string | null;
  hasLogo: boolean;
  frozen: boolean;
  suspended: boolean;
  followers: number;
  team: { username: string | null; role: string }[];
};

type RawPage = {
  id: string;
  display_name: string;
  handle: string;
  roles: string[];
  state: string;
  city: string | null;
  country: string | null;
  website: string | null;
  has_logo: boolean;
  frozen: boolean;
  suspended: boolean;
  followers: number;
  team: { username: string | null; role: string }[];
};

function page(raw: RawPage): PageSummary {
  return {
    id: raw.id,
    name: raw.display_name,
    handle: raw.handle,
    roles: raw.roles,
    state: raw.state,
    city: raw.city,
    country: raw.country,
    website: raw.website,
    hasLogo: raw.has_logo,
    frozen: raw.frozen,
    suspended: raw.suspended,
    followers: raw.followers,
    team: raw.team,
  };
}

/** Runs a detail function; null when it's gone or out of scope. */
async function detail<T>(fn: string, args: Record<string, string>): Promise<T | null> {
  const supabase = await createClient();
  // The function names are fixed strings from this file.
  const { data, error } = await supabase.rpc(fn as "claim_review_detail", args as { claim: string });
  if (error) {
    if (error.code === "P0002") return null;
    throw error;
  }
  return data as unknown as T;
}

/* Claims ------------------------------------------------------------------------ */

export type ClaimDetail = {
  id: string;
  proof: "email" | "posted_code";
  roleTitle: string;
  note: string | null;
  email: string | null;
  domainMatches: boolean | null;
  emailConfirmedAt: string | null;
  postedCode: string | null;
  postedCodeExpiresAt: string | null;
  postedUrl: string | null;
  checked: boolean;
  sentAt: string;
  ago: string;
  claimant: string | null;
  page: PageSummary;
  others: { id: string; username: string | null; proof: string; domainMatches: boolean | null; ago: string }[];
};

export async function fetchClaimDetail(id: string): Promise<ClaimDetail | null> {
  const raw = await detail<{
    id: string;
    proof: "email" | "posted_code";
    role_title: string;
    note: string | null;
    email: string | null;
    email_domain_matches: boolean | null;
    email_confirmed_at: string | null;
    posted_code: string | null;
    posted_code_expires_at: string | null;
    posted_url: string | null;
    checked_at: string | null;
    sent_at: string;
    claimant: { id: string; username: string | null } | null;
    page: RawPage;
    others: { id: string; username: string | null; proof: string; email_domain_matches: boolean | null; sent_at: string }[];
  }>("claim_review_detail", { claim: id });
  if (!raw) return null;
  const now = Date.now();
  return {
    id: raw.id,
    proof: raw.proof,
    roleTitle: raw.role_title,
    note: raw.note,
    email: raw.email,
    domainMatches: raw.email_domain_matches,
    emailConfirmedAt: raw.email_confirmed_at,
    postedCode: raw.posted_code,
    postedCodeExpiresAt: raw.posted_code_expires_at,
    postedUrl: raw.posted_url,
    checked: !!raw.checked_at,
    sentAt: raw.sent_at,
    ago: ago(raw.sent_at, now),
    claimant: raw.claimant?.username ?? null,
    page: page(raw.page),
    others: raw.others.map((o) => ({
      id: o.id,
      username: o.username,
      proof: o.proof,
      domainMatches: o.email_domain_matches,
      ago: ago(o.sent_at, now),
    })),
  };
}

export type ClaimablePage = {
  id: string;
  name: string;
  handle: string;
  roles: string[];
  place: string | null;
  followers: number;
};

export async function searchClaimablePages(q: string): Promise<ClaimablePage[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("claimable_pages", { q: q.trim() || undefined, max_results: 12 });
  if (error) throw error;
  return data.map((p) => ({
    id: p.id,
    name: p.display_name,
    handle: p.handle,
    roles: p.roles,
    place: p.city ?? p.country,
    followers: Number(p.followers),
  }));
}

/* Suggested brands -------------------------------------------------------------- */

export type PageMatch = { id: string; name: string; handle: string; roles: string[]; state: string; place: string | null };

export type PageSuggestionDetail = {
  id: string;
  role: "brand" | "shop";
  name: string;
  what: string | null;
  link: string | null;
  ago: string;
  suggester: string | null;
  suggestedHandle: string | null;
  matches: PageMatch[];
  metros: { id: string; name: string; country: string | null }[];
};

export async function fetchPageSuggestionDetail(id: string): Promise<PageSuggestionDetail | null> {
  const raw = await detail<{
    id: string;
    role: "brand" | "shop";
    name: string;
    what: string | null;
    link: string | null;
    created_at: string;
    suggester: string | null;
    suggested_handle: string | null;
    matches: { id: string; display_name: string; handle: string; roles: string[]; state: string; city: string | null; country: string | null }[];
  }>("page_suggestion_review_detail", { suggestion: id });
  if (!raw) return null;
  const supabase = await createClient();
  const metros = await supabase.from("metro_areas").select("id, name, country").order("name");
  if (metros.error) throw metros.error;
  return {
    id: raw.id,
    role: raw.role,
    name: raw.name,
    what: raw.what,
    link: raw.link,
    ago: ago(raw.created_at),
    suggester: raw.suggester,
    suggestedHandle: raw.suggested_handle,
    matches: raw.matches.map((m) => ({
      id: m.id,
      name: m.display_name,
      handle: m.handle,
      roles: m.roles,
      state: m.state,
      place: m.city ?? m.country,
    })),
    metros: metros.data.map((m) => ({ id: m.id, name: m.name, country: m.country })),
  };
}

/* Product suggestions ----------------------------------------------------------- */

export type ProductSuggestionDetail = {
  id: string;
  kind: "missing_model" | "wrong_name" | "wrong_year" | "no_longer_made" | "stock_parts" | "something_else";
  value: string | null;
  partType: string | null;
  note: string | null;
  ago: string;
  suggester: string | null;
  page: { id: string; name: string; handle: string; state: string };
  product: {
    id: string;
    name: string;
    partType: string;
    family: string | null;
    entryType: string;
    edition: string | null;
    proRider: string | null;
    firstYear: string | null;
    status: string;
    includesFrame: boolean;
    brand: string | null;
    stockParts: { partType: string; brand: string; name: string }[];
  } | null;
  partTypes: string[];
};

/** The catalog's part types (public.part_types), in its order. */
const PART_TYPES = ["boot", "frame", "plate", "trucks", "deck", "wheels", "bearings", "liner", "soulplate", "toe_stop", "slide_blocks", "laces"];

export async function fetchProductSuggestionDetail(id: string): Promise<ProductSuggestionDetail | null> {
  const raw = await detail<{
    id: string;
    kind: ProductSuggestionDetail["kind"];
    value: string | null;
    part_type: string | null;
    note: string | null;
    created_at: string;
    suggester: string | null;
    page: { id: string; display_name: string; handle: string; state: string };
    product: {
      id: string;
      name: string;
      part_type: string;
      family: string | null;
      entry_type: string;
      edition: string | null;
      pro_rider: string | null;
      first_year: string | null;
      status: string;
      includes_frame: boolean;
      brand: string | null;
      stock_parts: { part_type: string; brand: string; name: string }[];
    } | null;
  }>("product_suggestion_review_detail", { suggestion: id });
  if (!raw) return null;
  const p = raw.product;
  return {
    id: raw.id,
    kind: raw.kind,
    value: raw.value,
    partType: raw.part_type,
    note: raw.note,
    ago: ago(raw.created_at),
    suggester: raw.suggester,
    page: { id: raw.page.id, name: raw.page.display_name, handle: raw.page.handle, state: raw.page.state },
    product: p && {
      id: p.id,
      name: p.name,
      partType: p.part_type,
      family: p.family,
      entryType: p.entry_type,
      edition: p.edition,
      proRider: p.pro_rider,
      firstYear: p.first_year,
      status: p.status,
      includesFrame: p.includes_frame,
      brand: p.brand,
      stockParts: p.stock_parts.map((s) => ({ partType: s.part_type, brand: s.brand, name: s.name })),
    },
    partTypes: PART_TYPES,
  };
}

/** A brand's catalog as the repo's CSV (supabase/seed/products/<handle>.csv). */
export async function catalogCsv(pageId: string): Promise<string> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("catalog_export", { page: pageId });
  if (error) throw error;
  const cols = [
    "product_id", "part_type", "model", "family", "pro_rider", "edition", "entry_type", "partner",
    "disciplines", "first_year", "status", "includes_frame", "stock_parts", "notes", "sources",
  ] as const;
  const cell = (v: string | null) => {
    const s = v ?? "";
    return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  const rows = data.map((r) => cols.map((c) => cell(r[c])).join(","));
  return [cols.join(","), ...rows].join("\n") + "\n";
}

/* Reports about a page ---------------------------------------------------------- */

export type PageReportDetail = {
  page: PageSummary;
  reports: { id: string; reason: string; details: string | null; reporter: string | null; ago: string }[];
  earlier: number;
  openClaims: number;
};

export async function fetchPageReportDetail(pageId: string): Promise<PageReportDetail | null> {
  const raw = await detail<{
    page: RawPage;
    reports: { id: string; reason: string; details: string | null; created_at: string; reporter: string | null }[];
    earlier: number;
    open_claims: number;
  }>("page_report_review_detail", { page: pageId });
  if (!raw) return null;
  const now = Date.now();
  return {
    page: page(raw.page),
    reports: raw.reports.map((r) => ({ id: r.id, reason: r.reason, details: r.details, reporter: r.reporter, ago: ago(r.created_at, now) })),
    earlier: raw.earlier,
    openClaims: raw.open_claims,
  };
}

/**
 * Profile reports that say someone is pretending to be a page: the page each
 * one names, so the pane can link the real page.
 */
export async function fetchImpersonatedPages(reportIds: string[]): Promise<Map<string, { name: string; handle: string }>> {
  if (!reportIds.length) return new Map();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("reports")
    .select("id, page:pages!reports_impersonated_page_id_fkey(display_name, handle)")
    .in("id", reportIds)
    .not("impersonated_page_id", "is", null);
  if (error) throw error;
  return new Map(
    data.flatMap((r) => (r.page ? [[r.id, { name: r.page.display_name, handle: String(r.page.handle) }] as const] : [])),
  );
}

/* Shop fixes -------------------------------------------------------------------- */

export type PageFixField = "hours" | "location_type" | "location" | "brands_carried" | "website" | "closed" | "other";

export type PageFixDetail = {
  id: string;
  field: PageFixField;
  value: string | null;
  note: string | null;
  ago: string;
  escalated: boolean;
  reporter: string | null;
  canEscalate: boolean;
  page: PageSummary;
  metro: string | null;
  current: Json | null;
};

export async function fetchPageFixDetail(id: string): Promise<PageFixDetail | null> {
  const raw = await detail<{
    id: string;
    field: PageFixField;
    value: string | null;
    note: string | null;
    created_at: string;
    escalated: boolean;
    reporter: string | null;
    can_escalate: boolean;
    page: RawPage;
    metro: string | null;
    current: Json | null;
  }>("page_fix_review_detail", { report: id });
  if (!raw) return null;
  return {
    id: raw.id,
    field: raw.field,
    value: raw.value,
    note: raw.note,
    ago: ago(raw.created_at),
    escalated: raw.escalated,
    reporter: raw.reporter,
    canEscalate: raw.can_escalate,
    page: page(raw.page),
    metro: raw.metro,
    current: raw.current,
  };
}

/* Page blocks ------------------------------------------------------------------- */

export type PageBlock = {
  id: string;
  page: { id: string; name: string; handle: string; roles: string[]; place: string | null };
  skater: string | null;
  blockedBy: string | null;
  blockedByRole: string | null;
  createdAt: string;
  ago: string;
  liftedAt: string | null;
  liftedBy: string | null;
  weekCount: number;
  flagged: boolean;
};

export async function fetchPageBlocks(lifted: boolean, pageId?: string | null): Promise<PageBlock[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_page_blocks", { lifted, page: pageId ?? undefined });
  if (error) throw error;
  const now = Date.now();
  return data.map((b) => ({
    id: b.id,
    page: { id: b.page_id, name: b.page_name, handle: b.page_handle, roles: b.page_roles, place: b.page_city ?? b.page_country },
    skater: b.skater,
    blockedBy: b.blocked_by,
    blockedByRole: b.blocked_by_role,
    createdAt: b.created_at,
    ago: ago(b.created_at, now),
    liftedAt: b.lifted_at,
    liftedBy: b.lifted_by,
    weekCount: b.week_count,
    flagged: b.flagged,
  }));
}

/** The pages Page blocks' filter offers: every page that has blocked someone. */
export async function fetchBlockingPages(): Promise<{ id: string; name: string }[]> {
  const [active, lifted] = await Promise.all([fetchPageBlocks(false), fetchPageBlocks(true)]);
  const seen = new Map<string, string>();
  for (const b of [...active, ...lifted]) seen.set(b.page.id, b.page.name);
  return [...seen].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
}

export type PageBlockDetail = {
  id: string;
  createdAt: string;
  liftedAt: string | null;
  liftedBy: string | null;
  skater: string | null;
  blockedBy: string | null;
  blockedByRole: string | null;
  page: PageSummary;
  week: { count: number; by: (string | null)[] };
  mentions: { createdAt: string; where: "comment" | "meetup_comment" | "caption"; text: string | null; deleted: boolean }[];
};

export async function fetchPageBlockDetail(id: string): Promise<PageBlockDetail | null> {
  const raw = await detail<{
    id: string;
    created_at: string;
    lifted_at: string | null;
    lifted_by: string | null;
    skater: string | null;
    blocked_by: string | null;
    blocked_by_role: string | null;
    page: RawPage;
    week: { count: number; by: (string | null)[] };
    mentions: { created_at: string; where: "comment" | "meetup_comment" | "caption"; text: string | null; deleted: boolean }[];
  }>("page_block_detail", { block: id });
  if (!raw) return null;
  return {
    id: raw.id,
    createdAt: raw.created_at,
    liftedAt: raw.lifted_at,
    liftedBy: raw.lifted_by,
    skater: raw.skater,
    blockedBy: raw.blocked_by,
    blockedByRole: raw.blocked_by_role,
    page: page(raw.page),
    week: raw.week,
    mentions: raw.mentions.map((m) => ({ createdAt: m.created_at, where: m.where, text: m.text, deleted: m.deleted })),
  };
}

/** The Page blocks nav badge: pages with more than 5 blocks this week. */
export async function countFlaggedPages(): Promise<number> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("flagged_page_count");
  if (error) throw error;
  return data;
}
