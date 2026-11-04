// Words the queue shows, shared by the list and the detail panes. No server
// code here, so client components can import it.

import { Constants, type Database, type Json } from "@/lib/database.types";

type ObstacleType = Database["public"]["Enums"]["obstacle_type"];

export type QueueTab = "all" | "reports" | "park-info" | "obstacles" | "claims" | "suggested-brands" | "product-suggestions";

/** Every queue tab, for reading ?tab= on the server. Rachel's last three are hidden for other admins. */
export const TAB_VALUES: QueueTab[] = ["all", "reports", "park-info", "obstacles", "claims", "suggested-brands", "product-suggestions"];
type ParkField = Database["public"]["Enums"]["park_field"];

export const reasonLabel: Record<string, string> = {
  spam: "Spam",
  harassment: "Harassment",
  involves_minor: "Involves a minor",
  wrong_park: "Not at this park",
  inappropriate: "Inappropriate",
  // Brand and shop pages (v2). Profile reports can say a person is pretending
  // to be a page; the other two are for reports about a page itself.
  impersonation: "Pretending to be a brand or shop",
  our_page: "This is our brand or shop",
  wrong_info: "Wrong info",
  other: "Something else",
};

export const fieldLabel: Record<ParkField, string> = {
  hours: "hours",
  status: "status",
  lighting: "lights",
  location: "address or pin",
  fees: "fees",
  disciplines: "who can skate",
  helmet_rule: "helmet rule",
  description: "description",
  obstacle: "an obstacle",
  other: "something else",
};

export const stateLabel: Record<string, string> = {
  sent_to_you: "Sent to you",
  auto_hidden: "Auto-hidden",
  hidden: "Hidden",
  open: "Open",
};

export const parkStatusLabel: Record<string, string> = {
  open: "Open",
  temporarily_closed: "Temporarily closed",
  seasonal_closure: "Closed for the season",
  coming_soon: "Coming soon",
};

export const disciplineLabel: Record<string, string> = {
  inline: "Inline",
  quad: "Quad",
  skateboard: "Skateboard",
  bmx: "BMX",
  scooter: "Scooter",
};

/** Every obstacle type an obstacle can be, without the street plaza placeholder. */
export const obstacleTypes: ObstacleType[] = Constants.public.Enums.obstacle_type.filter((t) => t !== "street_plaza");

export function obstacleTypeLabel(type: string): string {
  const special: Record<string, string> = { fun_box: "Fun box", bmx: "BMX" };
  return special[type] ?? type.charAt(0).toUpperCase() + type.slice(1).replace(/_/g, " ");
}

/* Hours ------------------------------------------------------------------------------ */

const dayName = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** "Daily", "Weekdays", "Weekends", "Mon–Wed, Fri". Days are ISO weekdays, 1 = Monday. */
export function daysLabel(days: number[]): string {
  const sorted = [...new Set(days)].sort((a, b) => a - b);
  const key = sorted.join(",");
  if (key === "1,2,3,4,5,6,7") return "Daily";
  if (key === "1,2,3,4,5") return "Weekdays";
  if (key === "6,7") return "Weekends";
  const ranges: string[] = [];
  let start = sorted[0];
  for (let i = 1; i <= sorted.length; i++) {
    if (sorted[i] !== sorted[i - 1] + 1) {
      const end = sorted[i - 1];
      ranges.push(start === end ? dayName[start] : `${dayName[start]}–${dayName[end]}`);
      start = sorted[i];
    }
  }
  return ranges.join(", ");
}

function timeLabel(anchor: string | null, time: string | null): string {
  if (anchor === "sunrise") return "sunrise";
  if (anchor === "sunset") return "sunset";
  return time ? time.slice(0, 5) : "?";
}

type Session = {
  days: number[];
  start_anchor: string | null;
  start_time: string | null;
  end_anchor: string | null;
  end_time: string | null;
  disciplines: string[];
  season_start_month: number | null;
  note: string | null;
};

/** One line per session: "Daily 10:00–22:00", "Thu 21:00–24:00 · Skateboard · seasonal". */
export function sessionLines(value: Json | null): string[] {
  if (!Array.isArray(value)) return [];
  const sessions = value as unknown as Session[];
  if (!sessions.length) return [];
  const widest = Math.max(...sessions.filter((s) => !s.season_start_month).map((s) => s.disciplines.length), 0);
  return sessions.map((s) => {
    const hours =
      s.start_anchor || s.end_anchor
        ? `${daysLabel(s.days)} ${timeLabel(s.start_anchor, s.start_time)}–${timeLabel(s.end_anchor, s.end_time)}`
        : `${daysLabel(s.days)} · ${s.note ?? "hours not listed"}`;
    const extra: string[] = [];
    if (s.disciplines.length < widest) extra.push(s.disciplines.map((d) => disciplineLabel[d] ?? d).join(", "));
    if (s.season_start_month) extra.push("seasonal");
    return [hours, ...extra].join(" · ");
  });
}

/** The suggested or applied hours value: { days, start, end }. */
export type HoursValue = { days: number[]; start: string; end: string };

export function hoursValueLabel(value: HoursValue): string {
  const t = (v: string) => (v === "sunrise" || v === "sunset" ? v : v.slice(0, 5));
  return `${daysLabel(value.days)} ${t(value.start)}–${t(value.end)}`;
}

/* Any park field ----------------------------------------------------------------------- */

function obj(value: Json | null): Record<string, Json | undefined> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function yesNo(value: Json | undefined, yes: string, no: string, unknown = "Not listed"): string {
  return value === true ? yes : value === false ? no : unknown;
}

/**
 * A park field's value in words, for "Listed now" and "Suggested". Returns
 * lines; an empty list means nothing to show.
 */
export function valueLines(field: ParkField, value: Json | null): string[] {
  if (value === null || value === undefined) return [];
  if (field === "hours") {
    if (Array.isArray(value)) return sessionLines(value);
    const v = obj(value);
    if (v && Array.isArray(v.days) && typeof v.start === "string" && typeof v.end === "string") {
      return [hoursValueLabel(v as unknown as HoursValue)];
    }
    return [JSON.stringify(value)];
  }
  if (field === "disciplines") {
    const list = Array.isArray(value) ? value : obj(value)?.disciplines;
    return Array.isArray(list) ? [list.map((d) => disciplineLabel[String(d)] ?? String(d)).join(", ") || "None listed"] : [];
  }
  const v = obj(value);
  if (!v) return [String(value)];
  switch (field) {
    case "status":
      return [parkStatusLabel[String(v.status)] ?? String(v.status)];
    case "lighting":
      return [yesNo(v.night_lighting, "Lit at night", "No lights")];
    case "fees": {
      const paid = yesNo(v.is_paid, "Paid", "Free");
      return [typeof v.entry_fee === "string" && v.entry_fee ? `${paid} · ${v.entry_fee}` : paid];
    }
    case "helmet_rule":
      return [yesNo(v.helmet_required, "Helmet required", "Helmet not required")];
    case "location": {
      const lines: string[] = [];
      if (typeof v.address === "string" && v.address) lines.push(v.address);
      if (typeof v.latitude === "number" && typeof v.longitude === "number") {
        lines.push(`Pin ${v.latitude.toFixed(5)}, ${v.longitude.toFixed(5)}`);
      }
      return lines;
    }
    case "description":
      return typeof v.body === "string" && v.body ? [v.body] : [];
    default:
      return Object.keys(v).length ? [JSON.stringify(v)] : [];
  }
}
