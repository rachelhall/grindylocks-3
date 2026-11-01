/** Park directory data: map pins, near me, search and park pages. */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

import type { Database } from './database.types';
import type { SessionRow } from './hours';
import { fresh, keys, queryClient } from './query';
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

/* Cached reads ------------------------------------------------------------------ */

/**
 * A park's full detail. The map card and the park page share this entry, so
 * switching between cards or opening the page shows cached hours at once.
 */
export function usePark(slug: string | undefined) {
  return useQuery({
    queryKey: keys.park(slug ?? ''),
    queryFn: () => fetchPark(slug!),
    enabled: Boolean(slug),
    staleTime: fresh.parks,
  });
}

/** Pins for the visible map area; the last pins stay up while new ones load. */
export function useParksInBounds(bounds: Bounds | null) {
  return useQuery({
    queryKey: bounds ? keys.parksInBounds(bounds) : ['parks', 'bounds', 'none'],
    queryFn: () => parksInBounds(bounds!),
    enabled: bounds !== null,
    staleTime: fresh.parks,
    placeholderData: keepPreviousData,
  });
}

export function useParksInMetro(metroId: string | null | undefined) {
  return useQuery({
    queryKey: keys.parksInMetro(metroId ?? ''),
    queryFn: () => parksInMetro(metroId!),
    enabled: Boolean(metroId),
    staleTime: fresh.parks,
  });
}

export function useMetro(id: string | null | undefined) {
  return useQuery({
    queryKey: keys.metro(id ?? ''),
    queryFn: () => fetchMetro(id!),
    enabled: Boolean(id),
    staleTime: fresh.parks,
  });
}

/** Directory search; the last results stay up while the next ones load. */
export function useDirectorySearch(q: string) {
  const query = q.trim();
  return useQuery({
    queryKey: keys.search(query),
    queryFn: () => searchDirectory(query),
    enabled: query.length >= 2,
    staleTime: fresh.search,
    placeholderData: keepPreviousData,
  });
}

/** One-off reads outside a component (the map's first framing), through the same cache. */
export const fetchParksInMetroCached = (metroId: string) =>
  queryClient.fetchQuery({
    queryKey: keys.parksInMetro(metroId),
    queryFn: () => parksInMetro(metroId),
    staleTime: fresh.parks,
  });

export const fetchParksNearCached = (lat: number, lng: number, max: number) =>
  queryClient.fetchQuery({
    queryKey: keys.parksNear(lat, lng, max),
    queryFn: () => parksNear(lat, lng, max),
    staleTime: fresh.parks,
  });

/** Starts loading a park before it's needed (e.g. the card picked on first open). */
export const prefetchPark = (slug: string) =>
  queryClient.prefetchQuery({ queryKey: keys.park(slug), queryFn: () => fetchPark(slug), staleTime: fresh.parks });

/* Saved parks ("want to skate") ------------------------------------------------- */

async function fetchSavedParkIds(userId: string): Promise<string[]> {
  const { data, error } = await supabase.from('saved_parks').select('park_id').eq('user_id', userId);
  if (error) throw error;
  return (data ?? []).map((r) => r.park_id);
}

/**
 * The member's saved parks, shared by every bookmark on screen. Toggling is
 * optimistic: every bookmark flips at once and flips back if the write fails.
 */
export function useSavedParks(userId: string | undefined) {
  const client = useQueryClient();
  const key = keys.savedParks(userId ?? '');

  const { data } = useQuery({
    queryKey: key,
    queryFn: () => fetchSavedParkIds(userId!),
    enabled: Boolean(userId),
    staleTime: fresh.mine,
  });
  const saved = useMemo(() => new Set(data ?? []), [data]);

  const mutation = useMutation({
    mutationFn: async ({ parkId, save }: { parkId: string; save: boolean }) => {
      const { error } = save
        ? await supabase.from('saved_parks').insert({ user_id: userId!, park_id: parkId })
        : await supabase.from('saved_parks').delete().eq('user_id', userId!).eq('park_id', parkId);
      if (error) throw error;
    },
    onMutate: async ({ parkId, save }) => {
      await client.cancelQueries({ queryKey: key });
      const previous = client.getQueryData<string[]>(key);
      client.setQueryData<string[]>(key, (ids = []) =>
        save ? [...new Set([...ids, parkId])] : ids.filter((id) => id !== parkId),
      );
      return { previous };
    },
    onError: (_error, _vars, context) => {
      client.setQueryData(key, context?.previous);
    },
    onSettled: () => client.invalidateQueries({ queryKey: key }),
  });

  const toggle = async (parkId: string) => {
    if (!userId) return;
    await mutation.mutateAsync({ parkId, save: !saved.has(parkId) }).catch(() => undefined);
  };

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
