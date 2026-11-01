/**
 * Opening hours: is a park open right now, and how to show its hours.
 *
 * Everything runs on the park's own clock (its metro area's time zone), so
 * someone in San Diego planning a Copenhagen trip sees Copenhagen times.
 * "sunrise" and "sunset" are worked out for the park's location and date.
 *
 * This is about the park's hours only. Discipline sessions are shown as
 * information; there's no "open now for bladers" logic in v1.
 */
import type { Database } from './database.types';

export type SessionRow = Pick<
  Database['public']['Tables']['park_sessions']['Row'],
  | 'id'
  | 'season_start_month'
  | 'season_start_day'
  | 'season_end_month'
  | 'season_end_day'
  | 'days'
  | 'start_anchor'
  | 'start_time'
  | 'end_anchor'
  | 'end_time'
  | 'disciplines'
  | 'note'
>;

type ParkStatus = Database['public']['Enums']['park_status'];

/* The park's clock ------------------------------------------------------------ */

type LocalNow = { year: number; month: number; day: number; isoWeekday: number; minutes: number };

const WEEKDAYS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

/** Date, weekday (1 = Monday) and minutes past midnight in a time zone. */
export function localNow(now: Date, timeZone: string | null): LocalNow {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone ?? undefined,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      weekday: 'short',
      hour: 'numeric',
      minute: 'numeric',
      hourCycle: 'h23',
    }).formatToParts(now);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
    return {
      year: Number(get('year')),
      month: Number(get('month')),
      day: Number(get('day')),
      isoWeekday: WEEKDAYS[get('weekday')] ?? 1,
      minutes: (Number(get('hour')) % 24) * 60 + Number(get('minute')),
    };
  } catch {
    const d = now;
    return {
      year: d.getFullYear(),
      month: d.getMonth() + 1,
      day: d.getDate(),
      isoWeekday: ((d.getDay() + 6) % 7) + 1,
      minutes: d.getHours() * 60 + d.getMinutes(),
    };
  }
}

/* Sunrise and sunset ----------------------------------------------------------- */

const rad = Math.PI / 180;

/**
 * Sunrise or sunset (UTC) for a date and place: the NOAA approximation,
 * good to a minute or two. Null in polar day or night.
 */
export function sunTime(
  date: { year: number; month: number; day: number },
  lat: number,
  lng: number,
  which: 'sunrise' | 'sunset',
): Date | null {
  const dayStart = Date.UTC(date.year, date.month - 1, date.day);
  const n = Math.floor((dayStart - Date.UTC(2000, 0, 1, 12)) / 86_400_000) + 1;
  const meanSolarNoon = n - lng / 360;
  const meanAnomaly = (357.5291 + 0.98560028 * meanSolarNoon) % 360;
  const center =
    1.9148 * Math.sin(meanAnomaly * rad) +
    0.02 * Math.sin(2 * meanAnomaly * rad) +
    0.0003 * Math.sin(3 * meanAnomaly * rad);
  const eclipticLng = (meanAnomaly + center + 180 + 102.9372) % 360;
  const transit =
    2451545 + meanSolarNoon + 0.0053 * Math.sin(meanAnomaly * rad) - 0.0069 * Math.sin(2 * eclipticLng * rad);
  const declination = Math.asin(Math.sin(eclipticLng * rad) * Math.sin(23.4397 * rad));
  const cosHour =
    (Math.sin(-0.833 * rad) - Math.sin(lat * rad) * Math.sin(declination)) /
    (Math.cos(lat * rad) * Math.cos(declination));
  if (cosHour < -1 || cosHour > 1) return null;
  const hourAngle = Math.acos(cosHour) / rad;
  const julian = which === 'sunrise' ? transit - hourAngle / 360 : transit + hourAngle / 360;
  return new Date((julian - 2440587.5) * 86_400_000);
}

/* Sessions --------------------------------------------------------------------- */

type Place = { latitude: number | null; longitude: number | null; timeZone: string | null };

function clockMinutes(time: string | null): number | null {
  if (!time) return null;
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

/** Start or end of a session in local minutes on a given local date. */
function resolveMinutes(
  anchor: SessionRow['start_anchor'],
  time: string | null,
  date: { year: number; month: number; day: number },
  place: Place,
): number | null {
  if (anchor === 'clock' || (anchor === null && time)) return clockMinutes(time);
  if (anchor === 'sunrise' || anchor === 'sunset') {
    if (place.latitude === null || place.longitude === null) return null;
    const sun = sunTime(date, place.latitude, place.longitude, anchor);
    if (!sun) return null;
    return localNow(sun, place.timeZone).minutes;
  }
  return null;
}

/** Whether a month/day falls in a session's season (seasons can wrap the new year). */
function inSeason(row: SessionRow, month: number, day: number): boolean {
  if (!row.season_start_month || !row.season_end_month) return true;
  const v = month * 100 + day;
  const start = row.season_start_month * 100 + (row.season_start_day ?? 1);
  const end = row.season_end_month * 100 + (row.season_end_day ?? 31);
  return start <= end ? v >= start && v <= end : v >= start || v <= end;
}

function shiftDate(date: { year: number; month: number; day: number }, days: number) {
  const d = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

type Window = { start: number; end: number; row: SessionRow };

/** Today's opening windows, in local minutes (end may pass 24:00). */
function windowsFor(
  rows: SessionRow[],
  date: { year: number; month: number; day: number },
  isoWeekday: number,
  place: Place,
): Window[] {
  const out: Window[] = [];
  for (const row of rows) {
    if (!row.days.includes(isoWeekday) || !inSeason(row, date.month, date.day)) continue;
    const start = resolveMinutes(row.start_anchor, row.start_time, date, place);
    const end = resolveMinutes(row.end_anchor, row.end_time, date, place);
    if (start === null || end === null) continue;
    // 00:00 as an end time, or an end before the start, runs past midnight.
    out.push({ start, end: end <= start ? end + 24 * 60 : end, row });
  }
  return out.sort((a, b) => a.start - b.start);
}

export type OpenState =
  | { kind: 'status'; status: Exclude<ParkStatus, 'open'> }
  | { kind: 'open'; until: number }
  | { kind: 'closed'; opensAt: number | null }
  | { kind: 'closedToday' }
  | { kind: 'unknown' };

/**
 * Open or closed right now, by the park's own clock. Times in the result
 * are local minutes past midnight (may be over 1440 for "until 02:00").
 */
export function openState(status: ParkStatus, rows: SessionRow[], place: Place, now = new Date()): OpenState {
  if (status !== 'open') return { kind: 'status', status };
  const hasTimes = rows.some((r) => r.start_anchor || r.start_time);
  if (!hasTimes) return { kind: 'unknown' };

  const local = localNow(now, place.timeZone);
  const today = { year: local.year, month: local.month, day: local.day };
  const yesterday = shiftDate(today, -1);
  const yesterdayWeekday = ((local.isoWeekday + 5) % 7) + 1;

  // Last night's session may still be running (e.g. Fri 22:00–02:00).
  for (const w of windowsFor(rows, yesterday, yesterdayWeekday, place)) {
    if (w.end > 24 * 60 && local.minutes < w.end - 24 * 60) return { kind: 'open', until: w.end - 24 * 60 };
  }

  const windows = windowsFor(rows, today, local.isoWeekday, place);
  // Back-to-back sessions (15:00–21:00, 21:00–24:00) count as one stretch.
  const open = windows.find((w) => local.minutes >= w.start && local.minutes < w.end);
  if (open) {
    let until = open.end;
    for (const w of windows) if (w.start <= until && w.end > until) until = w.end;
    return { kind: 'open', until };
  }
  const next = windows.find((w) => w.start > local.minutes);
  if (next) return { kind: 'closed', opensAt: next.start };
  return windows.length === 0 && !rows.some((r) => inSeason(r, today.month, today.day))
    ? { kind: 'status', status: 'seasonal_closure' }
    : { kind: 'closedToday' };
}

/* Showing hours ---------------------------------------------------------------- */

/** "22:00" or "10 PM", following the device's locale. */
export function formatClock(minutes: number, locale: string): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  const d = new Date(Date.UTC(2026, 0, 5, Math.floor(m / 60), m % 60));
  return new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).format(d);
}

/** Short weekday name, 1 = Monday. */
export function weekdayName(isoWeekday: number, locale: string): string {
  // 2026-01-05 was a Monday.
  const d = new Date(Date.UTC(2026, 0, 4 + isoWeekday));
  return new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }).format(d);
}

/** "Sep 1" for a season boundary. */
export function formatMonthDay(month: number, day: number, locale: string): string {
  const d = new Date(Date.UTC(2026, month - 1, day));
  return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(d);
}

/**
 * Day ranges for a set of ISO weekdays: [[1,5]], [[6,7]], [[1,1],[3,3]].
 * Every day is [[1,7]].
 */
export function dayRanges(days: number[]): [number, number][] {
  const sorted = [...new Set(days)].sort((a, b) => a - b);
  const out: [number, number][] = [];
  for (const d of sorted) {
    const last = out[out.length - 1];
    if (last && d === last[1] + 1) last[1] = d;
    else out.push([d, d]);
  }
  return out;
}
