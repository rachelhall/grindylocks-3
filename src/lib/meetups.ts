/**
 * Meetups (v2): reading a meetup, going, comments, making one, covers, and
 * (PR 5) changing, cancelling, deleting and hiding one.
 *
 * The rules live in the database (migrations `meetups` and `meetup_covers`):
 * who can see a meetup, who's named on the going list, what hosts and
 * co-hosts may do. This file only asks. A meetup is a series (one-off or
 * repeating); each date is its own row (`events`), and the app opens dates.
 *
 * Pages as hosts (brand and shop accounts part A, PR 9, migration
 * `page_meetups`): a meetup can be hosted by a page instead of a person, and
 * then can meet at the page's own shop or an address instead of a park, run
 * over several days, and carry a capacity, a ticket link and 18+. The
 * computed fields (`meetup_host_page`, `meetup_place_info`, …) answer what
 * the screens need, so a page meetup never names the member who made it.
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
import { pageKind } from './pages';
import { fresh, keys } from './query';
import { supabase } from './supabase';
import { uuid } from './uuid';

type Fns = Database['public']['Functions'];
type Enums = Database['public']['Enums'];

export type MeetupVisibility = Enums['meetup_visibility'];
export type MeetupCancelReason = Enums['meetup_cancel_reason'];
export type Discipline = Enums['discipline'];
export type MeetupPlace = Enums['meetup_place'];

export const MEETUP_TITLE_MAX = 80;
export const MEETUP_NOTE_MAX = 280;
/** Who it's for: one line under the title (the database checks the same). */
export const WHO_FOR_MAX = 60;
export const MAX_CO_HOSTS = 10;
export const COVER_BUCKET = 'meetup-covers';
/** Pages: spots, a meetup over several days, and the ticket link (as the database checks them). */
export const MAX_CAPACITY = 10000;
export const MAX_DAYS = 14;
export const MAX_TICKET_URL = 500;

// The park is a left join: a page meetup can be at the page's shop or an address.
const MEETUP_SELECT = `
  id, series_id, park_id, starts_at, ends_at, disciplines, title, note, cover_path,
  status, cancel_reason, cancel_note, went_count, hidden_at,
  place, capacity, ticket_url, adults_only, multi_day, who_for,
  series:event_series!inner(id, host_id, host_page_id, visibility, weekdays, ended_at),
  park:parks(id, slug, display_name, latitude, longitude, metro:metro_areas(timezone)),
  meetup_host_page, meetup_place_info, meetup_timezone, meetup_official, spots_taken, meetup_days, i_run_meetup
`;

/** The page hosting a meetup (PR 9). */
export type HostPage = {
  id: string;
  handle: string;
  display_name: string;
  logo_path: string | null;
  state: Enums['page_state'];
  roles: Enums['page_role'][];
};

/** Where a date happens: a park, the host page's own shop (live), or an address with a pin. */
export type PlaceInfo = {
  kind: MeetupPlace;
  park: { id: string; slug: string; display_name: string } | null;
  page: { id: string; handle: string; display_name: string; address: string | null } | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  metro_name: string | null;
};

/** One day of a meetup over several days, on the place's clock. */
export type MeetupDay = { day: string; starts_at: string; ends_at: string };

export type Meetup = {
  id: string;
  series_id: string;
  park_id: string | null;
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
  /** Hidden by park admins: then only hosts and moderators see it. */
  hidden_at: string | null;
  place: MeetupPlace;
  /** Pages only: spots (hosts and co-hosts don't take one), a https:// ticket link, 18+. */
  capacity: number | null;
  ticket_url: string | null;
  adults_only: boolean;
  multi_day: boolean;
  /** Who it's for: a line under the title (any host). Information, not a rule. */
  who_for: string | null;
  series: {
    id: string;
    host_id: string | null;
    host_page_id: string | null;
    visibility: MeetupVisibility;
    weekdays: number[];
    ended_at: string | null;
  };
  /** Null when the meetup isn't at a park (a page's shop or an address). */
  park: {
    id: string;
    slug: string;
    display_name: string;
    latitude: number | null;
    longitude: number | null;
    metro: { timezone: string | null } | null;
  } | null;
  meetup_host_page: HostPage | null;
  meetup_place_info: PlaceInfo | null;
  meetup_timezone: string | null;
  /** Hosted by the page that runs the park. */
  meetup_official: boolean | null;
  /** Everyone going, when there's a capacity. */
  spots_taken: number | null;
  meetup_days: MeetupDay[] | null;
  /** You're on the host page's team (you manage it as the page). */
  i_run_meetup: boolean | null;
};

/** The place's clock: the park's, else the host page's own. */
export function meetupTz(m: Pick<Meetup, 'meetup_timezone' | 'park'>): string | null {
  return m.meetup_timezone ?? m.park?.metro?.timezone ?? null;
}

/**
 * Where it is, in a word: the park's name, "8SET (the shop)", "Blading Camp
 * base" (an organizer's base), or the address's first line.
 */
export function meetupPlaceName(
  m: {
    park?: { display_name: string } | null;
    meetup_place_info?: PlaceInfo | null;
    place?: MeetupPlace;
    meetup_host_page?: Pick<HostPage, 'roles'> | null;
  },
  t: TFunction,
): string {
  const info = m.meetup_place_info ?? null;
  const kind = info?.kind ?? m.place ?? 'park';
  if (kind === 'page' && info?.page) {
    const base = m.meetup_host_page && pageKind(m.meetup_host_page) === 'organizer';
    return t(base ? 'pageMeet.theBase' : 'pageMeet.theShop', { name: info.page.display_name });
  }
  if (kind === 'address' && info?.address) return info.address.split(/\n|,/)[0].trim();
  return m.park?.display_name ?? info?.park?.display_name ?? '';
}

/**
 * Why a date was cancelled, as a tag reads it. The page tools' reasons
 * (PR 9): Close for good reads "The shop has closed"; Suspend reads "No
 * longer happening", since skaters aren't told about a suspension.
 */
export function cancelReasonLabel(
  reason: MeetupCancelReason | null,
  hostPage: Pick<HostPage, 'roles'> | null,
  t: TFunction,
): string {
  if (reason === 'page_closed') {
    const kind = hostPage ? pageKind(hostPage) : 'shop';
    return t(kind === 'organizer' ? 'pageMeet.organizerClosed' : kind === 'brand' ? 'pageMeet.brandClosed' : 'pageMeet.shopClosed');
  }
  if (reason === 'page_suspended') return t('pageMeet.noLongerHappening');
  const key = (['rained_out', 'park_closed', 'something_came_up'] as const).find((r) => r === reason) ?? 'other';
  return t(`meetup.reason.${key}`);
}

/** Spots left, or null without a capacity. */
export function spotsLeft(m: Pick<Meetup, 'capacity' | 'spots_taken'>): number | null {
  if (m.capacity === null) return null;
  return Math.max(0, m.capacity - (m.spots_taken ?? 0));
}


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
export function meetupHeadline(
  m: { title: string | null; note: string | null; park?: { display_name: string } | null; meetup_place_info?: PlaceInfo | null },
  t: TFunction,
) {
  return m.title ?? m.note ?? t('meetup.fallbackTitle', { park: meetupPlaceName(m, t) });
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
    mutationFn: async (args: { going: boolean; goingPrivately?: boolean; remindMe?: boolean; confirmedAdult?: boolean }) => {
      const { error } = await supabase.rpc('set_going', {
        event: eventId!,
        going: args.going,
        going_privately: args.goingPrivately,
        remind_me: args.remindMe,
        confirmed_adult: args.confirmedAdult,
      });
      if (error) throw error;
    },
    // Every meetup key starts with 'meetups', so cards elsewhere (Home, the
    // park page, profiles) pick up the new count and button too.
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['meetups'] }),
  });
}

/** set_going's refusals the Going sheet explains (PR 9): 18+ needs the confirm, and a full meetup. */
export function goingError(err: unknown): 'adult_confirm_needed' | 'meetup_full' | null {
  const message = (err as { message?: string } | null)?.message;
  return message === 'adult_confirm_needed' || message === 'meetup_full' ? message : null;
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

/** A comment; `page` is set when the host page made it (PR 9), and then there's no author. */
export type MeetupComment = Omit<Fns['meetup_comments']['Returns'][number], 'page'> & {
  page: { id: string; handle: string; display_name: string; logo_path: string | null } | null;
};
export type MeetupThread = { comment: MeetupComment; replies: MeetupComment[] };

export function useMeetupComments(eventId: string | undefined) {
  return useQuery({
    queryKey: keys.meetupComments(eventId ?? ''),
    queryFn: async (): Promise<MeetupThread[]> => {
      const { data, error } = await supabase.rpc('meetup_comments', { event: eventId! });
      if (error) throw error;
      const threads: MeetupThread[] = [];
      const byId = new Map<string, MeetupThread>();
      for (const c of (data ?? []) as unknown as MeetupComment[]) {
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
    mutationFn: async (args: { body: string; parentId?: string | null; replyToUserId?: string | null; asPage?: string | null }) => {
      // As the host page (PR 9): no author; the database keeps who wrote it.
      const { error } = await supabase.from('event_comments').insert({
        event_id: eventId!,
        author_id: args.asPage ? null : userId!,
        page_id: args.asPage ?? null,
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

/** A day of a meetup over several days, as picked (on the place's clock). */
export type DraftDay = { startsAt: Date; endsAt: Date };

export type MeetupDraft = {
  /** The page it's posted as (PR 9), or null for you. */
  asPage: string | null;
  place: MeetupPlace;
  park: { id: string; name: string; timeZone: string | null } | null;
  /** place 'address': the address and its pin. */
  address: { text: string; latitude: number; longitude: number } | null;
  /** Several days (pages only), 2 to 14 in a row; null for one day. */
  days: DraftDay[] | null;
  capacity: number | null;
  ticketUrl: string;
  adultsOnly: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
  note: string;
  title: string;
  /** Who it's for (any host), up to WHO_FOR_MAX characters. */
  whoFor: string;
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
      const placed = d.place === 'park' ? Boolean(d.park) : d.place === 'address' ? Boolean(d.address) : true;
      if (!userId || !placed || (!d.startsAt && !d.days)) throw new Error('incomplete');
      const coverPath = d.cover ? await uploadMeetupCover(userId, d.cover.uri) : null;
      const page = d.asPage;
      const { data, error } = await supabase.rpc('create_meetup', {
        park: d.place === 'park' ? d.park?.id : undefined,
        starts_at: d.days ? undefined : d.startsAt?.toISOString(),
        ends_at: d.days ? undefined : d.endsAt?.toISOString(),
        as_page: page ?? undefined,
        place: page ? d.place : undefined,
        address: page && d.place === 'address' ? d.address?.text : undefined,
        latitude: page && d.place === 'address' ? d.address?.latitude : undefined,
        longitude: page && d.place === 'address' ? d.address?.longitude : undefined,
        capacity: page && d.capacity ? d.capacity : undefined,
        ticket_url: page && d.ticketUrl.trim() ? d.ticketUrl.trim() : undefined,
        adults_only: page && d.adultsOnly ? true : undefined,
        days: page && d.days ? (d.days.map((x) => ({ starts_at: x.startsAt.toISOString(), ends_at: x.endsAt.toISOString() })) as never) : undefined,
        note: d.note.trim() || undefined,
        title: d.title.trim() || undefined,
        who_for: d.whoFor.trim() || undefined,
        visibility: d.visibility,
        disciplines: d.disciplines,
        cover_path: coverPath ?? undefined,
        weekdays: d.weekdays.length && !d.days ? d.weekdays : undefined,
        repeat_ends_on: d.repeatEndsOn ?? undefined,
        seasons: d.seasons.length && d.place === 'park'
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
/** A host on a card: a page host comes first as kind 'page' (`username` is its name). */
export type MeetupHost = {
  kind?: 'page' | 'person';
  id: string;
  username: string | null;
  avatar_path: string | null;
  handle?: string;
  logo_path?: string | null;
  role: 'host' | 'co_host';
};

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
  | 'profile_past_meetups'
  | 'page_meetups';

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

/** A page's Upcoming (PR 9): each meetup once at its next date, cancelled ones crossed out. */
export function usePageMeetups(pageId: string | undefined, max = 5, enabled = true) {
  return useQuery({
    queryKey: [...keys.pageMeetups(pageId ?? ''), max],
    queryFn: () => cardsFrom('page_meetups', { page: pageId, max_results: max }),
    enabled: Boolean(pageId) && enabled,
    staleTime: fresh.social,
    placeholderData: keepPreviousData,
  });
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

/* Changing, cancelling and deleting (PR 5) ------------------------------------------- */

/** The fields an edit can change; only the ones that changed are sent. */
export type MeetupChanges = {
  park?: string;
  /** Pages (PR 9): the place, the page-only fields and the days of a meetup over several days. */
  place?: MeetupPlace;
  address?: string;
  latitude?: number;
  longitude?: number;
  /** An empty string clears it. */
  capacity?: number | '';
  ticket_url?: string;
  adults_only?: boolean;
  days?: { starts_at: string; ends_at: string }[];
  starts_at?: string;
  ends_at?: string;
  title?: string;
  note?: string;
  /** An empty string clears it. */
  who_for?: string;
  disciplines?: Discipline[];
  visibility?: MeetupVisibility;
  /** An empty string removes the cover. */
  cover_path?: string;
};

/**
 * Edits a date, or (scope 'upcoming') this date and every later one of the
 * series. Hosts and co-hosts. A change to the day, time or park tells the
 * people going (the database does that).
 */
export function useUpdateMeetup(eventId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ scope, changes }: { scope: 'date' | 'upcoming'; changes: MeetupChanges }) => {
      const { error } = await supabase.rpc('update_meetup', { event: eventId!, scope, changes: changes as never });
      if (error) throw error;
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['meetups'] }),
  });
}

/** Cancels this date, or (scope 'series', the host only) every date from this one on, ending the series. */
export function useCancelMeetup(eventId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (args: { reason: MeetupCancelReason; scope: 'date' | 'series'; note: string }) => {
      const { error } = await supabase.rpc('cancel_meetup', {
        event: eventId!,
        reason: args.reason,
        scope: args.scope,
        note: args.note.trim() || undefined,
      });
      if (error) throw error;
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['meetups'] }),
  });
}

/** Whether Delete is still offered: the host, nobody else going, before it starts. */
export function useCanDeleteMeetup(eventId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['meetups', 'can-delete', eventId ?? ''],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('can_delete_meetup', { event: eventId! });
      if (error) throw error;
      return Boolean(data);
    },
    enabled: Boolean(eventId) && enabled,
    staleTime: 0,
  });
}

export function useDeleteMeetup(eventId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('delete_meetup', { event: eventId! });
      if (error) throw error;
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['meetups'] }),
  });
}

/** Hosts quietly take someone off Going (they aren't told). */
export function useRemoveFromGoing(eventId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (personId: string) => {
      const { error } = await supabase.rpc('remove_from_going', { event: eventId!, person: personId });
      if (error) throw error;
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['meetups'] }),
  });
}

/* Co-hosts after the meetup is made (the host only) ----------------------------------- */

export type CoHostRow = { user_id: string; username: string | null; avatar_path: string | null; accepted: boolean };

/** The co-hosts of a series, accepted and invited (the host sees both). */
export function useCoHosts(seriesId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['meetups', 'co-hosts', seriesId ?? ''],
    queryFn: async (): Promise<CoHostRow[]> => {
      const { data, error } = await supabase
        .from('event_hosts')
        .select('user_id, accepted_at, person:profiles!event_hosts_user_id_fkey(username, avatar_path)')
        .eq('series_id', seriesId!)
        .eq('role', 'co_host')
        .order('created_at');
      if (error) throw error;
      return ((data ?? []) as unknown as {
        user_id: string;
        accepted_at: string | null;
        person: { username: string | null; avatar_path: string | null } | null;
      }[]).map((r) => ({
        user_id: r.user_id,
        username: r.person?.username ?? null,
        avatar_path: r.person?.avatar_path ?? null,
        accepted: r.accepted_at !== null,
      }));
    },
    enabled: Boolean(seriesId) && enabled,
    staleTime: fresh.mine,
  });
}

export function useInviteCoHosts(seriesId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (people: string[]) => {
      const { error } = await supabase.rpc('invite_co_hosts', { series: seriesId!, people });
      if (error) throw error;
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ['meetups'] }),
  });
}

export function useRemoveCoHost(seriesId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (person: string) => {
      const { error } = await supabase.rpc('remove_co_host', { series: seriesId!, person });
      if (error) throw error;
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ['meetups'] }),
  });
}

/* Park admins hiding a date ------------------------------------------------------------ */

/**
 * Whether you moderate this date's park (its park admins, the city admin and
 * the owner). Members whose own profile is cached without a role skip the call.
 */
export function useCanHideMeetup(eventId: string | undefined, hasRoles: boolean) {
  return useQuery({
    queryKey: ['meetups', 'can-hide', eventId ?? ''],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('can_hide_meetup', { event: eventId! });
      if (error) throw error;
      return Boolean(data);
    },
    enabled: Boolean(eventId) && hasRoles,
    staleTime: fresh.mine,
  });
}

export function useHideMeetup(eventId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (hide: boolean) => {
      const { error } = await supabase.rpc('hide_meetup', { event: eventId!, hide });
      if (error) throw error;
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['meetups'] }),
  });
}

/* The @ list in meetup comments ------------------------------------------------------- */

export type MeetupMentionPerson = { id: string; username: string; avatarPath: string | null; reason: 'host' | 'commented' | 'following' | 'other' };

/**
 * People to suggest after @ in a meetup's comments: only people who can see
 * the meetup (the database checks), hosts and commenters first.
 */
export function useMeetupMentionPeople(eventId: string | undefined, q: string | null) {
  return useQuery({
    queryKey: ['meetups', 'mention', eventId ?? '', (q ?? '').toLowerCase()],
    queryFn: async (): Promise<MeetupMentionPerson[]> => {
      const { data, error } = await supabase.rpc('meetup_mention_people', { event: eventId!, q: q ?? '' });
      if (error) throw error;
      return (data ?? []).map((p) => ({
        id: p.id,
        username: p.username as string,
        avatarPath: p.avatar_path,
        reason: p.reason as MeetupMentionPerson['reason'],
      }));
    },
    enabled: Boolean(eventId) && q !== null,
    staleTime: fresh.search,
    placeholderData: keepPreviousData,
  });
}
