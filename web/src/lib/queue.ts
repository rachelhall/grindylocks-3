import "server-only";

import type { Admin } from "@/lib/admin";
import type { Database, Json } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/server";

export type ObstacleType = Database["public"]["Enums"]["obstacle_type"];
export type ParkField = Database["public"]["Enums"]["park_field"];
export type Discipline = Database["public"]["Enums"]["discipline"];

export type QueueKind =
  | "report"
  | "park_info"
  | "obstacle"
  // Rachel only (brand and shop accounts, PR 6):
  | "claim"
  | "page_suggestion"
  | "product_suggestion"
  | "page_report"
  // The shop's city admin, with Rachel as backup:
  | "shop_fix";

/** Every kind but reports has one row per thing, keyed by its own id. */
const SIMPLE_KINDS: QueueKind[] = ["park_info", "obstacle", "claim", "page_suggestion", "product_suggestion", "page_report", "shop_fix"];
export type ReportTarget = "post" | "comment" | "person" | "meetup" | "meetup_comment";
export type QueueState = "sent_to_you" | "auto_hidden" | "hidden" | "open";

/** One row of the queue, from moderation_queue(). */
export type QueueItem = {
  /** Stable key for the URL and keyboard moves: "report:post:<id>", "park_info:<id>", "obstacle:<id>". */
  key: string;
  kind: QueueKind;
  id: string;
  /** report: post, comment, person, meetup or meetup_comment. park_info: the field. obstacle: its type. */
  target: string;
  reportCount: number;
  reason: string | null;
  /** report: the reported person. park_info: the reporter. obstacle: who suggested it. */
  username: string | null;
  /** obstacle: its suggested name. park_info about an obstacle: that obstacle's name. A reported meetup: its title or line. */
  label: string | null;
  parkName: string | null;
  parkSlug: string | null;
  metroAreaId: string | null;
  metroName: string | null;
  state: QueueState;
  latestAt: string;
  /** "2 h", "1 d", worked out on the server so it renders the same on both sides. */
  ago: string;
  /**
   * Brand and shop rows: the page (for a suggested brand, the closest existing
   * one). flag: claim = the email's domain matches; page_suggestion = there's a
   * possible match; product_suggestion = it can be applied from the queue;
   * shop_fix = a city admin sent it on to Rachel.
   */
  page: { id: string; name: string; handle: string; roles: string[]; place: string | null } | null;
  flag: boolean | null;
};

export function ago(iso: string, now = Date.now()): string {
  const minutes = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000));
  if (minutes < 60) return `${Math.max(1, minutes)} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h`;
  return `${Math.floor(hours / 24)} d`;
}

export function itemKey(kind: QueueKind, target: string, id: string): string {
  return kind === "report" ? `report:${target}:${id}` : `${kind}:${id}`;
}

/** Parses an item key from the URL; null if it isn't one. */
export function parseItemKey(
  key: string | undefined,
): { kind: "report"; target: ReportTarget; id: string } | { kind: Exclude<QueueKind, "report">; id: string } | null {
  if (!key) return null;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const parts = key.split(":");
  if (parts[0] === "report" && parts.length === 3 && ["post", "comment", "person", "meetup", "meetup_comment"].includes(parts[1]) && uuid.test(parts[2])) {
    return { kind: "report", target: parts[1] as ReportTarget, id: parts[2] };
  }
  if (SIMPLE_KINDS.includes(parts[0] as QueueKind) && parts.length === 2 && uuid.test(parts[1])) {
    return { kind: parts[0] as Exclude<QueueKind, "report">, id: parts[1] };
  }
  return null;
}

/**
 * Everything waiting for the signed-in admin, newest first. The database
 * decides what's in scope (and what's "Sent to you"), with the admin's own
 * session. `metro` narrows it to one metro area.
 */
export async function fetchQueue(metro?: string | null): Promise<QueueItem[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("moderation_queue", metro ? { metro } : {});
  if (error) throw error;
  const now = Date.now();
  return data.map((r) => ({
    key: itemKey(r.kind as QueueKind, r.target, r.id),
    kind: r.kind as QueueKind,
    id: r.id,
    target: r.target,
    reportCount: r.report_count,
    reason: r.reason,
    username: r.username,
    label: r.label,
    parkName: r.park_name,
    parkSlug: r.park_slug,
    metroAreaId: r.metro_area_id,
    metroName: r.metro_name,
    state: r.state as QueueState,
    latestAt: r.latest_at,
    ago: ago(r.latest_at, now),
    page: r.page_id
      ? { id: r.page_id, name: r.page_name ?? "", handle: r.page_handle ?? "", roles: r.page_roles ?? [], place: r.page_place }
      : null,
    flag: r.flag,
  }));
}

/** How many things are waiting, for the sidebar badge. */
export async function countQueue(): Promise<number> {
  return (await fetchQueue()).length;
}

/**
 * The metro areas the area filter offers: the admin's own areas (from their
 * roles; the owner gets every metro area).
 */
export async function fetchAreas(admin: Admin): Promise<{ id: string; name: string }[]> {
  const supabase = await createClient();
  if (admin.scopes.some((s) => s.role === "owner")) {
    const { data, error } = await supabase.from("metro_areas").select("id, name").order("name");
    if (error) throw error;
    return data;
  }
  const metroIds = admin.scopes.map((s) => s.metroAreaId).filter((id): id is string => !!id);
  const parkIds = admin.scopes.map((s) => s.parkId).filter((id): id is string => !!id);
  const parkMetros = parkIds.length
    ? await supabase.from("parks").select("metro_area_id").in("id", parkIds)
    : { data: [], error: null };
  if (parkMetros.error) throw parkMetros.error;
  const ids = [...new Set([...metroIds, ...parkMetros.data.map((p) => p.metro_area_id).filter((id): id is string => !!id)])];
  if (!ids.length) return [];
  const { data, error } = await supabase.from("metro_areas").select("id, name").in("id", ids).order("name");
  if (error) throw error;
  return data;
}

/* Report detail ------------------------------------------------------------------- */

export type Slide = {
  kind: "photo" | "video";
  /** A signed URL for photos (an hour); a Stream thumbnail for clips when the customer code is set. */
  imageUrl: string | null;
  width: number | null;
  height: number | null;
  durationS: number | null;
};

export type ReportDetail = {
  target: ReportTarget;
  id: string;
  post: {
    id: string;
    caption: string | null;
    status: string;
    createdAt: string;
    author: string | null;
    park: { name: string; slug: string; metro: string | null } | null;
    slides: Slide[];
  } | null;
  comment: { id: string; body: string; createdAt: string; deleted: boolean; author: string | null } | null;
  /** A reported meetup date, or the date a reported meetup comment is on. */
  meetup: {
    id: string;
    title: string | null;
    note: string | null;
    startsAt: string;
    endsAt: string;
    timezone: string | null;
    status: string;
    cancelReason: string | null;
    hidden: boolean;
    visibility: string;
    host: string | null;
    park: { name: string; slug: string; metro: string | null } | null;
  } | null;
  reports: { id: string; reason: string; details: string | null; status: string; reporter: string | null; ago: string }[];
  person: {
    id: string;
    username: string | null;
    deleted: boolean;
    joinedAt: string;
    invitedBy: string | null;
    postCount: number;
    earlierReports: number;
    earlierDismissed: number;
    warnings: number;
    suspensions: number;
    suspendedUntil: string | null;
    banned: boolean;
    holdsRole: boolean;
  } | null;
  canBan: boolean;
  canEscalate: boolean;
  /**
   * PR 8b: the page a reported post or comment was made as (there's no
   * person to warn or suspend), the page whose post a reported comment is on,
   * and, for Rachel only, the team member who made it.
   */
  page: { name: string; handle: string; isShop: boolean } | null;
  postPage: { name: string; handle: string } | null;
  madeBy: string | null;
  /**
   * PR 9b: a meetup report reaches every stop's park admins. Admins of a stop
   * only (not the start) can only hide it at their park; the reports stay
   * open for the start's admins.
   */
  stopOnly: boolean;
};

type RawReportDetail = {
  post: {
    id: string;
    caption: string | null;
    status: string;
    created_at: string;
    author: string | null;
    park: { name: string; slug: string; metro: string | null } | null;
    slides: {
      kind: "photo" | "video";
      storage_path: string | null;
      stream_video_id: string | null;
      width: number | null;
      height: number | null;
      duration_s: number | null;
    }[];
  } | null;
  comment: { id: string; body: string; created_at: string; deleted: boolean; author: string | null } | null;
  meetup?: {
    id: string;
    title: string | null;
    note: string | null;
    starts_at: string;
    ends_at: string;
    timezone: string | null;
    status: string;
    cancel_reason: string | null;
    hidden: boolean;
    visibility: string;
    host: string | null;
    park: { name: string; slug: string; metro: string | null } | null;
  } | null;
  reports: { id: string; reason: string; details: string | null; status: string; created_at: string; reporter: string | null }[];
  person: {
    id: string;
    username: string | null;
    deleted: boolean;
    joined_at: string;
    invited_by: string | null;
    post_count: number;
    earlier_reports: number;
    earlier_dismissed: number;
    warnings: number;
    suspensions: number;
    suspended_until: string | null;
    banned: boolean;
    holds_role: boolean;
  } | null;
  can_ban: boolean;
  can_escalate: boolean;
  page?: { display_name: string; handle: string; roles: string[] } | null;
  post_page?: { display_name: string; handle: string } | null;
  made_by?: string | null;
  stop_only?: boolean;
};

function streamThumbnail(videoId: string | null): string | null {
  const code = process.env.NEXT_PUBLIC_CLOUDFLARE_STREAM_CUSTOMER_CODE;
  if (!code || !videoId) return null;
  return `https://customer-${code}.cloudflarestream.com/${videoId}/thumbnails/thumbnail.jpg?height=640`;
}

/** One report group, or null if it's gone (handled by someone else) or out of scope. */
export async function fetchReportDetail(target: ReportTarget, id: string): Promise<ReportDetail | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("moderation_report_detail", { target_kind: target, target: id });
  if (error) {
    if (error.code === "P0002") return null;
    throw error;
  }
  const raw = data as unknown as RawReportDetail;
  const now = Date.now();

  let slides: Slide[] = [];
  if (raw.post) {
    const photoPaths = raw.post.slides.filter((s) => s.kind === "photo" && s.storage_path).map((s) => s.storage_path!);
    const signed = photoPaths.length
      ? await supabase.storage.from("post-media").createSignedUrls(photoPaths, 3600)
      : { data: [], error: null };
    const urls = new Map((signed.data ?? []).map((s) => [s.path, s.signedUrl]));
    slides = raw.post.slides.map((s) => ({
      kind: s.kind,
      imageUrl: s.kind === "photo" ? (s.storage_path ? (urls.get(s.storage_path) ?? null) : null) : streamThumbnail(s.stream_video_id),
      width: s.width,
      height: s.height,
      durationS: s.duration_s,
    }));
  }

  return {
    target,
    id,
    post: raw.post && {
      id: raw.post.id,
      caption: raw.post.caption,
      status: raw.post.status,
      createdAt: raw.post.created_at,
      author: raw.post.author,
      park: raw.post.park,
      slides,
    },
    comment: raw.comment && {
      id: raw.comment.id,
      body: raw.comment.body,
      createdAt: raw.comment.created_at,
      deleted: raw.comment.deleted,
      author: raw.comment.author,
    },
    meetup: raw.meetup
      ? {
          id: raw.meetup.id,
          title: raw.meetup.title,
          note: raw.meetup.note,
          startsAt: raw.meetup.starts_at,
          endsAt: raw.meetup.ends_at,
          timezone: raw.meetup.timezone,
          status: raw.meetup.status,
          cancelReason: raw.meetup.cancel_reason,
          hidden: raw.meetup.hidden,
          visibility: raw.meetup.visibility,
          host: raw.meetup.host,
          park: raw.meetup.park,
        }
      : null,
    reports: raw.reports.map((r) => ({
      id: r.id,
      reason: r.reason,
      details: r.details,
      status: r.status,
      reporter: r.reporter,
      ago: ago(r.created_at, now),
    })),
    person: raw.person && {
      id: raw.person.id,
      username: raw.person.username,
      deleted: raw.person.deleted,
      joinedAt: raw.person.joined_at,
      invitedBy: raw.person.invited_by,
      postCount: raw.person.post_count,
      earlierReports: raw.person.earlier_reports,
      earlierDismissed: raw.person.earlier_dismissed,
      warnings: raw.person.warnings,
      suspensions: raw.person.suspensions,
      suspendedUntil: raw.person.suspended_until,
      banned: raw.person.banned,
      holdsRole: raw.person.holds_role,
    },
    canBan: raw.can_ban,
    canEscalate: raw.can_escalate,
    page: raw.page ? { name: raw.page.display_name, handle: raw.page.handle, isShop: raw.page.roles.includes("shop") } : null,
    postPage: raw.post_page ? { name: raw.post_page.display_name, handle: raw.post_page.handle } : null,
    madeBy: raw.made_by ?? null,
    stopOnly: Boolean(raw.stop_only),
  };
}

/* Park info detail ------------------------------------------------------------------ */

export type ParkInfoDetail = {
  id: string;
  field: ParkField;
  status: string;
  suggested: Json | null;
  note: string | null;
  photoUrl: string | null;
  ago: string;
  reporter: string | null;
  obstacle: { id: string; name: string; general_type: ObstacleType } | null;
  park: { id: string; name: string; slug: string; verified_at: string | null; can_verify: boolean };
  current: Json | null;
};

export async function fetchParkInfoDetail(id: string): Promise<ParkInfoDetail | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("park_info_review_detail", { report: id });
  if (error) {
    if (error.code === "P0002") return null;
    throw error;
  }
  const raw = data as unknown as {
    id: string;
    field: ParkField;
    status: string;
    suggested: Json | null;
    note: string | null;
    photo_path: string | null;
    created_at: string;
    reporter: string | null;
    obstacle: ParkInfoDetail["obstacle"];
    park: ParkInfoDetail["park"];
    current: Json | null;
  };
  if (raw.status !== "open") return null;

  let photoUrl: string | null = null;
  if (raw.photo_path) {
    const signed = await supabase.storage.from("report-photos").createSignedUrl(raw.photo_path, 3600);
    photoUrl = signed.data?.signedUrl ?? null;
  }

  return {
    id: raw.id,
    field: raw.field,
    status: raw.status,
    suggested: raw.suggested,
    note: raw.note,
    photoUrl,
    ago: ago(raw.created_at),
    reporter: raw.reporter,
    obstacle: raw.obstacle,
    park: raw.park,
    current: raw.current,
  };
}

/* Suggested obstacle detail --------------------------------------------------------- */

export type ObstacleDetail = {
  id: string;
  name: string;
  generalType: ObstacleType;
  notes: string | null;
  ago: string;
  suggestedBy: string | null;
  park: { id: string; name: string; slug: string };
  slideCount: number;
  postCount: number;
  canMerge: boolean;
  mergeOptions: { id: string; name: string; generalType: ObstacleType }[];
  hasStreetPlaza: boolean;
};

export async function fetchObstacleDetail(id: string): Promise<ObstacleDetail | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("obstacle_review_detail", { obstacle: id });
  if (error) {
    if (error.code === "P0002") return null;
    throw error;
  }
  const raw = data as unknown as {
    id: string;
    name: string;
    general_type: ObstacleType;
    status: string;
    notes: string | null;
    created_at: string;
    suggested_by: string | null;
    park: ObstacleDetail["park"];
    slide_count: number;
    post_count: number;
    can_merge: boolean;
    merge_options: { id: string; name: string; general_type: ObstacleType }[];
    has_street_plaza: boolean;
  };
  if (raw.status !== "pending") return null;

  return {
    id: raw.id,
    name: raw.name,
    generalType: raw.general_type,
    notes: raw.notes,
    ago: ago(raw.created_at),
    suggestedBy: raw.suggested_by,
    park: raw.park,
    slideCount: raw.slide_count,
    postCount: raw.post_count,
    canMerge: raw.can_merge,
    mergeOptions: raw.merge_options
      .filter((o) => o.general_type !== "street_plaza")
      .map((o) => ({ id: o.id, name: o.name, generalType: o.general_type })),
    hasStreetPlaza: raw.has_street_plaza,
  };
}
