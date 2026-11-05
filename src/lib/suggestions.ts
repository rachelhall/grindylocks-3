import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';

import type { Discipline } from '@/lib/parks';
import { parksByIds, parksInMetro } from '@/lib/parks';
import { useRecentParks } from '@/lib/posts';
import { fresh, keys } from '@/lib/query';
import { useFollowing } from '@/lib/social';
import { supabase } from '@/lib/supabase';

/* People to follow ------------------------------------------------------------------------- */

/**
 * Someone the empty states suggest following, with the park that put them
 * there ("posts at Linda Vista").
 *
 * Built only from parks' regulars lists (`park_regulars_list`), which already
 * leave out private accounts, people who hid themselves from regulars lists,
 * deleted and banned accounts and anyone blocked either way (Rachel, Nov 5:
 * only people who allow "Show me in regulars lists"). Never a direct read of
 * `profiles`, which can't tell a banned member from anyone else.
 */
export type SuggestedSkater = {
  id: string;
  username: string;
  avatarPath: string | null;
  disciplines: Discipline[];
  parkName: string;
};

type Park = { id: string; name: string };

/** At most this many parks are asked, so a long saved list stays one quick round. */
const MAX_PARKS = 8;
/** A metro area's parks: enough to cover a city like San Diego. */
const MAX_METRO_PARKS = 16;
const PER_PARK = 10;

async function regularsAt(parks: Park[], maxParks = MAX_PARKS): Promise<SuggestedSkater[]> {
  const lists = await Promise.all(
    parks.slice(0, maxParks).map(async (park) => {
      const { data, error } = await supabase.rpc('park_regulars_list', { park: park.id, max_results: PER_PARK });
      if (error) throw error;
      return (data ?? []).map((r) => ({ ...r, parkName: park.name }));
    }),
  );
  // Most recently active first; someone regular at two parks shows once, at the first.
  const seen = new Set<string>();
  return lists
    .flat()
    .sort((a, b) => (b.last_active_at ?? '').localeCompare(a.last_active_at ?? ''))
    .flatMap((r) => {
      if (seen.has(r.id)) return [];
      seen.add(r.id);
      return [{ id: r.id, username: r.username, avatarPath: r.avatar_path, disciplines: r.disciplines, parkName: r.parkName }];
    });
}

/** Drops you and the people you already follow. */
function useNotYetFollowed(userId: string | undefined, people: SuggestedSkater[] | undefined, limit: number) {
  const following = useFollowing(userId);
  return useMemo(() => {
    if (!people) return undefined;
    const followed = new Set((following.data ?? []).map((p) => p.id));
    return people.filter((p) => p.id !== userId && !followed.has(p.id)).slice(0, limit);
  }, [people, following.data, userId, limit]);
}

/**
 * "Skaters at your parks": regulars at your home park, the parks you've
 * posted at and the parks you saved, most recently active first.
 */
export function useSkatersAtYourParks(
  userId: string | undefined,
  homeParkId: string | null | undefined,
  savedIds: string[],
  limit = 3,
) {
  const recent = useRecentParks(userId);
  const ids = useMemo(() => {
    const out: string[] = [];
    for (const id of [homeParkId, ...(recent.data ?? []).map((p) => p.id), ...savedIds]) {
      if (id && !out.includes(id)) out.push(id);
    }
    return out.slice(0, MAX_PARKS);
  }, [homeParkId, recent.data, savedIds]);

  const query = useQuery({
    queryKey: keys.skatersAtParks(userId ?? '', ids),
    queryFn: async () => {
      const parks = await parksByIds(ids);
      // Keep the order above (home park first), not parksByIds' A to Z.
      const named = ids.flatMap((id) => {
        const p = parks.find((x) => x.id === id);
        return p ? [{ id, name: p.display_name }] : [];
      });
      return regularsAt(named);
    },
    enabled: Boolean(userId) && ids.length > 0 && !recent.isPending,
    staleTime: fresh.parks,
  });
  const people = useNotYetFollowed(userId, query.data, limit);
  const noParks = !recent.isPending && ids.length === 0;
  return { people: noParks ? [] : people, isPending: !noParks && (recent.isPending || query.isPending), isError: query.isError };
}

/**
 * Regulars across your home metro area, optionally only those who skate a
 * discipline ("Inline in San Diego", "Skaters in San Diego").
 */
export function useSkatersInMetro(
  userId: string | undefined,
  metroId: string | null | undefined,
  discipline: Discipline | null,
  limit = 3,
) {
  const query = useQuery({
    queryKey: keys.skatersInMetro(userId ?? '', metroId ?? ''),
    queryFn: async () => {
      const parks = await parksInMetro(metroId!);
      return regularsAt(
        parks.map((p) => ({ id: p.id, name: p.display_name })),
        MAX_METRO_PARKS,
      );
    },
    enabled: Boolean(userId && metroId),
    staleTime: fresh.parks,
  });
  const filtered = useMemo(
    () => (discipline ? query.data?.filter((p) => p.disciplines.includes(discipline)) : query.data),
    [query.data, discipline],
  );
  const people = useNotYetFollowed(userId, filtered, limit);
  return { people: metroId ? people : [], isPending: Boolean(metroId) && query.isPending, isError: query.isError };
}

/* Recent searches ---------------------------------------------------------------------------- */

/**
 * Search's recent searches (Rachel, Nov 5): kept on the phone only, never on
 * the server, per member so a second account on the phone doesn't see them.
 */
const RECENT_MAX = 8;
const storageKey = (userId: string) => `recent-searches:${userId}`;

async function readRecent(userId: string): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(storageKey(userId));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === 'string').slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

export function useRecentSearches(userId: string | undefined) {
  const qc = useQueryClient();
  const key = keys.recentSearches(userId ?? '');
  const query = useQuery({
    queryKey: key,
    queryFn: () => readRecent(userId!),
    enabled: Boolean(userId),
    staleTime: Infinity,
  });

  const write = useCallback(
    (update: (list: string[]) => string[]) => {
      if (!userId) return;
      const next = update(qc.getQueryData<string[]>(key) ?? []).slice(0, RECENT_MAX);
      qc.setQueryData(key, next);
      void AsyncStorage.setItem(storageKey(userId), JSON.stringify(next)).catch(() => undefined);
    },
    // `key` is rebuilt every render; userId decides it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [qc, userId],
  );

  /** Newest first; the same text (any case) moves to the top. */
  const add = useCallback(
    (q: string) => {
      const text = q.trim();
      if (text.length < 2) return;
      write((list) => [text, ...list.filter((s) => s.toLowerCase() !== text.toLowerCase())]);
    },
    [write],
  );
  const remove = useCallback((q: string) => write((list) => list.filter((s) => s !== q)), [write]);
  const clear = useCallback(() => write(() => []), [write]);

  return { recent: query.data ?? [], add, remove, clear };
}
