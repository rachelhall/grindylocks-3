/**
 * Here now (Meetups v2): a check-in at a park, "Find My for skate parks".
 *
 * The rules live in the database (migration `meetups`):
 * - Checking in sends the phone's position once; the server checks it's
 *   within about 500 m of the park's pin and doesn't store it.
 * - A check-in lasts 3 hours or until I left, one at a time, with no history.
 * - Followers see you by default; Friends only means people you follow who
 *   follow you back. Blocked people never see you, either way.
 * - Everyone else gets an unnamed count, and only once at least 3 skaters
 *   are checked in, so nobody can tell someone is there alone.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Location from 'expo-location';
import { useTranslation } from 'react-i18next';

import type { Database } from './database.types';
import { formatClock, localNow } from './hours';
import { fresh, keys } from './query';
import { supabase } from './supabase';

type Fns = Database['public']['Functions'];

export type CheckInAudience = Database['public']['Enums']['check_in_audience'];
export type HereNowPerson = Fns['park_here_now']['Returns'][number];
export type ProfileCheckIn = Fns['profile_check_in']['Returns'][number];

/** The server's radius, in metres. */
export const CHECK_IN_RADIUS_M = 500;

/** Who's at a park that you can see by name, and how many others ("3 skaters here now"). */
export function useParkHereNow(parkId: string | undefined) {
  return useQuery({
    queryKey: keys.hereNow(parkId ?? ''),
    queryFn: async () => {
      const [people, unnamed] = await Promise.all([
        supabase.rpc('park_here_now', { park: parkId! }),
        supabase.rpc('park_here_now_unnamed', { park: parkId! }),
      ]);
      if (people.error) throw people.error;
      if (unnamed.error) throw unnamed.error;
      return { people: people.data ?? [], unnamed: unnamed.data ?? 0 };
    },
    enabled: Boolean(parkId),
    staleTime: fresh.social,
    // Check-ins run out on their own; refresh while the page stays open.
    refetchInterval: 60_000,
  });
}

/** Someone's current check-in, if you may see it (the profile tag). Your own too. */
export function useProfileCheckIn(personId: string | undefined) {
  return useQuery({
    queryKey: keys.checkIn(personId ?? ''),
    queryFn: async (): Promise<ProfileCheckIn | null> => {
      const { data, error } = await supabase.rpc('profile_check_in', { person: personId! });
      if (error) throw error;
      return data?.[0] ?? null;
    },
    enabled: Boolean(personId),
    staleTime: fresh.social,
    refetchInterval: 60_000,
  });
}

/* Location ----------------------------------------------------------------------- */

export type Spot =
  | { kind: 'off' } // location permission refused (or can't be asked again)
  | { kind: 'unknown' } // permission given, but no fix
  | { kind: 'here'; latitude: number; longitude: number; metres: number }
  | { kind: 'away'; latitude: number; longitude: number; metres: number };

/** Metres between two points (haversine). Close enough for a 500 m check. */
export function metresBetween(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const R = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLng = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Asks for the phone's position once (asking for permission if it hasn't
 * been answered) and says whether it's at the park. A fresh fix, not the
 * last known one, since that could be from somewhere else.
 */
export async function locateForCheckIn(park: { latitude: number | null; longitude: number | null }): Promise<Spot> {
  const at = await locateOnce();
  if (at.kind !== 'at') return at;
  return spotAt(at, park);
}

/**
 * One location reading (asking for permission if it can): where you are, or
 * why it couldn't tell. Nothing is kept. Checking in from your own profile
 * uses this, then finds the parks near you.
 */
export async function locateOnce(): Promise<{ kind: 'off' } | { kind: 'unknown' } | { kind: 'at'; latitude: number; longitude: number }> {
  let perm = await Location.getForegroundPermissionsAsync();
  if (!perm.granted && perm.canAskAgain) perm = await Location.requestForegroundPermissionsAsync();
  if (!perm.granted) return { kind: 'off' };
  const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }).catch(() => null);
  if (!pos) return { kind: 'unknown' };
  return { kind: 'at', latitude: pos.coords.latitude, longitude: pos.coords.longitude };
}

/** Where a reading puts you relative to a park's pin. */
export function spotAt(at: { latitude: number; longitude: number }, park: { latitude: number | null; longitude: number | null }): Spot {
  if (park.latitude === null || park.longitude === null)
    return { kind: 'away', latitude: at.latitude, longitude: at.longitude, metres: Infinity };
  const metres = metresBetween(at, { latitude: park.latitude, longitude: park.longitude });
  // A little inside the server's radius, so the sheet never says "you're
  // here" and then gets turned down.
  return { kind: metres <= CHECK_IN_RADIUS_M - 25 ? 'here' : 'away', latitude: at.latitude, longitude: at.longitude, metres };
}

/* Checking in and out ------------------------------------------------------------- */

/** True when the server said you aren't at the park. */
export function isNotAtPark(err: unknown): boolean {
  return Boolean(err && typeof err === 'object' && 'hint' in err && (err as { hint?: string }).hint === 'not_at_park');
}

export function useCheckIn(userId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (args: { parkId: string; latitude: number; longitude: number; audience: CheckInAudience }) => {
      const { data, error } = await supabase.rpc('check_in', {
        park: args.parkId,
        latitude: args.latitude,
        longitude: args.longitude,
        audience: args.audience,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => invalidate(queryClient, userId),
  });
}

/** I left. */
export function useCheckOut(userId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('check_out');
      if (error) throw error;
    },
    onSuccess: () => invalidate(queryClient, userId),
  });
}

function invalidate(queryClient: ReturnType<typeof useQueryClient>, userId: string | undefined) {
  // Your check-in may have moved between parks, so every park's list is refreshed.
  void queryClient.invalidateQueries({ queryKey: ['here-now'] });
  if (userId) void queryClient.invalidateQueries({ queryKey: keys.checkIn(userId) });
}

/** "7:30 PM": when a check-in ends, on the park's clock. */
export function useCheckInTime() {
  const { i18n } = useTranslation();
  return (iso: string, timeZone: string | null | undefined) =>
    formatClock(localNow(new Date(iso), timeZone ?? null).minutes, i18n.language);
}
