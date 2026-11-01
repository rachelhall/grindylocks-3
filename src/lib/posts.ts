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
 * - Likes and comments are M4b.
 */
import { type InfiniteData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { Database } from './database.types';
import { photoUrls } from './media';
import type { ObstacleType } from './parks';
import type { GridPost } from './profiles';
import { fresh, keys } from './query';
import { supabase } from './supabase';

type Enums = Database['public']['Enums'];

/** Everything a post card or post detail shows, in one select. */
export const POST_SELECT = `id, author_id, caption, created_at, published_at, edited_at, park_id, slide_count, anonymized,
  author:profiles!posts_author_id_fkey(id, username, avatar_path, deleted_at),
  park:parks!posts_park_id_fkey(id, slug, display_name),
  metro:metro_areas!posts_metro_area_id_fkey(id, name),
  post_slides(id, position, kind, width, height, duration_s, upload_status, storage_path, stream_video_id,
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
  durationS: number | null;
  status: Enums['upload_status'];
  photoUrl?: string;
  videoId: string | null;
  /** A specific obstacle at the park, if the viewer can see it. */
  obstacle: { id: string; name: string; type: ObstacleType } | null;
  /** Just a general type, when no specific obstacle was picked. */
  obstacleType: ObstacleType | null;
  /** The raw IDs, for editing. */
  obstacleId: string | null;
  filmer: PersonRef | null;
  people: PersonRef[];
};

export type Post = {
  id: string;
  authorId: string;
  /** Null for a deleted account or an anonymized post. */
  author: { id: string; username: string | null; avatarPath: string | null } | null;
  park: { id: string; slug: string; name: string } | null;
  metro: { id: string; name: string } | null;
  caption: string | null;
  createdAt: string;
  publishedAt: string | null;
  editedAt: string | null;
  slides: PostSlide[];
};

/** The shape PostgREST hands back for POST_SELECT. */
type Row = {
  id: string;
  author_id: string;
  caption: string | null;
  created_at: string;
  published_at: string | null;
  edited_at: string | null;
  park_id: string | null;
  slide_count: number;
  anonymized: boolean;
  author: { id: string; username: string | null; avatar_path: string | null; deleted_at: string | null } | null;
  park: { id: string; slug: string; display_name: string } | null;
  metro: { id: string; name: string } | null;
  post_slides: {
    id: string;
    position: number;
    kind: Enums['media_kind'];
    width: number;
    height: number;
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
  const urls = await photoUrls(paths);
  return rows.map((r) => ({
    id: r.id,
    authorId: r.author_id,
    author:
      r.anonymized || !r.author || r.author.deleted_at
        ? null
        : { id: r.author.id, username: r.author.username, avatarPath: r.author.avatar_path },
    park: r.park ? { id: r.park.id, slug: r.park.slug, name: r.park.display_name } : null,
    metro: r.metro,
    caption: r.caption,
    createdAt: r.created_at,
    publishedAt: r.published_at,
    editedAt: r.edited_at,
    slides: [...r.post_slides]
      .sort((a, b) => a.position - b.position)
      .map((s) => ({
        id: s.id,
        position: s.position,
        kind: s.kind,
        width: s.width,
        height: s.height,
        durationS: s.duration_s,
        status: s.upload_status,
        photoUrl: s.storage_path ? urls[s.storage_path] : undefined,
        videoId: s.stream_video_id,
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
      if (cursor) q = q.or(`published_at.lt.${cursor.at},and(published_at.eq.${cursor.at},id.lt.${cursor.id})`);
      const { data, error } = await q;
      if (error) throw error;
      return toPosts((data ?? []) as unknown as Row[]);
    },
    GRID_PAGE,
    Boolean(parkId),
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
      const { data, error } = await supabase.rpc('park_regulars_list' as never, {
        park: parkId,
        max_results: 30,
      } as never);
      if (error) throw error;
      return (data ?? []) as Regular[];
    },
    enabled: Boolean(parkId),
    staleTime: fresh.parks,
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
  const { error } = await supabase.rpc('set_slide_tags' as never, {
    slide: slideId,
    obstacle: tags.obstacleId,
    obstacle_kind: tags.obstacleId ? null : tags.obstacleType,
    filmer: tags.filmerId,
    people: tags.peopleIds,
  } as never);
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
}

/**
 * Saves edits to a published post: caption, park and each slide's tags.
 * Changing the park clears obstacle tags from the old park (the database
 * does that too), so slide tags are saved after the park.
 */
export function useEditPost(post: Post | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { caption: string; parkId: string | null; slides: Record<string, SlideTags> }) => {
      if (!post) return;
      const caption = input.caption.trim() || null;
      if (caption !== post.caption || input.parkId !== (post.park?.id ?? null)) {
        const { error } = await supabase
          .from('posts')
          .update({ caption, park_id: input.parkId })
          .eq('id', post.id);
        if (error) throw error;
      }
      for (const slide of post.slides) {
        const next = input.slides[slide.id];
        if (!next) continue;
        const parkChanged = input.parkId !== (post.park?.id ?? null);
        if (!parkChanged && sameTags(next, tagsOf(slide))) continue;
        await setSlideTags(slide.id, next);
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
        const { error: filmerError } = await supabase.rpc('remove_my_filmer_credit' as never, { slide: s.id } as never);
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
