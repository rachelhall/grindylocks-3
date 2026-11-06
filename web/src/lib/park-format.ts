import { dayRanges, formatClock, formatMonthDay, type SessionRow, weekdayName } from "@/lib/hours";
import { OBSTACLE_TYPES } from "@/lib/obstacle-types";
import type { PublicMetroPark, PublicPark, PublicSession } from "@/lib/public-parks";

/**
 * Words for the public pages, in English, following the app's strings
 * (src/i18n/locales/en.json › park). The public pages are English only at
 * launch (Rachel, Nov 6).
 */

export const PARK_TYPE = { skatepark: "Skatepark", pump_track: "Pump track", diy: "DIY" } as const;
export const SETTING = {
  indoor: "Indoor",
  outdoor: "Outdoor",
  indoor_outdoor: "Indoor and outdoor",
  covered_outdoor: "Covered",
} as const;
export const STATUS = {
  open: "Open",
  temporarily_closed: "Temporarily closed",
  seasonal_closure: "Closed for the season",
  coming_soon: "Coming soon",
} as const;
export const DISCIPLINE = { inline: "Inline", quad: "Quad", skateboard: "Skateboard", bmx: "BMX", scooter: "Scooter" } as const;

export { OBSTACLE_TYPES };

/**
 * Times read the way locals write them: 12-hour in the US, 24-hour elsewhere
 * (the app follows the phone instead; a web page can't know the reader's
 * preference before it's built).
 */
export function clockLocale(country: string) {
  return country === "US" ? "en-US" : "en-GB";
}

/** The hours rows as the shared hours code expects them (no ids or notes here). */
export function asSessionRows(sessions: PublicSession[]): SessionRow[] {
  return sessions.map((s, i) => ({ ...s, id: String(i), note: null }));
}

export type HoursLine = { season: string | null; days: string; time: string; disciplines: string[] };

/** "Daily · 10:00 AM–10:00 PM", "Mon–Fri · sunrise–sunset", with seasons. */
export function hoursLines(park: Pick<PublicPark, "sessions" | "country">): HoursLine[] {
  const locale = clockLocale(park.country);
  const timeOf = (anchor: PublicSession["start_anchor"], time: string | null) => {
    if (anchor === "sunrise" || anchor === "sunset") return anchor;
    if (!time) return null;
    const [h, m] = time.split(":").map(Number);
    return formatClock(h * 60 + m, locale);
  };
  return park.sessions.map((s) => {
    const ranges = dayRanges(s.days);
    const days =
      ranges.length === 1 && ranges[0][0] === 1 && ranges[0][1] === 7
        ? "Daily"
        : ranges.map(([a, b]) => (a === b ? weekdayName(a, "en-US") : `${weekdayName(a, "en-US")}–${weekdayName(b, "en-US")}`)).join(", ");
    const start = timeOf(s.start_anchor, s.start_time);
    const end = timeOf(s.end_anchor, s.end_time);
    return {
      season:
        s.season_start_month && s.season_end_month
          ? `${formatMonthDay(s.season_start_month, s.season_start_day ?? 1, "en-US")} – ${formatMonthDay(s.season_end_month, s.season_end_day ?? 31, "en-US")}`
          : null,
      days,
      time: start && end ? `${start}–${end}` : "Hours not listed",
      disciplines: s.disciplines.map((d) => DISCIPLINE[d]),
    };
  });
}

/** Every discipline any hours row allows, in the app's order. */
export function disciplines(park: Pick<PublicPark, "sessions">) {
  const all = new Set(park.sessions.flatMap((s) => s.disciplines));
  return (Object.keys(DISCIPLINE) as (keyof typeof DISCIPLINE)[]).filter((d) => all.has(d)).map((d) => DISCIPLINE[d]);
}

export function lightsLabel(lit: boolean | null) {
  return lit === true ? "Lit at night" : lit === false ? "No lights" : "Not known";
}

export function entryLabel(park: Pick<PublicPark, "is_paid" | "entry_fee">) {
  if (park.is_paid === false) return "Free";
  if (park.is_paid === true) return park.entry_fee ? `Paid · ${park.entry_fee}` : "Paid";
  return "Not known";
}

/** "Skatepark · Covered · Lit · Free" for a row in a city's list. */
export function metroRowMeta(p: PublicMetroPark) {
  return [
    PARK_TYPE[p.park_type],
    p.setting === "covered_outdoor" || p.setting === "indoor" || p.setting === "indoor_outdoor" ? SETTING[p.setting] : null,
    p.night_lighting ? "Lit" : null,
    p.is_paid === true ? "Paid" : p.is_paid === false ? "Free" : null,
    p.status !== "open" ? STATUS[p.status] : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

export function directionsUrl(lat: number, lng: number) {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}
