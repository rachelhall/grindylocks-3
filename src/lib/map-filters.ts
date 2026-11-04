/**
 * The map's filters (v2, Nov 2; the "Filter sheet" mockup in the Map (v2)
 * row): who can skate, setting, and open now, free and lit at night.
 *
 * Within a group a park shows if it matches any chip picked (Inline or
 * Quad); across groups it has to match every group. Everything starts
 * blank. A park whose value is unknown is hidden while that filter is on:
 * we can't say it's lit, so it isn't shown as lit.
 *
 * Setting and lights are on every map pin already. Who can skate, free and
 * open now need a park's sessions, fee and time zone, fetched as "facets"
 * only while one of those filters is on (or the sheet is open).
 *
 * Shops (part A, PR 3; the Map-Filters-Shops mockup): Show shops is on by
 * default, and turning it off counts as a filter. Open now covers parks and
 * shops, each on its own clock; every other filter is park-only and the
 * sheet labels it so, so a park filter never hides shops by surprise.
 */
import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { openState, type SessionRow } from './hours';
import type { Discipline, ParkPin, ParkSetting, ParkStatus } from './parks';
import { fresh } from './query';
import { type ShopPin, shopOpenState } from './shops';
import { supabase } from './supabase';

/** The disciplines with chips in the sheet (v1's three). */
export const FILTER_DISCIPLINES: Discipline[] = ['inline', 'quad', 'skateboard'];

export type SettingChoice = 'indoor' | 'covered' | 'outdoor';
export const SETTING_CHOICES: SettingChoice[] = ['indoor', 'covered', 'outdoor'];

export type MapFilters = {
  disciplines: Discipline[];
  settings: SettingChoice[];
  openNow: boolean;
  free: boolean;
  lit: boolean;
  /** Shop pins next to parks; on by default. */
  showShops: boolean;
};

export const NO_FILTERS: MapFilters = {
  disciplines: [],
  settings: [],
  openNow: false,
  free: false,
  lit: false,
  showShops: true,
};

/** How many chips and boxes are on: the number on the filter button's badge. */
export function filterCount(f: MapFilters) {
  return (
    f.disciplines.length + f.settings.length + Number(f.openNow) + Number(f.free) + Number(f.lit) + Number(!f.showShops)
  );
}

/** Filters that need a park's sessions, fee or time zone. */
export function needsFacets(f: MapFilters) {
  return f.disciplines.length > 0 || f.openNow || f.free;
}

/**
 * Which park settings each chip covers. A park with indoor and outdoor
 * sections shows for either; covered parks are outdoor too, and also have
 * their own chip for rainy days.
 */
const SETTINGS_FOR: Record<SettingChoice, ParkSetting[]> = {
  indoor: ['indoor', 'indoor_outdoor'],
  covered: ['covered_outdoor'],
  outdoor: ['outdoor', 'covered_outdoor', 'indoor_outdoor'],
};

/** Has an indoor part (city search's "2 indoor"). */
export function hasIndoor(setting: ParkSetting | null) {
  return setting !== null && SETTINGS_FOR.indoor.includes(setting);
}

/* Facets ---------------------------------------------------------------------- */

export type ParkFacets = {
  id: string;
  status: ParkStatus;
  is_paid: boolean;
  latitude: number | null;
  longitude: number | null;
  timeZone: string | null;
  sessions: SessionRow[];
  /** Every discipline any session allows; empty when the park has no sessions. */
  disciplines: Discipline[];
};

export async function fetchParkFacets(ids: string[]): Promise<Map<string, ParkFacets>> {
  const out = new Map<string, ParkFacets>();
  if (ids.length === 0) return out;
  const { data, error } = await supabase
    .from('parks')
    .select(
      `id, status, is_paid, latitude, longitude,
       metro_areas(timezone),
       park_sessions(id, season_start_month, season_start_day, season_end_month, season_end_day, days,
                     start_anchor, start_time, end_anchor, end_time, disciplines, note)`,
    )
    .in('id', ids);
  if (error) throw error;
  for (const p of data ?? []) {
    out.set(p.id, {
      id: p.id,
      status: p.status,
      is_paid: p.is_paid,
      latitude: p.latitude,
      longitude: p.longitude,
      timeZone: p.metro_areas?.timezone ?? null,
      sessions: p.park_sessions,
      disciplines: [...new Set(p.park_sessions.flatMap((s) => s.disciplines))],
    });
  }
  return out;
}

/** Facets for the parks on and around the map, while a filter needs them. */
export function useParkFacets(ids: string[], enabled: boolean) {
  const sorted = [...new Set(ids)].sort();
  return useQuery({
    queryKey: ['parks', 'facets', ...sorted],
    queryFn: () => fetchParkFacets(sorted),
    enabled: enabled && sorted.length > 0,
    staleTime: fresh.parks,
    placeholderData: keepPreviousData,
  });
}

/* Matching -------------------------------------------------------------------- */

/**
 * Does a park pass the filters? `facets` is needed only for who can skate,
 * free and open now; while it's still loading those parks don't show yet.
 */
export function matchesFilters(
  pin: Pick<ParkPin, 'setting' | 'night_lighting'>,
  facets: ParkFacets | undefined,
  f: MapFilters,
  now = new Date(),
): boolean {
  if (f.settings.length > 0) {
    if (pin.setting === null) return false;
    if (!f.settings.some((choice) => SETTINGS_FOR[choice].includes(pin.setting!))) return false;
  }
  if (f.lit && pin.night_lighting !== true) return false;
  if (!needsFacets(f)) return true;
  if (!facets) return false;
  if (f.free && facets.is_paid) return false;
  if (f.disciplines.length > 0 && !f.disciplines.some((d) => facets.disciplines.includes(d))) return false;
  if (f.openNow) {
    if (facets.latitude === null || facets.longitude === null) return false;
    const state = openState(
      facets.status,
      facets.sessions,
      { latitude: facets.latitude, longitude: facets.longitude, timeZone: facets.timeZone },
      now,
    );
    if (state.kind !== 'open') return false;
  }
  return true;
}

/**
 * Does a shop pass the filters? Only Show shops and Open now apply to shops;
 * the rest are park-only. A shop with no hours yet isn't "open now".
 */
export function shopMatchesFilters(shop: ShopPin, f: MapFilters, now = new Date()): boolean {
  if (!f.showShops) return false;
  if (f.openNow) return shopOpenState(shop, now)?.kind === 'open';
  return true;
}
