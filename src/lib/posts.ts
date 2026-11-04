/**
 * Posts (M4a): reading them for feeds, profile tabs, park and obstacle pages
 * and post detail, and changing their tags after publishing.
 *
 * - Every list reads full post rows with PostgREST embedding, from plain
 *   queries (a member's posts, a park's posts) or from Postgres functions
 *   that return posts rows (feed_following, feed_nearby, obstacle_posts,
 *   tagged_posts, filmed_posts). The posts read rules apply either way, so
 *   private accounts and blocks are handled in the database.
 * - Paging is keyset on (published_at, id), newest first.
 * - Photo URLs are signed for an hour, so post queries use `fresh.posts`.
 * - Each post carries its comment count and whether you liked it (M4b);
 *   comments and likes themselves live in `./engagement`.
 */
import { type InfiniteData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { Database } from './database.types';
import { type FramePoint, photoUrls, videoKeys } from './media';
import type { PageRole, PageState } from './pages';
import type { ObstacleType } from './parks';
import type { GridPost } from './profiles';
import { fresh, keys } from './query';
import { supabase } from './supabase';

type Enums = Database['public']['Enums'];

/** Everything a post card or post detail shows, in one select. */
export const POST_SELECT = `id, author_id, page_id, near_you, caption, created_at, published_at, edited_at, park_id, event_id, slide_count, anonymized,
  comment_count, liked_by_me,
  author:profiles!posts_author_id_fkey(id, username, avatar_path, deleted_at),
  page:pages!posts_page_id_fkey(id, handle, display_name, roles, state, logo_path),
  park:parks!posts_park_id_fkey(id, slug, display_name),
  metro:metro_areas!posts_metro_area_id_fkey(id, name),
  post_slides(id, position, kind, width, height, frame_x, frame_y, duration_s, upload_status, storage_path, stream_video_id,
    obstacle_id, obstacle_type, filmer_id,
    obstacle:obstacles!post_slides_obstacle_id_fkey(id, name, general_type),
    filmer:profiles!post_slides_filmer_id_fkey(id, username),
    slide_people_tags(user_id, person:profiles!slide_people_tags_user_id_fkey(id, username)))`;

export type PersonRef = { id: string; username: string | null };

export type PostSlide = {
  id: string;
  position: number;
  kind: Enums['media_kind'];
  width: number;
  height: number;
  /** Where the slide sits in its post's frame (v2 framing). */
  frame: FramePoint;
  durationS: number | null;
  status: Enums['upload_status'];
  photoUrl?: string;
  videoId: string | null;
  /** What goes in the clip's Stream URLs (a signed token); null if it can't play. */
  videoKey: string | null;
  /** A specific obstacle at the park, if the viewer can see it. */
  obstacle: { id: string; name: string; type: ObstacleType } | null;
  /** Just a general type, when no specific obstacle was picked. */
  obstacleType: ObstacleType | null;
  /** The raw IDs, for editing. */
  obstacleId: string | null;
  filmer: PersonRef | null;
  people: PersonRef[];
};

/** The page a post was made as (PR 8a). The public sees only the page, never the member. */
export type PostPage = {
  id: string;
  handle: string;
  displayName: string;
  roles: PageRole[];
  state: PageState;
  logoPath: string | null;
};

export type Post = {
  id: string;
  /** Null for a page post: who made it is only known to the page's team. */
  authorId: string | null;
  /** Null for a deleted account, an anonymized post or a page post. */
  author: { id: string; username: string | null; avatarPath: string | null } | null;
  /** Set when the post was made as a page. */
  page: PostPage | null;
  /** A shop's post that went to Near you (within its cap). */
  nearYou: boolean;
  park: { id: string; slug: string; name: string } | null;
  metro: { id: string; name: string } | null;
  /** The meetup it's from ("From Thursday's meetup?"), if linked. */
  eventId: string | null;
  caption: string | null;
  createdAt: string;
  publishedAt: string | null;
  editedAt: string | null;
  slides: PostSlide[];
  /** Live comments you can see. Like counts are never shown. */
  commentCount: number;
  likedByMe: boolean;
};

/** The shape PostgREST hands back for POST_SELECT. */
type Row = {
  id: string;
  author_id: string | null;
  page_id: string | null;
  near_you: boolean | null;
  page: { id: string; handle: string; display_name: string; roles: PageRole[]; state: PageState; logo_path: string | null } | null;
  caption: string | null;
  created_at: string;
  published_at: string | null;
  edited_at: string | null;
  park_id: string | null;
  event_id: string | null;
  slide_count: number;
  anonymized: boolean;
  comment_count: number | null;
  liked_by_me: boolean | null;
  author: { id: string; username: string | null; avatar_path: string | null; deleted_at: string | null } | null;
  park: { id: string; slug: string; display_name: string } | null;
  metro: { id: string; name: string } | null;
  post_slides: {
    id: string;
    position: number;
    kind: Enums['media_kind'];
    width: number;
    height: number;
    frame_x: number;
    frame_y: number;
    duration_s: number | null;
    upload_status: Enums['upload_status'];
    storage_path: string | null;
    stream_video_id: string | null;
    obstacle_id: string | null;
    obstacle_type: ObstacleType | null;
    filmer_id: string | null;
    obstacle: { id: string; name: string; general_type: ObstacleType } | null;
    filmer: { id: string; username: string | null } | null;
    slide_people_tags: { user_id: string; person: { id: string; username: string | null } | null }[];
  }[];
};

async function toPosts(rows: Row[]): Promise<Post[]> {
  const paths = rows.flatMap((r) =>
    r.post_slides
      .filter((s) => s.kind === 'photo' && s.upload_status === 'ready' && s.storage_path)
      .map((s) => s.storage_path!),
  );
  const [urls, clips] = await Promise.all([
    photoUrls(paths),
    videoKeys(
      rows.flatMap((r) =>
        r.post_slides.filter((s) => s.kind === 'video' && s.upload_status === 'ready').map((s) => s.stream_video_id),
      ),
    ),
  ]);
  return rows.map((r) => ({
    id: r.id,
    authorId: r.author_id,
    author:
      r.anonymized || !r.author || r.author.deleted_at
        ? null
        : { id: r.author.id, username: r.author.username, avatarPath: r.author.avatar_path },
    page: r.page
      ? {
          id: r.page.id,
          handle: r.page.handle,
          displayName: r.page.display_name,
          roles: r.page.roles,
          state: r.page.state,
          logoPath: r.page.logo_path,
        }
      : null,
    nearYou: Boolean(r.near_you),
    park: r.park ? { id: r.park.id, slug: r.park.slug, name: r.park.display_name } : null,
    metro: r.metro,
    eventId: r.event_id ?? null,
    caption: r.caption,
    createdAt: r.created_at,
    publishedAt: r.published_at,
    editedAt: r.edited_at,
    commentCount: r.comment_count ?? 0,
    likedByMe: Boolean(r.liked_by_me),
    slides: [...r.post_slides]
      .sort((a, b) => a.position - b.position)
      .map((s) => ({
        id: s.id,
        position: s.position,
        kind: s.kind,
        width: s.width,
        height: s.height,
        frame: { x: s.frame_x, y: s.frame_y },
        durationS: s.duration_s,
        status: s.upload_status,
        photoUrl: s.storage_path ? urls[s.storage_path] : undefined,
        videoId: s.stream_video_id,
        videoKey: s.stream_video_id ? (clips[s.stream_video_id] ?? null) : null,
        obstacle: s.obstacle ? { id: s.obstacle.id, name: s.obstacle.name, type: s.obstacle.general_type } : null,
        obstacleType: s.obstacle_type,
        obstacleId: s.obstacle_id,
        filmer: s.filmer,
        people: s.slide_people_tags.map((t) => t.person ?? { id: t.user_id, username: null }),
      })),
  }));
}

/** A post as a masonry grid tile: its first slide at its stored size. */
export function toGridPost(post: Post): GridPost {
  const s = post.slides[0];
  return {
    id: post.id,
    publishedAt: post.publishedAt ?? post.createdAt,
    slideCount: post.slides.length,
    cover: s
      ? {
          kind: s.kind,
          width: s.width,
          height: s.height,
          durationS: s.durationS,
          photoUrl: s.photoUrl,
          videoId: s.videoId,
          videoKey: s.videoKey,
        }
      : null,
  };
}

/* Paging ------------------------------------------------------------------------ */

export type Cursor = { at: string; id: string } | null;

const FEED_PAGE = 20;
const GRID_PAGE = 30;

function nextCursor(page: Post[], size: number): Cursor | undefined {
  if (page.length < size) return undefined;
  const last = page[page.length - 1];
  return { at: last.publishedAt!, id: last.id };
}

/** Feed functions return posts rows, so the same select embeds slides and people. */
type FeedFn = 'feed_following' | 'feed_nearby' | 'obstacle_posts' | 'tagged_posts' | 'filmed_posts';

async function fromFunction(fn: FeedFn, args: Record<string, unknown>, cursor: Cursor, size: number) {
  const { data, error } = await supabase
    .rpc(fn as never, {
      ...args,
      before_at: cursor?.at ?? null,
      before_id: cursor?.id ?? null,
      max_results: size,
    } as never)
    .select(POST_SELECT);
  if (error) throw error;
  return toPosts((data ?? []) as unknown as Row[]);
}

function usePostPages(
  key: readonly unknown[],
  fetchPage: (cursor: Cursor) => Promise<Post[]>,
  size: number,
  enabled = true,
) {
  return useInfiniteQuery<Post[], Error, InfiniteData<Post[]>, readonly unknown[], Cursor>({
    queryKey: key,
    queryFn: ({ pageParam }) => fetchPage(pageParam),
    initialPageParam: null,
    getNextPageParam: (last) => nextCursor(last, size),
    enabled,
    staleTime: fresh.posts,
  });
}

/* Feeds ------------------------------------------------------------------------- */

/** People you follow, newest first. */
export function useFollowingFeed(userId: string | undefined) {
  return usePostPages(
    keys.feedFollowing(userId ?? ''),
    (cursor) => fromFunction('feed_following', {}, cursor, FEED_PAGE),
    FEED_PAGE,
    Boolean(userId),
  );
}

/**
 * Near you: your home metro area's posts by people you don't follow. Starts
 * once the following feed has run out (`enabled`).
 */
export function useNearbyFeed(userId: string | undefined, metroId: string | null | undefined, enabled: boolean) {
  return usePostPages(
    keys.feedNearby(userId ?? '', metroId ?? ''),
    (cursor) => fromFunction('feed_nearby', { metro: metroId ?? null }, cursor, FEED_PAGE),
    FEED_PAGE,
    Boolean(userId) && Boolean(metroId) && enabled,
  );
}

/** A park's posts, newest first. */
export function useParkPosts(parkId: string | undefined) {
  return usePostPages(
    keys.parkPosts(parkId ?? ''),
    async (cursor) => {
      let q = supabase
        .from('posts')
        .select(POST_SELECT)
        .eq('park_id', parkId!)
        .eq('status', 'visible')
        .not('published_at', 'is', null)
        .order('published_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(GRID_PAGE);
      if (cursor) q = q.or(`published_at.lt."${cursor.at}",and(published_at.eq."${cursor.at}",id.lt.${cursor.id})`);
      const { data, error } = await q;
      if (error) throw error;
      return toPosts((data ?? []) as unknown as Row[]);
    },
    GRID_PAGE,
    Boolean(parkId),
  );
}

/** A page's own posts (its Posts tab), newest first. */
export function usePagePosts(pageId: string | undefined, enabled = true) {
  return usePostPages(
    keys.pagePosts(pageId ?? ''),
    async (cursor) => {
      let q = supabase
        .from('posts')
        .select(POST_SELECT)
        .eq('page_id', pageId!)
        .eq('status', 'visible')
        .not('published_at', 'is', null)
        .order('published_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(GRID_PAGE);
      if (cursor) q = q.or(`published_at.lt."${cursor.at}",and(published_at.eq."${cursor.at}",id.lt.${cursor.id})`);
      const { data, error } = await q;
      if (error) throw error;
      return toPosts((data ?? []) as unknown as Row[]);
    },
    GRID_PAGE,
    Boolean(pageId) && enabled,
  );
}

/** "by [member]" for a page's post tiles: the team only, by post ID. */
export function usePagePostBylines(pageId: string | undefined, postIds: string[], onTeam: boolean) {
  return useQuery({
    queryKey: [...keys.pagePosts(pageId ?? ''), 'bylines', postIds.join(',')],
    queryFn: async (): Promise<Record<string, string | null>> => {
      const { data, error } = await supabase.rpc('page_post_bylines', { page: pageId!, posts: postIds });
      if (error) throw error;
      return Object.fromEntries((data ?? []).map((r) => [r.post_id, r.username]));
    },
    enabled: Boolean(pageId) && onTeam && postIds.length > 0,
    staleTime: fresh.posts,
  });
}

/** Whether you made this post (its author, or the member who posted it as a page). */
export async function fetchMadePost(postId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('i_made_post', { post: postId });
  if (error) throw error;
  return data === true;
}

/** Posts linked to a meetup date ("From this session"), newest first. */
export function useMeetupPosts(eventId: string | undefined, enabled = true) {
  return usePostPages(
    keys.meetupPosts(eventId ?? ''),
    async (cursor) => {
      let q = supabase
        .from('posts')
        .select(POST_SELECT)
        .eq('event_id', eventId!)
        .eq('status', 'visible')
        .not('published_at', 'is', null)
        .order('published_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(GRID_PAGE);
      if (cursor) q = q.or(`published_at.lt."${cursor.at}",and(published_at.eq."${cursor.at}",id.lt.${cursor.id})`);
      const { data, error } = await q;
      if (error) throw error;
      return toPosts((data ?? []) as unknown as Row[]);
    },
    GRID_PAGE,
    Boolean(eventId) && enabled,
  );
}

/** An obstacle's feed (any slide tagged to it). */
export function useObstaclePosts(obstacleId: string | undefined) {
  return usePostPages(
    keys.obstaclePosts(obstacleId ?? ''),
    (cursor) => fromFunction('obstacle_posts', { obstacle: obstacleId }, cursor, GRID_PAGE),
    GRID_PAGE,
    Boolean(obstacleId),
  );
}

/** Posts a member is tagged in (profile › Tagged). */
export function useTaggedPosts(userId: string | undefined, enabled = true) {
  return usePostPages(
    keys.taggedPosts(userId ?? ''),
    (cursor) => fromFunction('tagged_posts', { person: userId }, cursor, GRID_PAGE),
    GRID_PAGE,
    Boolean(userId) && enabled,
  );
}

/** Posts a member filmed (profile › Filmed). */
export function useFilmedPosts(userId: string | undefined, enabled = true) {
  return usePostPages(
    keys.filmedPosts(userId ?? ''),
    (cursor) => fromFunction('filmed_posts', { person: userId }, cursor, GRID_PAGE),
    GRID_PAGE,
    Boolean(userId) && enabled,
  );
}

/* One post ------------------------------------------------------------------------ */

export async function fetchPost(id: string): Promise<Post | null> {
  const { data, error } = await supabase.from('posts').select(POST_SELECT).eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const [post] = await toPosts([data as unknown as Row]);
  return post;
}

export function usePost(id: string | undefined) {
  return useQuery({
    queryKey: keys.post(id ?? ''),
    queryFn: () => fetchPost(id!),
    enabled: Boolean(id),
    staleTime: fresh.posts,
    // While anything is still uploading, check back every few seconds.
    refetchInterval: (query) =>
      query.state.data?.slides.some((s) => s.status !== 'ready' && s.status !== 'failed') ? 5000 : false,
  });
}

/* Regulars ---------------------------------------------------------------------------- */

export type Regular = {
  id: string;
  username: string;
  avatar_path: string | null;
  disciplines: Enums['discipline'][];
  last_active_at: string | null;
};

/** A park's regulars, most recently active first. */
export function useParkRegulars(parkId: string | undefined) {
  return useQuery({
    queryKey: keys.parkRegulars(parkId ?? ''),
    queryFn: async (): Promise<Regular[]> => {
      const { data, error } = await supabase.rpc('park_regulars_list', { park: parkId!, max_results: 30 });
      if (error) throw error;
      return data ?? [];
    },
    enabled: Boolean(parkId),
    staleTime: fresh.parks,
  });
}

/* Parks you've posted at ---------------------------------------------------------------- */

export type RecentPark = { id: string; name: string; type: Enums['park_type']; city: string };

/** Up to five parks you've posted at, most recent first (the park picker's Recent). */
export function useRecentParks(userId: string | undefined) {
  return useQuery({
    queryKey: keys.recentParks(userId ?? ''),
    queryFn: async (): Promise<RecentPark[]> => {
      const { data, error } = await supabase
        .from('posts')
        .select('park:parks!posts_park_id_fkey(id, display_name, park_type, city)')
        .eq('author_id', userId!)
        .not('park_id', 'is', null)
        .neq('status', 'deleted')
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      const out: RecentPark[] = [];
      for (const row of data ?? []) {
        const p = row.park as { id: string; display_name: string; park_type: Enums['park_type']; city: string } | null;
        if (p && !out.some((r) => r.id === p.id)) out.push({ id: p.id, name: p.display_name, type: p.park_type, city: p.city });
        if (out.length === 5) break;
      }
      return out;
    },
    enabled: Boolean(userId),
    staleTime: fresh.mine,
  });
}

/* Obstacles for tagging ---------------------------------------------------------------- */

export type TagObstacle = { id: string; name: string; type: ObstacleType; pending: boolean };

/**
 * A park's taggable obstacles: active ones plus pending ones you suggested,
 * never street plaza placeholders, merged or archived ones.
 */
export function useTaggableObstacles(parkId: string | null | undefined, userId: string | undefined) {
  return useQuery({
    queryKey: keys.taggableObstacles(parkId ?? '', userId ?? ''),
    queryFn: async (): Promise<TagObstacle[]> => {
      const { data, error } = await supabase
        .from('obstacles')
        .select('id, name, general_type, status, suggested_by, merged_into, created_at')
        .eq('park_id', parkId!)
        .neq('general_type', 'street_plaza')
        .is('merged_into', null)
        .order('created_at');
      if (error) throw error;
      return (data ?? [])
        .filter((o) => o.status === 'active' || (o.status === 'pending' && o.suggested_by === userId))
        .map((o) => ({ id: o.id, name: o.name, type: o.general_type, pending: o.status === 'pending' }));
    },
    enabled: Boolean(parkId) && Boolean(userId),
    staleTime: fresh.mine,
  });
}

/** Suggests a new obstacle at a park; it waits for a contributor to approve it. */
export function useSuggestObstacle(userId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { parkId: string; name: string; type: ObstacleType }): Promise<TagObstacle> => {
      const { data, error } = await supabase
        .from('obstacles')
        .insert({
          park_id: input.parkId,
          name: input.name.trim(),
          general_type: input.type,
          status: 'pending',
          suggested_by: userId!,
        })
        .select('id, name, general_type')
        .single();
      if (error) throw error;
      return { id: data.id, name: data.name, type: data.general_type, pending: true };
    },
    onSuccess: (_, input) => {
      void qc.invalidateQueries({ queryKey: keys.taggableObstacles(input.parkId, userId ?? '') });
    },
  });
}

/* Tags ------------------------------------------------------------------------------------ */

/** What can be tagged on one slide. */
export type SlideTags = {
  obstacleId: string | null;
  /** Only used when no specific obstacle is picked. */
  obstacleType: ObstacleType | null;
  filmerId: string | null;
  /** People in the slide (not counting the filmer). */
  peopleIds: string[];
};

export const NO_TAGS: SlideTags = { obstacleId: null, obstacleType: null, filmerId: null, peopleIds: [] };

export function hasTags(t: SlideTags): boolean {
  return Boolean(t.obstacleId || t.obstacleType || t.filmerId || t.peopleIds.length);
}

/** Sets one slide's tags (all of them at once). The database checks them. */
export async function setSlideTags(slideId: string, tags: SlideTags): Promise<void> {
  // The generated types don't allow null here, but the function takes it
  // (null clears the obstacle, type or filmer).
  const { error } = await supabase.rpc('set_slide_tags', {
    slide: slideId,
    obstacle: tags.obstacleId as string,
    obstacle_kind: (tags.obstacleId ? null : tags.obstacleType) as ObstacleType,
    filmer: tags.filmerId as string,
    people: tags.peopleIds,
  });
  if (error) throw error;
}

export function tagsOf(slide: PostSlide): SlideTags {
  return {
    obstacleId: slide.obstacleId,
    obstacleType: slide.obstacleId ? null : slide.obstacleType,
    filmerId: slide.filmer?.id ?? null,
    peopleIds: slide.people.map((p) => p.id),
  };
}

/** Where a slide sits in its frame. The author's own slides only. */
export async function setSlideFrame(slideId: string, frame: FramePoint): Promise<void> {
  const { error } = await supabase
    .from('post_slides')
    .update({ frame_x: frame.x, frame_y: frame.y })
    .eq('id', slideId);
  if (error) throw error;
}

export function sameFrame(a: FramePoint, b: FramePoint): boolean {
  return Math.abs(a.x - b.x) < 0.001 && Math.abs(a.y - b.y) < 0.001;
}

function sameTags(a: SlideTags, b: SlideTags): boolean {
  return (
    a.obstacleId === b.obstacleId &&
    (a.obstacleId ? true : a.obstacleType === b.obstacleType) &&
    a.filmerId === b.filmerId &&
    [...a.peopleIds].sort().join() === [...b.peopleIds].sort().join()
  );
}

/** Every cached list a post can appear in. */
function invalidatePostLists(qc: ReturnType<typeof useQueryClient>, postId: string) {
  void qc.invalidateQueries({ queryKey: keys.post(postId) });
  void qc.invalidateQueries({ queryKey: ['posts'] });
  void qc.invalidateQueries({ queryKey: ['feed'] });
  // Meetup cards count their linked posts.
  void qc.invalidateQueries({ queryKey: ['meetups'] });
}

/**
 * Saves edits to a published post: caption, park and each slide's tags.
 * Changing the park clears obstacle tags from the old park (the database
 * does that too), so slide tags are saved after the park.
 */
export function useEditPost(post: Post | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      caption: string;
      parkId: string | null;
      /** The meetup it's from; changing the park drops it. */
      eventId?: string | null;
      slides: Record<string, SlideTags>;
      /** Slides the author reframed, by slide ID. */
      frames?: Record<string, FramePoint>;
    }) => {
      if (!post) return;
      const caption = input.caption.trim() || null;
      const parkMoved = input.parkId !== (post.park?.id ?? null);
      if (caption !== post.caption || parkMoved) {
        const { error } = await supabase
          .from('posts')
          .update({ caption, park_id: input.parkId })
          .eq('id', post.id);
        if (error) throw error;
      }
      // After the park: a new park drops the link in the database too.
      const eventId = input.eventId === undefined ? post.eventId : input.eventId;
      if (eventId !== (parkMoved ? null : post.eventId)) {
        const { error } = await supabase.from('posts').update({ event_id: eventId }).eq('id', post.id);
        if (error) throw error;
      }
      for (const slide of post.slides) {
        const next = input.slides[slide.id];
        if (!next) continue;
        const parkChanged = input.parkId !== (post.park?.id ?? null);
        if (!parkChanged && sameTags(next, tagsOf(slide))) continue;
        await setSlideTags(slide.id, next);
      }
      for (const slide of post.slides) {
        const frame = input.frames?.[slide.id];
        if (!frame || sameFrame(frame, slide.frame)) continue;
        await setSlideFrame(slide.id, frame);
      }
    },
    onSuccess: () => {
      if (post) invalidatePostLists(qc, post.id);
    },
  });
}

/** Deletes your own post (it's marked deleted, not removed). */
export function useDeletePost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (postId: string) => {
      const { error } = await supabase.from('posts').update({ status: 'deleted' }).eq('id', postId);
      if (error) throw error;
      return postId;
    },
    onSuccess: (postId) => invalidatePostLists(qc, postId),
  });
}

/** Takes you off a post: your people tags, and your filmer credit. */
export function useRemoveMeFromPost(userId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (post: Post) => {
      const slideIds = post.slides.map((s) => s.id);
      const { error } = await supabase
        .from('slide_people_tags')
        .delete()
        .eq('user_id', userId!)
        .in('slide_id', slideIds);
      if (error) throw error;
      for (const s of post.slides) {
        if (s.filmer?.id !== userId) continue;
        const { error: filmerError } = await supabase.rpc('remove_my_filmer_credit', { slide: s.id });
        if (filmerError) throw filmerError;
      }
      return post.id;
    },
    onSuccess: (postId) => invalidatePostLists(qc, postId),
  });
}

/* Credits line --------------------------------------------------------------------------- */

/** Filmers and people across a post (or one slide), without repeats. */
export function credits(slides: PostSlide[]): { filmers: PersonRef[]; people: PersonRef[] } {
  const filmers = new Map<string, PersonRef>();
  const people = new Map<string, PersonRef>();
  for (const s of slides) {
    if (s.filmer) filmers.set(s.filmer.id, s.filmer);
    for (const p of s.people) people.set(p.id, p);
  }
  for (const id of filmers.keys()) people.delete(id);
  return { filmers: [...filmers.values()], people: [...people.values()] };
}

/** Whether you're tagged in a post or credited as its filmer. */
export function isOnPost(post: Post, userId: string | undefined): boolean {
  if (!userId) return false;
  return post.slides.some((s) => s.filmer?.id === userId || s.people.some((p) => p.id === userId));
}
