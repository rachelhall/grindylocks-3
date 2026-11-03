/**
 * Likes, comments and notifications (M4b, Nov 1).
 *
 * - Likes are hidden: you see whether you liked a post, never a count or who
 *   else did. Liking flips at once and rolls back if it fails.
 * - Comments are one level deep, oldest first. A reply to a reply stays in
 *   the same thread with an @mention of the person you're answering. You
 *   can delete your own comments (and any on your own post); nobody can
 *   edit one. Deleting erases the text; deleted comments with replies show
 *   as "Comment deleted".
 * - Notifications are written by the database (comments, replies, mentions,
 *   tags, filmer credit, invites, "someone new", and from M5 park fixes going
 *   live, moderation notices and vacated roles); the app reads them, and
 *   opening Notifications clears the bell's dot.
 */
import { type InfiniteData, type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { photoUrls, videoKeys, videoThumbnailUrl } from './media';
import type { Post } from './posts';
import { fresh, keys } from './query';
import { supabase } from './supabase';

/* Keeping counts in step everywhere a post is cached --------------------------------- */

/**
 * Applies a change to one post in every cached copy: post detail, the feeds,
 * and the post lists (park, obstacle, tagged, filmed), so a like or a new
 * comment shows on Home and in detail at once.
 */
function patchPost(qc: QueryClient, postId: string, change: (post: Post) => Post) {
  qc.setQueryData<Post | null>(keys.post(postId), (old) => (old ? change(old) : old));
  for (const root of [['feed'], ['posts']]) {
    qc.setQueriesData<InfiniteData<Post[]>>({ queryKey: root }, (old) =>
      old?.pages
        ? { ...old, pages: old.pages.map((page) => page.map((p) => (p.id === postId ? change(p) : p))) }
        : old,
    );
  }
}

/* Likes ------------------------------------------------------------------------------- */

export function useToggleLike(userId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ postId, like }: { postId: string; like: boolean }) => {
      if (like) {
        const { error } = await supabase.from('likes').insert({ post_id: postId, user_id: userId! });
        // Already liked (a double tap) is fine.
        if (error && error.code !== '23505') throw error;
      } else {
        const { error } = await supabase.from('likes').delete().eq('post_id', postId).eq('user_id', userId!);
        if (error) throw error;
      }
    },
    onMutate: ({ postId, like }) => patchPost(qc, postId, (p) => ({ ...p, likedByMe: like })),
    onError: (_err, { postId, like }) => patchPost(qc, postId, (p) => ({ ...p, likedByMe: !like })),
  });
}

/* Comments ------------------------------------------------------------------------------- */

export type Comment = {
  id: string;
  parentId: string | null;
  /** Null when the comment was deleted. */
  authorId: string | null;
  /** Null for a deleted comment or a deleted account. */
  username: string | null;
  avatarPath: string | null;
  body: string | null;
  replyToUsername: string | null;
  isPoster: boolean;
  deleted: boolean;
  createdAt: string;
};

/** A top-level comment and its replies, oldest first. */
export type Thread = { comment: Comment; replies: Comment[] };

export const MAX_COMMENT = 1000;

async function fetchComments(postId: string): Promise<Thread[]> {
  const { data, error } = await supabase.rpc('post_comments', { post: postId });
  if (error) throw error;
  const rows: Comment[] = (data ?? []).map((r) => ({
    id: r.id,
    parentId: r.parent_id,
    authorId: r.author_id,
    username: r.username,
    avatarPath: r.avatar_path,
    body: r.body,
    replyToUsername: r.reply_to_username,
    isPoster: r.is_poster,
    deleted: r.deleted,
    createdAt: r.created_at,
  }));
  const threads = new Map<string, Thread>();
  for (const c of rows) if (!c.parentId) threads.set(c.id, { comment: c, replies: [] });
  // Replies whose thread isn't shown (its first comment is by someone
  // you've blocked) are left out with it.
  for (const c of rows) if (c.parentId) threads.get(c.parentId)?.replies.push(c);
  return [...threads.values()];
}

export function useComments(postId: string | undefined) {
  return useQuery({
    queryKey: keys.comments(postId ?? ''),
    queryFn: () => fetchComments(postId!),
    enabled: Boolean(postId),
    staleTime: fresh.social,
  });
}

/** Who you're answering: the thread, and the person to @mention. */
export type ReplyTarget = { threadId: string; username: string | null; userId: string | null };

export function useAddComment(postId: string | undefined, userId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ body, replyTo }: { body: string; replyTo: ReplyTarget | null }) => {
      const { error } = await supabase.from('comments').insert({
        post_id: postId!,
        author_id: userId!,
        body: body.trim(),
        parent_id: replyTo?.threadId ?? null,
        reply_to_user_id: replyTo?.userId ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      if (!postId) return;
      patchPost(qc, postId, (p) => ({ ...p, commentCount: p.commentCount + 1 }));
      void qc.invalidateQueries({ queryKey: keys.comments(postId) });
    },
  });
}

export function useDeleteComment(postId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (commentId: string) => {
      const { error } = await supabase
        .from('comments')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', commentId);
      if (error) throw error;
    },
    onSuccess: () => {
      if (!postId) return;
      patchPost(qc, postId, (p) => ({ ...p, commentCount: Math.max(0, p.commentCount - 1) }));
      void qc.invalidateQueries({ queryKey: keys.comments(postId) });
    },
  });
}

/* Notifications ------------------------------------------------------------------------- */

export type NotificationKind =
  | 'comment'
  | 'reply'
  | 'mention'
  // v2: @mentioned in a post's caption.
  | 'caption_mention'
  | 'tag'
  | 'filmer_credit'
  | 'invite_used'
  | 'someone_new'
  | 'visiting'
  // M5: roles and safety.
  | 'park_fix_live'
  | 'post_removed'
  | 'comment_removed'
  | 'warning'
  | 'suspension'
  | 'role_vacated';

export type NotificationPerson = { id: string; username: string | null; avatarPath: string | null };

export type AppNotification = {
  id: string;
  kind: NotificationKind;
  createdAt: string;
  /** Newest first; for comments on your post, up to two people. */
  people: NotificationPerson[];
  /** How many different people (comments on your post). */
  peopleCount: number;
  postId: string | null;
  commentId: string | null;
  /**
   * The start of the comment, for comments, replies and mentions (the
   * caption, for caption mentions). For
   * moderation notices, the admin's message (may be null); for role_vacated,
   * the role that ended (park_admin, park_contributor or city_admin).
   */
  excerpt: string | null;
  /** "Someone new" visiting: the park they'll be at. */
  park: { slug: string; name: string } | null;
  metroName: string | null;
  unread: boolean;
};

const KINDS = new Set<NotificationKind>([
  'comment',
  'reply',
  'mention',
  'caption_mention',
  'tag',
  'filmer_credit',
  'invite_used',
  'someone_new',
  'visiting',
  'park_fix_live',
  'post_removed',
  'comment_removed',
  'warning',
  'suspension',
  'role_vacated',
]);

export function useNotifications(userId: string | undefined) {
  return useQuery({
    queryKey: keys.notifications(userId ?? ''),
    queryFn: async (): Promise<AppNotification[]> => {
      const { data, error } = await supabase.rpc('my_notifications');
      if (error) throw error;
      return (data ?? [])
        .filter((n) => KINDS.has(n.kind as NotificationKind))
        .map((n) => ({
          id: n.id,
          kind: n.kind as NotificationKind,
          createdAt: n.created_at,
          people: ((n.actors as { id: string; username: string | null; avatar_path: string | null }[] | null) ?? []).map(
            (a) => ({ id: a.id, username: a.username, avatarPath: a.avatar_path }),
          ),
          peopleCount: n.actor_count,
          postId: n.post_id,
          commentId: n.comment_id,
          excerpt: n.comment_body,
          park: n.park_slug && n.park_name ? { slug: n.park_slug, name: n.park_name } : null,
          metroName: n.metro_name,
          unread: n.unread,
        }));
    },
    enabled: Boolean(userId),
    staleTime: fresh.mine,
  });
}

/** A post's first slide, as a small square thumbnail on a notification row. */
export type PostCover = { kind: 'photo' | 'video'; uri: string | null };

/**
 * First-slide thumbnails for the posts in a list of notifications. The
 * posts read rules apply, so a post you can no longer see has no cover.
 * Photo URLs are signed for an hour, so these follow `fresh.posts`.
 */
export function usePostCovers(postIds: string[]) {
  const ids = [...new Set(postIds)].sort();
  return useQuery({
    queryKey: keys.postCovers(ids),
    queryFn: async (): Promise<Record<string, PostCover>> => {
      const { data, error } = await supabase
        .from('post_slides')
        .select('post_id, position, kind, upload_status, storage_path, stream_video_id')
        .in('post_id', ids)
        .order('position');
      if (error) throw error;
      const first = new Map<string, (typeof data)[number]>();
      for (const s of data ?? []) if (!first.has(s.post_id)) first.set(s.post_id, s);
      const paths = [...first.values()]
        .filter((s) => s.kind === 'photo' && s.upload_status === 'ready' && s.storage_path)
        .map((s) => s.storage_path!);
      const [urls, clips] = await Promise.all([
        photoUrls(paths),
        videoKeys(
          [...first.values()]
            .filter((s) => s.kind === 'video' && s.upload_status === 'ready')
            .map((s) => s.stream_video_id),
        ),
      ]);
      const out: Record<string, PostCover> = {};
      for (const [postId, s] of first) {
        out[postId] =
          s.kind === 'photo'
            ? { kind: 'photo', uri: s.storage_path ? (urls[s.storage_path] ?? null) : null }
            : {
                kind: 'video',
                uri: s.stream_video_id && clips[s.stream_video_id] ? videoThumbnailUrl(clips[s.stream_video_id], 120) : null,
              };
      }
      return out;
    },
    enabled: ids.length > 0,
    staleTime: fresh.posts,
  });
}

/** Whether the bell gets its pink dot. */
export function useNotificationsUnread(userId: string | undefined) {
  return useQuery({
    queryKey: keys.notificationsUnread(userId ?? ''),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('notifications_unread');
      if (error) throw error;
      return Boolean(data);
    },
    enabled: Boolean(userId),
    staleTime: fresh.social,
  });
}

/** Opening Notifications clears the dot. The list keeps its "new" marks until it's refetched. */
export function useMarkNotificationsSeen(userId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('mark_notifications_seen');
      if (error) throw error;
    },
    onSuccess: () => {
      if (userId) qc.setQueryData(keys.notificationsUnread(userId), false);
    },
  });
}
