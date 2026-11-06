import "server-only";

import type { PageRow } from "@/lib/page-tabs";
import { ago } from "@/lib/queue";
import { createClient } from "@/lib/supabase/server";

/*
 * Reads for Rachel's Pages screen and its page tools (part A, PR 6b). Every
 * one is a database function that checks for the owner role itself and says
 * not_found (P0002) to anyone else.
 */

export type { PageRow, PageTab } from "@/lib/page-tabs";
export { inTab, PAGE_TABS } from "@/lib/page-tabs";

export async function fetchAdminPages(q: string, kind: "brand" | "shop" | "organizer" | null): Promise<PageRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_pages", { q: q || undefined, kind: kind ?? undefined });
  if (error) {
    if (error.code === "P0002") return [];
    throw error;
  }
  return data.map((p) => ({
    id: p.id,
    name: p.display_name,
    handle: p.handle,
    roles: p.roles,
    state: p.state,
    place: p.city ?? p.country,
    hasLogo: p.has_logo,
    suspendedAt: p.suspended_at,
    frozen: p.frozen,
    foundedLabel: p.founded_label,
    endedLabel: p.ended_label,
    closedAt: p.closed_at,
    teamCount: p.team_count,
    owner: p.owner_username,
    followers: p.followers,
    openClaims: p.open_claims,
    matchedAlias: p.matched_alias,
  }));
}

export type TeamMember = { userId: string; username: string | null; role: "owner" | "manager" | "staff"; joinedAt: string; available: boolean };

export type HistoryEntry = {
  at: string;
  action: string;
  by: string | null;
  who: string | null;
  message: string | null;
  snapshot: Record<string, unknown> | null;
  splitFrom: boolean;
};

export type ProductGroup = { partType: string; label: string; count: number; models: number; ids: string[] };

export type PageDetail = {
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
  team: TeamMember[];
  metro: string | null;
  foundingPartnerAt: string | null;
  createdAt: string;
  suspendedAt: string | null;
  suspendedReason: string | null;
  closedAt: string | null;
  foundedLabel: string | null;
  endedLabel: string | null;
  needsTranslations: boolean;
  products: number;
  openClaims: number;
  pastClaims: number;
  activeBlocks: number;
  openReports: number;
  recentPosts: number;
  aliases: { name: string; handle: string | null; redirectUntil: string | null; formerly: boolean }[];
  handover: { username: string | null; ago: string } | null;
  productGroups: ProductGroup[];
  history: HistoryEntry[];
};

type RawDetail = {
  page: {
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
  };
  metro: string | null;
  founding_partner_at: string | null;
  created_at: string;
  suspended_at: string | null;
  suspended_reason: string | null;
  closed_at: string | null;
  founded_label: string | null;
  ended_label: string | null;
  needs_translations: boolean;
  products: number;
  open_claims: number;
  past_claims: number;
  active_blocks: number;
  open_reports: number;
  recent_posts: number;
  aliases: { name: string; handle: string | null; redirect_until: string | null; formerly: boolean }[];
  team: { user_id: string; username: string | null; role: TeamMember["role"]; joined_at: string; available: boolean }[];
  handover: { username: string | null; created_at: string } | null;
  product_groups: { part_type: string; label: string; count: number; models: number; ids: string[] }[];
  history: {
    at: string;
    action: string;
    by?: string | null;
    who?: string | null;
    message?: string | null;
    snapshot?: Record<string, unknown> | null;
    split_from?: boolean;
  }[];
};

export async function fetchAdminPageDetail(id: string): Promise<PageDetail | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_page_detail", { page: id });
  if (error) {
    if (error.code === "P0002") return null;
    throw error;
  }
  const raw = data as unknown as RawDetail;
  return {
    id: raw.page.id,
    name: raw.page.display_name,
    handle: raw.page.handle,
    roles: raw.page.roles,
    state: raw.page.state,
    city: raw.page.city,
    country: raw.page.country,
    website: raw.page.website,
    hasLogo: raw.page.has_logo,
    frozen: raw.page.frozen,
    suspended: raw.page.suspended,
    followers: raw.page.followers,
    team: raw.team.map((m) => ({ userId: m.user_id, username: m.username, role: m.role, joinedAt: m.joined_at, available: m.available })),
    metro: raw.metro,
    foundingPartnerAt: raw.founding_partner_at,
    createdAt: raw.created_at,
    suspendedAt: raw.suspended_at,
    suspendedReason: raw.suspended_reason,
    closedAt: raw.closed_at,
    foundedLabel: raw.founded_label,
    endedLabel: raw.ended_label,
    needsTranslations: raw.needs_translations,
    products: raw.products,
    openClaims: raw.open_claims,
    pastClaims: raw.past_claims,
    activeBlocks: raw.active_blocks,
    openReports: raw.open_reports,
    recentPosts: raw.recent_posts,
    aliases: raw.aliases.map((a) => ({ name: a.name, handle: a.handle, redirectUntil: a.redirect_until, formerly: a.formerly })),
    handover: raw.handover ? { username: raw.handover.username, ago: ago(raw.handover.created_at) } : null,
    productGroups: raw.product_groups.map((g) => ({ partType: g.part_type, label: g.label, count: g.count, models: g.models, ids: g.ids })),
    history: raw.history.map((h) => ({
      at: h.at,
      action: h.action,
      by: h.by ?? null,
      who: h.who ?? null,
      message: h.message ?? null,
      snapshot: h.snapshot ?? null,
      splitFrom: !!h.split_from,
    })),
  };
}
