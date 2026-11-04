/**
 * Shops (brand and shop accounts part A, PR 3: shops and the map).
 *
 * - Location type: a storefront has a pin, hours and "open now"; a
 *   by-appointment shop shows "By appointment" and a pin only if it chose
 *   one; an online-only shop has no pin. (Brand and Shop Accounts PRD, Shops.)
 * - Hours run on the shop's own clock (its metro area's time zone, or the
 *   page's own), the same way park hours do.
 * - The map's pins come from shops_in_bounds(), which leaves out archives,
 *   name-only pages and shops you blocked.
 */
import { keepPreviousData, useQuery } from '@tanstack/react-query';

import type { Database } from './database.types';
import { type HoursRow, localNow, openState, type OpenState } from './hours';
import type { Bounds } from './parks';
import { fresh, keys } from './query';
import { supabase } from './supabase';

type Enums = Database['public']['Enums'];
export type ShopLocationType = Enums['shop_location_type'];

/** What a shop pin and its preview card need. */
export type ShopPin = {
  id: string;
  handle: string;
  displayName: string;
  state: Enums['page_state'];
  logoPath: string | null;
  city: string | null;
  country: string | null;
  locationType: ShopLocationType;
  address: string | null;
  latitude: number;
  longitude: number;
  timeZone: string | null;
  tempClosedAt: string | null;
  tempClosedUntil: string | null;
  hours: HoursRow[];
};

/** Shop pins inside the visible map area. */
export async function shopsInBounds(b: Bounds): Promise<ShopPin[]> {
  const { data, error } = await supabase.rpc('shops_in_bounds', {
    north: b.north,
    south: b.south,
    east: b.east,
    west: b.west,
  });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id,
    handle: r.handle,
    displayName: r.display_name,
    state: r.state,
    logoPath: r.logo_path,
    city: r.city,
    country: r.country,
    locationType: r.location_type,
    address: r.address,
    latitude: r.latitude,
    longitude: r.longitude,
    timeZone: r.timezone,
    tempClosedAt: r.temp_closed_at,
    tempClosedUntil: r.temp_closed_until,
    hours: (r.hours as unknown as HoursRow[]) ?? [],
  }));
}

/** Shop pins for the map, while Show shops is on. */
export function useShopsInBounds(userId: string | undefined, bounds: Bounds | null, enabled: boolean) {
  return useQuery({
    queryKey: bounds && userId ? keys.shopsInBounds(userId, bounds) : ['shops', 'bounds', 'none'],
    queryFn: () => shopsInBounds(bounds!),
    enabled: enabled && bounds !== null && Boolean(userId),
    staleTime: fresh.parks,
    placeholderData: keepPreviousData,
  });
}

/* Open now ------------------------------------------------------------------------------- */

type ShopClock = {
  locationType: ShopLocationType | null;
  tempClosedAt: string | null;
  latitude: number | null;
  longitude: number | null;
  timeZone: string | null;
  hours: HoursRow[];
};

/**
 * Open or closed right now by the shop's own clock, or null when there's
 * nothing to say: by-appointment and online-only shops have no hours, and
 * a storefront whose hours we don't know yet shows no chip rather than
 * "hours unknown". A shop that's closed for a while is shown by its
 * "Closed until" chip instead, so it reads as temporarily closed here.
 */
export function shopOpenState(shop: ShopClock, now = new Date()): OpenState | null {
  if (shop.tempClosedAt) return { kind: 'status', status: 'temporarily_closed' };
  if (shop.locationType !== 'storefront' || shop.hours.length === 0) return null;
  return openState(
    'open',
    shop.hours,
    { latitude: shop.latitude, longitude: shop.longitude, timeZone: shop.timeZone },
    now,
  );
}

/* The week's hours ------------------------------------------------------------------------ */

export type WeekLine = {
  /** First and last ISO weekday of the run (1 = Monday). */
  from: number;
  to: number;
  /** Each opening that day, in local minutes past midnight (end may pass 24:00), or empty when closed. */
  spans: { start: number; end: number }[];
};

function clockMinutes(time: string | null): number | null {
  if (!time) return null;
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Monday to Sunday, with days that share their hours run together:
 * Bo's reads Mon closed, Tue–Wed 12–18, Thu closed, Fri 12–18, Sat–Sun 11–17.
 * Only clock times; shops don't keep sunrise hours.
 */
export function weekLinesFor(rows: HoursRow[]): WeekLine[] {
  const spansFor = (day: number) =>
    rows
      .filter((r) => r.days.includes(day))
      .map((r) => ({ start: clockMinutes(r.start_time), end: clockMinutes(r.end_time) }))
      .filter((s): s is { start: number; end: number } => s.start !== null && s.end !== null)
      .map((s) => ({ start: s.start, end: s.end <= s.start ? s.end + 24 * 60 : s.end }))
      .sort((a, b) => a.start - b.start);
  const out: WeekLine[] = [];
  for (let day = 1; day <= 7; day++) {
    const spans = spansFor(day);
    const last = out[out.length - 1];
    if (last && JSON.stringify(last.spans) === JSON.stringify(spans)) last.to = day;
    else out.push({ from: day, to: day, spans });
  }
  return out;
}

type SeasonDates = { startMonth: number; startDay: number; endMonth: number; endDay: number };

function seasonOf(r: HoursRow): SeasonDates | null {
  if (!r.season_start_month || !r.season_end_month) return null;
  return {
    startMonth: r.season_start_month,
    startDay: r.season_start_day ?? 1,
    endMonth: r.season_end_month,
    endDay: r.season_end_day ?? 31,
  };
}

const sameSeason = (a: SeasonDates | null, b: SeasonDates | null) =>
  a === b || (a !== null && b !== null && a.startMonth === b.startMonth && a.startDay === b.startDay && a.endMonth === b.endMonth && a.endDay === b.endDay);

function covers(s: SeasonDates | null, month: number, day: number): boolean {
  if (!s) return true;
  const v = month * 100 + day;
  const start = s.startMonth * 100 + s.startDay;
  const end = s.endMonth * 100 + s.endDay;
  return start <= end ? v >= start && v <= end : v >= start || v <= end;
}

export type ShopWeek = {
  /** Today's hours, run together by day; empty when no hours cover today. */
  lines: WeekLine[];
  /** The dates today's hours run to, when they change with the seasons. */
  until: { month: number; day: number } | null;
  /** The next set of hours, when they change with the seasons. */
  next: { from: { month: number; day: number }; lines: WeekLine[] } | null;
};

/**
 * The hours card's week, on the shop's own clock (PR 7b): the hours for
 * today's date, and when they change with the seasons, when they run to and
 * the next set. Dates no set covers read Closed for the season.
 */
export function shopWeek(hours: HoursRow[], timeZone: string | null, now = new Date()): ShopWeek {
  const today = localNow(now, timeZone);
  const current = hours.filter((r) => covers(seasonOf(r), today.month, today.day));
  const seasons: SeasonDates[] = [];
  for (const r of hours) {
    const s = seasonOf(r);
    if (s && !seasons.some((x) => sameSeason(x, s))) seasons.push(s);
  }
  if (seasons.length === 0) return { lines: weekLinesFor(current), until: null, next: null };

  const nowSeason = current.map(seasonOf).find((s): s is SeasonDates => s !== null) ?? null;
  // The next season to start after today, wrapping into next year.
  const v = today.month * 100 + today.day;
  const startOf = (s: SeasonDates) => s.startMonth * 100 + s.startDay;
  const later = seasons.filter((s) => !sameSeason(s, nowSeason));
  const nextSeason =
    later.filter((s) => startOf(s) > v).sort((a, b) => startOf(a) - startOf(b))[0] ??
    later.sort((a, b) => startOf(a) - startOf(b))[0] ??
    null;
  return {
    lines: current.length ? weekLinesFor(current) : [],
    until: nowSeason ? { month: nowSeason.endMonth, day: nowSeason.endDay } : null,
    next: nextSeason
      ? {
          from: { month: nextSeason.startMonth, day: nextSeason.startDay },
          lines: weekLinesFor(hours.filter((r) => sameSeason(seasonOf(r), nextSeason))),
        }
      : null,
  };
}

/** Today's week only (the map card and older callers). */
export function weekLines(hours: HoursRow[], timeZone: string | null, now = new Date()): WeekLine[] {
  return shopWeek(hours, timeZone, now).lines;
}

/** The city the hours card names ("HOURS · COPENHAGEN TIME"): the time zone's own city. */
export function timeZoneCity(timeZone: string | null): string | null {
  if (!timeZone) return null;
  const city = timeZone.split('/').pop();
  return city ? city.replace(/_/g, ' ') : null;
}
