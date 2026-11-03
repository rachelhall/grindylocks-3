/**
 * Meetups (v2): reading a meetup, going, comments, making one, covers.
 *
 * The rules live in the database (migrations `meetups` and `meetup_covers`):
 * who can see a meetup, who's named on the going list, what hosts and
 * co-hosts may do. This file only asks. A meetup is a series (one-off or
 * repeating); each date is its own row (`events`), and the app opens dates.
 */
import {
  type InfiniteData,
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import type { TFunction } from 'i18next';

import type { Database } from './database.types';
import { localNow } from './hours';
import { fresh, keys } from './query';
import { supabase } from './supabase';
import { uuid } from './uuid';

type Fns = Database['public']['Functions'];
type Enums = Database['public']['Enums'];

export type MeetupVisibility = Enums['meetup_visibility'];
export type MeetupCancelReason = Enums['meetup_cancel_reason'];
export type Discipline = Enums['discipline'];

export const MEETUP_TITLE_MAX = 80;
export const MEETUP_NOTE_MAX = 280;
export const MAX_CO_HOSTS = 10;
export const COVER_BUCKET = 'meetup-covers';

const MEETUP_SELECT = `
  id, series_id, park_id, starts_at, ends_at, disciplines, title, note, cover_path,
  status, cancel_reason, cancel_note, went_count,
  series:event_series!inner(id, host_id, visibility, weekdays, ended_at),
  park:parks!inner(id, slug, display_name, latitude, longitude, metro:metro_areas(timezone))
`;

export type Meetup = {
  id: string;
  series_id: string;
  park_id: string;
  starts_at: string;
  ends_at: string;
  disciplines: Discipline[];
  title: string | null;
  note: string | null;
  cover_path: string | null;
  status: Enums['meetup_status'];
  cancel_reason: MeetupCancelReason | null;
  cancel_note: string | null;
  went_count: number | null;
  series: { id: string; host_id: string; visibility: MeetupVisibility; weekdays: number[]; ended_at: string | null };
  park: {
    id: string;
    slug: string;
    display_name: string;
    latitude: number | null;
    longitude: number | null;
    metro: { timezone: string | null } | null;
  };
};

/** One date of a meetup, or null when you can't see it (or it's gone). */
export function useMeetup(eventId: string | undefined) {
  return useQuery({
    queryKey: keys.meetup(eventId ?? ''),
    queryFn: async (): Promise<Meetup | null> => {
      const { data, error } = await supabase.from('events').select(MEETUP_SELECT).eq('id', eventId!).maybeSingle();
      if (error) throw error;
      return (data as unknown as Meetup | null) ?? null;
    },
    enabled: Boolean(eventId),
    staleTime: fresh.social,
  });
}

/**
 * A meetup's headline: its title, or (Nov 3) its one line when it has no
 * title, or "Meetup at Memo" when it has neither.
 */
export function meetupHeadline(m: { title: string | null; note: string | null; park: { display_name: string } }, t: TFunction) {
  return m.title ?? m.note ?? t('meetup.fallbackTitle', { park: m.park.display_name });
}

/** "Every Thursday", "Every Mon, Wed and Fri", or null for a one-off. */
export function repeatLabel(weekdays: number[], t: TFunction, locale: string): string | null {
  if (weekdays.length === 0) return null;
  if (weekdays.length === 7) return t('meetup.everyDay');
  const name = (d: number, style: 'long' | 'short') =>
    // 2026-01-05 was a Monday.
    new Intl.DateTimeFormat(locale, { weekday: style, timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 0, 4 + d)));
  if (weekdays.length === 1) return t('meetup.everyWeekday', { day: name(weekdays[0], 'long') });
  const days = new Intl.ListFormat(locale, { style: 'short', type: 'conjunction' }).format(
    weekdays.map((d) => name(d, 'short')),
  );
  return t('meetup.everyDays', { days });
}

/* The park's clock ----------------------------------------------------------------- */

/**
 * The instant that is `minutes` past midnight on y-m-d on the park's clock.
 * Two passes of "guess, see what the clock says, correct" settle any offset,
 * including the day the clocks change.
 */
export function zonedToUtc(y: number, m: number, d: number, minutes: number, timeZone: string | null): Date {
  const target = Date.UTC(y, m - 1, d, Math.floor(minutes / 60), minutes % 60);
  let guess = target;
  for (let i = 0; i < 2; i++) {
    const seen = localNow(new Date(guess), timeZone);
    const shown = Date.UTC(seen.year, seen.month - 1, seen.day, Math.floor(seen.minutes / 60), seen.minutes % 60);
    guess += target - shown;
  }
  return new Date(guess);
}

/** Whether the phone's clock and the park's clock disagree right now. */
export function clocksDiffer(timeZone: string | null | undefined, at: Date): boolean {
  if (!timeZone) return false;
  const park = localNow(at, timeZone);
  const phone = localNow(at, null);
  return park.minutes !== phone.minutes || park.day !== phone.day;
}

/* Going ------------------------------------------------------------------------------ */

export type GoingPerson = Fns['event_going_list']['Returns'][number];
export type GoingSummary = Fns['event_going_summary']['Returns'][number];

/** The going list as you may see it, and the count (everyone). */
export function useGoing(eventId: string | undefined) {
  return useQuery({
    queryKey: keys.meetupGoing(eventId ?? ''),
    queryFn: async () => {
      const [list, summary] = await Promise.all([
        supabase.rpc('event_going_list', { event: eventId! }),
        supabase.rpc('event_going_summary', { event: eventId! }),
      ]);
      if (list.error) throw list.error;
      if (summary.error) throw summary.error;
      return { people: list.data ?? [], summary: (summary.data ?? [])[0] ?? null };
    },
    enabled: Boolean(eventId),
    staleTime: fresh.social,
  });
}

export function useSetGoing(eventId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (args: { going: boolean; goingPrivately?: boolean; remindMe?: boolean }) => {
      const { error } = await supabase.rpc('set_going', {
        event: eventId!,
        going: args.going,
        going_privately: args.goingPrivately,
        remind_me: args.remindMe,
      });
      if (error) throw error;
    },
    // Every meetup key starts with 'meetups', so cards elsewhere (Home, the
    // park page, profiles) pick up the new count and button too.
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['meetups'] }),
  });
}

/** Whether you follow a repeating meetup, and the switch. */
export function useSeriesFollow(seriesId: string | undefined, userId: string | undefined) {
  const queryClient = useQueryClient();
  const key = keys.seriesFollow(seriesId ?? '', userId ?? '');
  const query = useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('event_series_follows')
        .select('series_id')
        .eq('series_id', seriesId!)
        .eq('user_id', userId!)
        .maybeSingle();
      if (error) throw error;
      return Boolean(data);
    },
    enabled: Boolean(seriesId && userId),
    staleTime: fresh.mine,
  });
  const toggle = useMutation({
    mutationFn: async (follow: boolean) => {
      const { error } = await supabase.rpc('follow_meetup_series', { series: seriesId!, follow });
      if (error) throw error;
    },
    onMutate: (follow) => queryClient.setQueryData(key, follow),
    onError: (_e, follow) => queryClient.setQueryData(key, !follow),
  });
  return { following: query.data ?? false, toggle };
}

/** Your Going privately default (Settings › Privacy), with null resolved. */
export function useGoingPrivatelyDefault(userId: string | undefined) {
  return useQuery({
    queryKey: keys.goingPrivately(userId ?? ''),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('my_going_privately_default');
      if (error) throw error;
      return Boolean(data);
    },
    enabled: Boolean(userId),
    staleTime: fresh.mine,
  });
}

export function useSetGoingPrivatelyDefault(userId: string | undefined) {
  const queryClient = useQueryClient();
  const key = keys.goingPrivately(userId ?? '');
  return useMutation({
    mutationFn: async (value: boolean) => {
      const { error } = await supabase.rpc('set_going_privately_default', { value });
      if (error) throw error;
    },
    onMutate: (value) => {
      const previous = queryClient.getQueryData<boolean>(key);
      queryClient.setQueryData(key, value);
      return { previous };
    },
    onError: (_e, _v, ctx) => queryClient.setQueryData(key, ctx?.previous),
  });
}

/* Comments ---------------------------------------------------------------------------- */

export type MeetupComment = Fns['meetup_comments']['Returns'][number];
export type MeetupThread = { comment: MeetupComment; replies: MeetupComment[] };

export function useMeetupComments(eventId: string | undefined) {
  return useQuery({
    queryKey: keys.meetupComments(eventId ?? ''),
    queryFn: async (): Promise<MeetupThread[]> => {
      const { data, error } = await supabase.rpc('meetup_comments', { event: eventId! });
      if (error) throw error;
      const threads: MeetupThread[] = [];
      const byId = new Map<string, MeetupThread>();
      for (const c of data ?? []) {
        if (!c.parent_id) {
          const thread = { comment: c, replies: [] };
          threads.push(thread);
          byId.set(c.id, thread);
        } else {
          byId.get(c.parent_id)?.replies.push(c);
        }
      }
      return threads;
    },
    enabled: Boolean(eventId),
    staleTime: fresh.social,
  });
}

export function useAddMeetupComment(eventId: string | undefined, userId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (args: { body: string; parentId?: string | null; replyToUserId?: string | null }) => {
      const { error } = await supabase.from('event_comments').insert({
        event_id: eventId!,
        author_id: userId!,
        body: args.body,
        parent_id: args.parentId ?? null,
        reply_to_user_id: args.replyToUserId ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: keys.meetupComments(eventId ?? '') }),
  });
}

export function useDeleteMeetupComment(eventId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (commentId: string) => {
      const { error } = await supabase.rpc('delete_meetup_comment', { comment: commentId });
      if (error) throw error;
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: keys.meetupComments(eventId ?? '') }),
  });
}

/* Making a meetup --------------------------------------------------------------------- */

export type Season = { park: { id: string; name: string }; fromMonth: number; toMonth: number };

export type MeetupDraft = {
  park: { id: string; name: string; timeZone: string | null } | null;
  startsAt: Date | null;
  endsAt: Date | null;
  note: string;
  title: string;
  visibility: MeetupVisibility;
  disciplines: Discipline[];
  weekdays: number[];
  repeatEndsOn: string | null;
  seasons: Season[];
  coHosts: { id: string; username: string }[];
  cover: { uri: string; width: number; height: number } | null;
};

export function useCreateMeetup(userId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (d: MeetupDraft): Promise<string> => {
      if (!userId || !d.park || !d.startsAt) throw new Error('incomplete');
      const coverPath = d.cover ? await uploadMeetupCover(userId, d.cover.uri) : null;
      const { data, error } = await supabase.rpc('create_meetup', {
        park: d.park.id,
        starts_at: d.startsAt.toISOString(),
        ends_at: d.endsAt?.toISOString(),
        note: d.note.trim() || undefined,
        title: d.title.trim() || undefined,
        visibility: d.visibility,
        disciplines: d.disciplines,
        cover_path: coverPath ?? undefined,
        weekdays: d.weekdays.length ? d.weekdays : undefined,
        repeat_ends_on: d.repeatEndsOn ?? undefined,
        seasons: d.seasons.length
          ? d.seasons.map((s) => ({ park: s.park.id, from_month: s.fromMonth, to_month: s.toMonth }))
          : undefined,
        co_hosts: d.coHosts.length ? d.coHosts.map((p) => p.id) : undefined,
      });
      if (error) {
        if (coverPath) void supabase.storage.from(COVER_BUCKET).remove([coverPath]);
        throw error;
      }
      return data as string;
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['meetups'] }),
  });
}

/* Covers ---------------------------------------------------------------------------- */

const COVER_WIDTH = 1600;

/** Resizes a picked photo to a JPEG at most 1600 px wide and uploads it to <user>/<new id>.jpg. */
export async function uploadMeetupCover(userId: string, localUri: string): Promise<string> {
  const ctx = ImageManipulator.manipulate(localUri);
  ctx.resize({ width: COVER_WIDTH });
  const image = await ctx.renderAsync();
  const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.8 });
  const path = `${userId}/${uuid()}.jpg`;
  const bytes = await new File(saved.uri).arrayBuffer();
  const { error } = await supabase.storage.from(COVER_BUCKET).upload(path, bytes, {
    contentType: 'image/jpeg',
    upsert: false,
  });
  if (error) throw error;
  return path;
}

/** A signed URL for a meetup's cover, valid for an hour. */
export function useCoverUrl(path: string | null | undefined) {
  return useQuery({
    queryKey: keys.meetupCover(path ?? ''),
    queryFn: async () => {
      const { data, error } = await supabase.storage.from(COVER_BUCKET).createSignedUrl(path!, 3600);
      if (error) throw error;
      return data.signedUrl;
    },
    enabled: Boolean(path),
    staleTime: fresh.avatars,
  });
}

/** A park's time zone (its metro area's), for times on the park's clock. */
export function useParkTimeZone(parkId: string | null | undefined) {
  return useQuery({
    queryKey: ['park-tz', parkId ?? ''],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('parks')
        .select('metro:metro_areas(timezone)')
        .eq('id', parkId!)
        .maybeSingle();
      if (error) throw error;
      return ((data as { metro: { timezone: string | null } | null } | null)?.metro?.timezone ?? null) as string | null;
    },
    enabled: Boolean(parkId),
    staleTime: fresh.parks,
  });
}

/* Co-host invites ---------------------------------------------------------------------- */

/** Your row on a meetup's hosts, if any: host, co-host, or an invite waiting for you. */
export function useMyHostRow(seriesId: string | undefined, userId: string | undefined) {
  return useQuery({
    queryKey: ['meetups', 'host-row', seriesId ?? '', userId ?? ''],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('event_hosts')
        .select('role, accepted_at, invited_by:profiles!event_hosts_invited_by_fkey(username)')
        .eq('series_id', seriesId!)
        .eq('user_id', userId!)
        .maybeSingle();
      if (error) throw error;
      return data as { role: 'host' | 'co_host'; accepted_at: string | null; invited_by: { username: string | null } | null } | null;
    },
    enabled: Boolean(seriesId && userId),
    staleTime: fresh.mine,
  });
}

export function useRespondCoHost(seriesId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (accept: boolean) => {
      const { error } = await supabase.rpc('respond_co_host_invite', { series: seriesId!, accept });
      if (error) throw error;
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['meetups'] }),
  });
}

/* Where meetups show (PR 4) ------------------------------------------------------------ */

/**
 * A date as lists show it: the meetup page's fields plus what the card
 * needs, computed in the database (migration `meetups_everywhere`): its
 * place in Home, the count going (or "went"), up to three faces you may
 * see, whether you're going, the hosts, and comment and linked-post counts.
 */
const CARD_SELECT = `${MEETUP_SELECT},
  feed_at, going_total, going_faces, i_am_going, host_list, meetup_comment_count, linked_post_count`;

export type MeetupFace = { id: string; username: string | null; avatar_path: string | null; following: boolean };
export type MeetupHost = { id: string; username: string | null; avatar_path: string | null; role: 'host' | 'co_host' };

export type MeetupCard = Meetup & {
  feed_at: string;
  going_total: number;
  going_faces: MeetupFace[];
  i_am_going: boolean;
  host_list: MeetupHost[];
  meetup_comment_count: number;
  linked_post_count: number;
};

type CardFn =
  | 'feed_meetups'
  | 'park_meetups'
  | 'park_past_meetups'
  | 'profile_meetups'
  | 'profile_past_meetups';

async function cardsFrom(fn: CardFn, args: Record<string, unknown>): Promise<MeetupCard[]> {
  const { data, error } = await supabase.rpc(fn as never, args as never).select(CARD_SELECT);
  if (error) throw error;
  return ((data ?? []) as unknown as MeetupCard[]).map((m) => ({
    ...m,
    going_total: m.going_total ?? 0,
    going_faces: m.going_faces ?? [],
    host_list: m.host_list ?? [],
    meetup_comment_count: m.meetup_comment_count ?? 0,
    linked_post_count: m.linked_post_count ?? 0,
  }));
}

/** One meetup date with the card fields (the past meetup page's counts). */
export function useMeetupCard(eventId: string | undefined) {
  return useQuery({
    queryKey: ['meetups', 'card', eventId ?? ''],
    queryFn: async (): Promise<MeetupCard | null> => {
      const { data, error } = await supabase.from('events').select(CARD_SELECT).eq('id', eventId!).maybeSingle();
      if (error) throw error;
      return (data as unknown as MeetupCard | null) ?? null;
    },
    enabled: Boolean(eventId),
    staleTime: fresh.social,
  });
}

/**
 * Meetup cards for Home whose place falls after `newerThan` (the oldest post
 * loaded so far), so they sit among the posts by time. Null once the posts
 * from people you follow have run out: then every older card comes too.
 */
export function useHomeMeetups(userId: string | undefined, newerThan: string | null, enabled = true) {
  return useQuery({
    queryKey: keys.homeMeetups(userId ?? '', newerThan ?? 'all'),
    queryFn: () => cardsFrom('feed_meetups', { newer_than: newerThan, up_to: null, max_results: 50 }),
    enabled: Boolean(userId) && enabled,
    staleTime: fresh.posts,
    placeholderData: keepPreviousData,
  });
}

/** A park's Upcoming: each meetup once, at its next date. */
export function useParkMeetups(parkId: string | undefined, max = 5) {
  return useQuery({
    queryKey: [...keys.parkMeetups(parkId ?? ''), max],
    queryFn: () => cardsFrom('park_meetups', { park: parkId, max_results: max }),
    enabled: Boolean(parkId),
    staleTime: fresh.social,
    placeholderData: keepPreviousData,
  });
}

export function useParkPastMeetupCount(parkId: string | undefined) {
  return useQuery({
    queryKey: keys.parkPastMeetupCount(parkId ?? ''),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('park_past_meetup_count', { park: parkId! });
      if (error) throw error;
      return data ?? 0;
    },
    enabled: Boolean(parkId),
    staleTime: fresh.social,
  });
}

const PAST_PAGE = 10;

function usePastPages(key: readonly unknown[], fetchPage: (cursor: { at: string; id: string } | null) => Promise<MeetupCard[]>, enabled: boolean) {
  return useInfiniteQuery<MeetupCard[], Error, InfiniteData<MeetupCard[]>, readonly unknown[], { at: string; id: string } | null>({
    queryKey: key,
    queryFn: ({ pageParam }) => fetchPage(pageParam),
    initialPageParam: null,
    getNextPageParam: (last) => (last.length < PAST_PAGE ? undefined : { at: last[last.length - 1].starts_at, id: last[last.length - 1].id }),
    enabled,
    staleTime: fresh.social,
  });
}

/** A park's Past meetups, newest first; loads once the row is opened. */
export function useParkPastMeetups(parkId: string | undefined, enabled: boolean) {
  return usePastPages(
    keys.parkPastMeetups(parkId ?? ''),
    (cursor) =>
      cardsFrom('park_past_meetups', { park: parkId, before_at: cursor?.at ?? null, before_id: cursor?.id ?? null, max_results: PAST_PAGE }),
    Boolean(parkId) && enabled,
  );
}

/** Meetups a member hosts or co-hosts: Upcoming (each once) … */
export function useProfileMeetups(userId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: keys.profileMeetups(userId ?? ''),
    queryFn: () => cardsFrom('profile_meetups', { person: userId, max_results: 20 }),
    enabled: Boolean(userId) && enabled,
    staleTime: fresh.social,
  });
}

/** … and Past, newest first. */
export function useProfilePastMeetups(userId: string | undefined, enabled = true) {
  return usePastPages(
    keys.profilePastMeetups(userId ?? ''),
    (cursor) =>
      cardsFrom('profile_past_meetups', { person: userId, before_at: cursor?.at ?? null, before_id: cursor?.id ?? null, max_results: PAST_PAGE }),
    Boolean(userId) && enabled,
  );
}

/* From this session -------------------------------------------------------------------- */

export type RecentMeetup = Fns['my_recent_meetups']['Returns'][number];

/**
 * Meetups at this park you said you were going to (or hosted) that started
 * and ended within the last 7 days: the "From Thursday's meetup?" chip.
 */
export function useRecentMeetups(userId: string | undefined, parkId: string | null | undefined) {
  return useQuery({
    queryKey: keys.recentMeetups(userId ?? '', parkId ?? ''),
    queryFn: async (): Promise<RecentMeetup[]> => {
      const { data, error } = await supabase.rpc('my_recent_meetups', { park: parkId! });
      if (error) throw error;
      return data ?? [];
    },
    enabled: Boolean(userId && parkId),
    staleTime: fresh.mine,
  });
}

/** "Thursday's", on the park's clock: the chip's day name. */
export function meetupDayName(startsAt: string, timeZone: string | null | undefined, locale: string): string {
  return new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: timeZone ?? undefined }).format(new Date(startsAt));
}

/* Checking in from your profile -------------------------------------------------------- */

export type NearbyPark = Fns['check_in_parks']['Returns'][number];

/** Parks within about 500 m of a position, nearest first. The position isn't kept. */
export async function fetchCheckInParks(latitude: number, longitude: number): Promise<NearbyPark[]> {
  const { data, error } = await supabase.rpc('check_in_parks', { latitude, longitude });
  if (error) throw error;
  return data ?? [];
}
