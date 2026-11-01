/**
 * The signed-in member's roles, for showing role-only controls (adding park
 * photos) and the role badge on a park page. The database enforces the same
 * rules (private.can_contribute_park, private.can_moderate_park); this only
 * decides what to show.
 */
import { useQuery } from '@tanstack/react-query';

import type { Database } from './database.types';
import { fresh, keys } from './query';
import { supabase } from './supabase';

export type RoleName = Database['public']['Enums']['role_name'];

export type MyRole = { role: RoleName; metro_area_id: string | null; park_id: string | null };

async function fetchMyRoles(userId: string): Promise<MyRole[]> {
  const { data, error } = await supabase
    .from('role_assignments')
    .select('role, metro_area_id, park_id')
    .eq('user_id', userId)
    .not('accepted_at', 'is', null)
    .is('ended_at', null);
  if (error) throw error;
  return data ?? [];
}

export function useMyRoles(userId: string | undefined) {
  return useQuery({
    queryKey: keys.myRoles(userId ?? ''),
    queryFn: () => fetchMyRoles(userId!),
    enabled: Boolean(userId),
    staleTime: fresh.mine,
  });
}

/**
 * The member's strongest role at a park: the owner everywhere, a city admin
 * for parks in their metro area, a park admin or contributor for their park.
 */
export function roleAtPark(
  roles: MyRole[] | undefined,
  park: { id: string; metro: { id: string } | null },
): RoleName | null {
  if (!roles) return null;
  const order: RoleName[] = ['owner', 'city_admin', 'park_admin', 'park_contributor'];
  const held = roles.filter(
    (r) =>
      r.role === 'owner' ||
      (r.role === 'city_admin' && r.metro_area_id !== null && r.metro_area_id === park.metro?.id) ||
      ((r.role === 'park_admin' || r.role === 'park_contributor') && r.park_id === park.id),
  );
  return order.find((name) => held.some((r) => r.role === name)) ?? null;
}

/** Contributors and up can add and reorder park photos. */
export const canContribute = (role: RoleName | null) => role !== null;

/** Park admins, city admins and the owner can archive anyone's park photo. */
export const canModerate = (role: RoleName | null) => role !== null && role !== 'park_contributor';
