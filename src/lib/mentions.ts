/**
 * Who to suggest when someone types @ in a comment (Comment box mockup,
 * Built from the brief, Nov 2). The list is ordered:
 *
 * 1. People on the post: the poster, filmers, people tagged on a slide, and
 *    people who've commented.
 * 2. People you follow.
 * 3. Regulars at the post's park.
 * 4. Anyone else whose username starts with what you typed (search).
 *
 * Each person appears once, in the first group that has them, with a reason
 * line. Blocked people never appear: the server leaves out anyone blocked
 * either way from comments, regulars and search; blocks end follows; and
 * people you blocked are filtered here as well, in case they're still
 * tagged on an older post.
 */
import { useQuery } from '@tanstack/react-query';

import type { Thread } from './engagement';
import { searchPeople } from './people';
import type { Post } from './posts';
import { fresh, keys } from './query';
import { supabase } from './supabase';

export type MentionReason = 'posted' | 'filmed' | 'tagged' | 'commented' | 'following' | 'regular' | 'other';

export type MentionCandidate = {
  id: string;
  username: string;
  avatarPath: string | null;
  reason: MentionReason;
};

/** Most suggestions shown at once, so the list stays above the keyboard. */
export const MAX_SUGGESTIONS = 5;

/**
 * The @mention being typed right before the cursor, if any: "ask @ka" with
 * the cursor after "ka" gives { query: 'ka', start: 4 }.
 */
export function activeMention(text: string, cursor: number): { query: string; start: number } | null {
  const before = text.slice(0, cursor);
  const match = /(^|\s)@([A-Za-z0-9._]{0,30})$/.exec(before);
  if (!match) return null;
  return { query: match[2], start: before.length - match[2].length - 1 };
}

/** Replaces the @mention being typed with the picked username and a space. */
export function insertMention(text: string, cursor: number, start: number, username: string) {
  const next = `${text.slice(0, start)}@${username} ${text.slice(cursor).replace(/^\S*/, '').trimStart()}`;
  return { text: next, cursor: start + username.length + 2 };
}

type Person = { id: string; username: string; avatarPath: string | null };

/** The people you follow (accepted follows only). */
export function useFollowing(userId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: keys.following(userId ?? ''),
    queryFn: async (): Promise<Person[]> => {
      const { data, error } = await supabase
        .from('follows')
        .select('followee:profiles!follows_followee_id_fkey(id, username, avatar_path, deleted_at)')
        .eq('follower_id', userId!)
        .eq('status', 'accepted');
      if (error) throw error;
      return (data ?? []).flatMap((row) => {
        const p = row.followee as { id: string; username: string | null; avatar_path: string | null; deleted_at: string | null } | null;
        return p && p.username && !p.deleted_at ? [{ id: p.id, username: p.username, avatarPath: p.avatar_path }] : [];
      });
    },
    enabled: Boolean(userId) && enabled,
    staleTime: fresh.social,
  });
}

/** Search matches, once two letters are typed (the search function's minimum). */
export function useMentionSearch(q: string, enabled: boolean) {
  return useQuery({
    queryKey: keys.search(`@${q.toLowerCase()}`),
    queryFn: () => searchPeople(q),
    enabled: enabled && q.length >= 2,
    staleTime: fresh.search,
  });
}

export function buildCandidates({
  query,
  me,
  post,
  threads,
  following,
  regulars,
  others,
  blockedIds,
}: {
  query: string;
  me: string | undefined;
  post: Post | null | undefined;
  threads: Thread[];
  following: Person[];
  regulars: Person[];
  others: Person[];
  blockedIds: Set<string>;
}): MentionCandidate[] {
  const q = query.toLowerCase();
  const seen = new Set<string>();
  const out: MentionCandidate[] = [];
  const add = (p: { id: string; username: string | null; avatarPath?: string | null }, reason: MentionReason) => {
    if (!p.username || seen.has(p.id) || p.id === me || blockedIds.has(p.id)) return;
    seen.add(p.id);
    if (!p.username.toLowerCase().startsWith(q)) return;
    out.push({ id: p.id, username: p.username, avatarPath: p.avatarPath ?? null, reason });
  };

  if (post) {
    if (post.author) add(post.author, 'posted');
    for (const s of post.slides) if (s.filmer) add(s.filmer, 'filmed');
    for (const s of post.slides) for (const p of s.people) add(p, 'tagged');
  }
  for (const thread of threads) {
    for (const c of [thread.comment, ...thread.replies]) {
      if (!c.deleted && c.authorId) add({ id: c.authorId, username: c.username, avatarPath: c.avatarPath }, 'commented');
    }
  }
  for (const p of following) add(p, 'following');
  for (const p of regulars) add(p, 'regular');
  for (const p of others) add(p, 'other');
  return out.slice(0, MAX_SUGGESTIONS);
}
