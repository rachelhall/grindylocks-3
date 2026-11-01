/** Park directory data: map pins, near me, search and park pages. */
import { useCallback, useEffect, useState } from 'react';

import type { Database } from './database.types';
import type { SessionRow } from './hours';
import { supabase } from './supabase';

type Enums = Database['public']['Enums'];
export type ParkStatus = Enums['park_status'];
export type ParkType = Enums['park_type'];
export type ParkSetting = Enums['park_setting'];
export type Discipline = Enums['discipline'];
export type ObstacleType = Enums['obstacle_type'];

/** What a map pin and the preview card need. */
export type ParkPin = {
  id: string;
  slug: string;
  display_name: string;
  park_type: ParkType;
  status: ParkStatus;
  setting: ParkSetting | null;
  night_lighting: boolean | null;
  city: string;
  latitude: number;
  longitude: number;
  distance_m?: number;
};

const PIN_COLUMNS = 'id, slug, display_name, park_type, status, setting, night_lighting, city, latitude, longitude';

export type Bounds = { north: number; south: number; east: number; west: number };

/** Parks inside the visible map area. */
export async function parksInBounds(b: Bounds): Promise<ParkPin[]> {
  let query = supabase
    .from('parks')
    .select(PIN_COLUMNS)
    .gte('latitude', b.south)
    .lte('latitude', b.north)
    .not('latitude', 'is', null);
  // A view across the antimeridian wraps around; then the longitude test is "outside".
  query =
    b.west <= b.east
      ? query.gte('longitude', b.west).lte('longitude', b.east)
      : query.or(`longitude.gte.${b.west},longitude.lte.${b.east}`);
  const { data, error } = await query.limit(400);
  if (error) throw error;
  return (data ?? []) as ParkPin[];
}

/** Nearest parks to a point, nearest first. */
export async function parksNear(lat: number, lng: number, max = 20): Promise<ParkPin[]> {
  const { data, error } = await supabase.rpc('parks_near', { lat, lng, max_results: max });
  if (error) throw error;
  return data ?? [];
}

/** Every park in a metro area, A to Z. */
export async function parksInMetro(metroAreaId: string): Promise<ParkPin[]> {
  const { data, error } = await supabase
    .from('parks')
    .select(PIN_COLUMNS)
    .eq('metro_area_id', metroAreaId)
    .order('display_name');
  if (error) throw error;
  return (data ?? []) as ParkPin[];
}

export type SearchResult = Database['public']['Functions']['search_directory']['Returns'][number];

export async function searchDirectory(q: string): Promise<SearchResult[]> {
  const { data, error } = await supabase.rpc('search_directory', { q, max_results: 30 });
  if (error) throw error;
  return data ?? [];
}

export type Metro = { id: string; name: string; region: string | null; country: string };

export async function fetchMetro(id: string): Promise<Metro | null> {
  const { data } = await supabase.from('metro_areas').select('id, name, region, country').eq('id', id).maybeSingle();
  return data;
}

/* Park page ---------------------------------------------------------------------- */

export type Obstacle = {
  id: string;
  name: string;
  general_type: ObstacleType;
  notes: string | null;
};

export type ParkDetail = {
  id: string;
  slug: string;
  display_name: string;
  official_name: string | null;
  address: string | null;
  city: string;
  region: string | null;
  country: string;
  latitude: number | null;
  longitude: number | null;
  status: ParkStatus;
  park_type: ParkType;
  setting: ParkSetting | null;
  night_lighting: boolean | null;
  surface: string | null;
  helmet_required: boolean | null;
  is_paid: boolean;
  entry_fee: string | null;
  verified_at: string | null;
  metro: { id: string; name: string; timezone: string | null } | null;
  sessions: SessionRow[];
  obstacles: Obstacle[];
  descriptions: { locale: string; body: string }[];
};

export async function fetchPark(slug: string): Promise<ParkDetail | null> {
  const { data, error } = await supabase
    .from('parks')
    .select(
      `id, slug, display_name, official_name, address, city, region, country, latitude, longitude,
       status, park_type, setting, night_lighting, surface, helmet_required, is_paid, entry_fee, verified_at,
       metro_areas(id, name, timezone),
       park_sessions(id, season_start_month, season_start_day, season_end_month, season_end_day, days,
                     start_anchor, start_time, end_anchor, end_time, disciplines, note),
       obstacles(id, name, general_type, notes, status, merged_into, archived_at, created_at),
       park_descriptions(locale, body)`,
    )
    .eq('slug', slug)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  // Active obstacles only (no pending suggestions, merged or archived ones),
  // with the placeholder "street plaza" areas after the real obstacles.
  const obstacles = data.obstacles
    .filter((o) => o.status === 'active' && !o.merged_into && !o.archived_at)
    .sort((a, b) => {
      const plaza = Number(a.general_type === 'street_plaza') - Number(b.general_type === 'street_plaza');
      return plaza || a.created_at.localeCompare(b.created_at);
    })
    .map(({ id, name, general_type, notes }) => ({ id, name, general_type, notes }));

  return {
    ...data,
    metro: data.metro_areas,
    sessions: data.park_sessions,
    obstacles,
    descriptions: data.park_descriptions,
  };
}

/** The description in the reader's language, else English, else any. */
export function pickDescription(descriptions: { locale: string; body: string }[], language: string) {
  return (
    descriptions.find((d) => d.locale === language) ??
    descriptions.find((d) => d.locale === 'en') ??
    descriptions[0] ??
    null
  )?.body;
}

/* Saved parks ("want to skate") ------------------------------------------------- */

export function useSavedParks(userId: string | undefined) {
  const [saved, setSaved] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!userId) return;
    supabase
      .from('saved_parks')
      .select('park_id')
      .eq('user_id', userId)
      .then(({ data }) => setSaved(new Set((data ?? []).map((r) => r.park_id))));
  }, [userId]);

  const toggle = useCallback(
    async (parkId: string) => {
      if (!userId) return;
      const wasSaved = saved.has(parkId);
      // Optimistic, then undone if the write fails.
      setSaved((prev) => {
        const next = new Set(prev);
        if (wasSaved) next.delete(parkId);
        else next.add(parkId);
        return next;
      });
      const { error } = wasSaved
        ? await supabase.from('saved_parks').delete().eq('user_id', userId).eq('park_id', parkId)
        : await supabase.from('saved_parks').insert({ user_id: userId, park_id: parkId });
      if (error) {
        setSaved((prev) => {
          const next = new Set(prev);
          if (wasSaved) next.add(parkId);
          else next.delete(parkId);
          return next;
        });
      }
    },
    [saved, userId],
  );

  return { saved, toggle };
}

/* Distances --------------------------------------------------------------------- */

/** Straight-line distance in metres. */
export function distanceMeters(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const r = 6371e3;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLng = ((b.longitude - a.longitude) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.latitude * Math.PI) / 180) * Math.cos((b.latitude * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(s));
}

/** "0.4 mi" or "650 m" / "1.2 km", by locale. */
export function formatDistance(meters: number, metric: boolean, locale: string): string {
  const fmt = (n: number, digits: number) =>
    new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(n);
  if (metric) return meters < 1000 ? `${fmt(Math.round(meters / 10) * 10, 0)} m` : `${fmt(meters / 1000, meters < 10_000 ? 1 : 0)} km`;
  const miles = meters / 1609.344;
  return `${fmt(miles, miles < 10 ? 1 : 0)} mi`;
}
