/**
 * Invites, following and blocking (M3).
 *
 * The rules live in the database (migration `invites_follows_blocks`):
 * - Invites are made, cancelled and listed through server functions, which
 *   keep the member's count right. Expired, unused links go back into the
 *   count the next time it's read.
 * - Following a private account makes a request; the person accepts or
 *   declines it. Going public accepts everyone waiting.
 * - Blocking hides both people from each other and ends any follow between
 *   them. The people you blocked come from my_blocked_accounts(), because
 *   the profiles read rule hides them from you otherwise.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { Database } from './database.types';
import type { Profile } from './profiles';
import { fresh, keys } from './query';
import { supabase } from './supabase';

type Fns = Database['public']['Functions'];

/* Invite codes ----------------------------------------------------------------------- */

/** Codes are stored as 8 characters and shown as XXXX-XXXX. */
export const INVITE_CODE_LENGTH = 8;

/** Uppercase, letters and digits only: "ab cd-2345" → "ABCD2345". */
export function normalizeInviteCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function formatInviteCode(code: string): string {
  const c = normalizeInviteCode(code);
  return c.length === INVITE_CODE_LENGTH ? `${c.slice(0, 4)}-${c.slice(4)}` : c;
}

/** The app link for an invite. Opens the invite screen when the app is installed. */
export function inviteLink(code: string): string {
  return `grindylocks://invite?code=${normalizeInviteCode(code)}`;
}

/** Whose invite this is, for the "@name invited you" screen. Null when it isn't valid. */
export async function previewInvite(code: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('invite_preview', { code: normalizeInviteCode(code) });
  if (error) throw error;
  return data?.[0]?.inviter_username ?? null;
}

/**
 * After the age check has created the profile: marks the invite this
 * account was created with as used, follows the inviter and tells them.
 * Does nothing for accounts made without an invite. Returns the inviter's
 * username.
 */
export async function redeemMyInvite(): Promise<string | null> {
  const { data, error } = await supabase.rpc('redeem_my_invite');
  if (error) throw error;
  return data ?? null;
}

/* Your invites ----------------------------------------------------------------------- */

export type Invite = Fns['my_invites']['Returns'][number] & {
  state: 'active' | 'used' | 'expired' | 'cancelled';
};

/**
 * Your invites, newest first, plus how many you have left. `remaining` is
 * null when you have unlimited invites (the owner and city admins); park
 * admins and contributors get 10, everyone else 5.
 */
export function useMyInvites(userId: string | undefined) {
  return useQuery({
    queryKey: keys.myInvites(userId ?? ''),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('my_invites');
      if (error) throw error;
      const invites = (data ?? []) as Invite[];
      // The count rides along on every row; with no invites yet, ask for it.
      // Null means unlimited (the generated types don't know it can be null).
      let remaining = invites[0]?.invites_remaining as number | null | undefined;
      if (remaining === undefined) {
        const count = await supabase.rpc('my_invite_count');
        if (count.error) throw count.error;
        remaining = count.data as number | null;
      }
      return { invites, remaining };
    },
    enabled: Boolean(userId),
    staleTime: fresh.mine,
  });
}

/** Why making an invite failed. */
export type InviteError = 'noneLeft' | 'generic';

export function useCreateInvite(userId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('create_invite');
      if (error) {
        throw new Error(error.message === 'no_invites_left' ? 'noneLeft' : 'generic');
      }
      const invite = data?.[0];
      if (!invite) throw new Error('generic');
      return invite;
    },
    onSettled: () => client.invalidateQueries({ queryKey: keys.myInvites(userId ?? '') }),
  });
}

export function useCancelInvite(userId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (inviteId: string) => {
      const { error } = await supabase.rpc('cancel_invite', { invite: inviteId });
      if (error) throw error;
    },
    onSettled: () => client.invalidateQueries({ queryKey: keys.myInvites(userId ?? '') }),
  });
}

/* Following -------------------------------------------------------------------------- */

type FollowAction = 'follow' | 'unfollow';

/**
 * Follow or unfollow someone from their profile. Unfollowing also cancels a
 * request. The button flips at once and flips back if the write fails; the
 * server decides whether a follow is a request (private accounts).
 */
export function useFollow(viewerId: string | undefined, target: Profile | null | undefined) {
  const client = useQueryClient();
  const key = keys.profile(target?.username ?? '');
  return useMutation({
    mutationFn: async (action: FollowAction) => {
      if (!viewerId || !target) throw new Error('signed out');
      const { error } =
        action === 'follow'
          ? await supabase.from('follows').insert({ follower_id: viewerId, followee_id: target.id })
          : await supabase.from('follows').delete().eq('follower_id', viewerId).eq('followee_id', target.id);
      // 23505: already following (a double tap); the refetch shows the truth.
      if (error && error.code !== '23505') throw error;
    },
    onMutate: async (action) => {
      await client.cancelQueries({ queryKey: key });
      const previous = client.getQueryData<Profile | null>(key);
      client.setQueryData<Profile | null>(key, (p) =>
        p
          ? { ...p, followStatus: action === 'unfollow' ? null : p.isPrivate ? 'pending' : 'accepted' }
          : p,
      );
      return { previous };
    },
    onError: (_error, _action, context) => client.setQueryData(key, context?.previous),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: keys.profiles() });
      void client.invalidateQueries({ queryKey: ['search'] });
      void client.invalidateQueries({ queryKey: ['posts', 'by'] });
      void client.invalidateQueries({ queryKey: keys.following(viewerId ?? '') });
    },
  });
}

export type FollowRequest = Fns['my_follow_requests']['Returns'][number];

/** People waiting for you to accept their follow request. */
export function useFollowRequests(userId: string | undefined) {
  return useQuery({
    queryKey: keys.followRequests(userId ?? ''),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('my_follow_requests');
      if (error) throw error;
      return data ?? [];
    },
    enabled: Boolean(userId),
    staleTime: fresh.mine,
  });
}

/** Someone you follow, for the person picker and @mention suggestions. */
export type FollowedPerson = {
  id: string;
  username: string;
  avatarPath: string | null;
  disciplines: Database['public']['Enums']['discipline'][];
};

/**
 * The people you follow (accepted follows only). Blocks end follows, so
 * nobody blocked either way is in here.
 */
export function useFollowing(userId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: keys.following(userId ?? ''),
    queryFn: async (): Promise<FollowedPerson[]> => {
      const { data, error } = await supabase
        .from('follows')
        .select('followee:profiles!follows_followee_id_fkey(id, username, avatar_path, disciplines, deleted_at)')
        .eq('follower_id', userId!)
        .eq('status', 'accepted');
      if (error) throw error;
      return (data ?? [])
        .flatMap((row) => {
          const p = row.followee as {
            id: string;
            username: string | null;
            avatar_path: string | null;
            disciplines: FollowedPerson['disciplines'] | null;
            deleted_at: string | null;
          } | null;
          return p && p.username && !p.deleted_at
            ? [{ id: p.id, username: p.username, avatarPath: p.avatar_path, disciplines: p.disciplines ?? [] }]
            : [];
        })
        .sort((a, b) => a.username.localeCompare(b.username));
    },
    enabled: Boolean(userId) && enabled,
    staleTime: fresh.social,
  });
}

/** Accept or decline a request. Declining deletes it; they can ask again. */
export function useAnswerFollowRequest(userId: string | undefined) {
  const client = useQueryClient();
  const key = keys.followRequests(userId ?? '');
  return useMutation({
    mutationFn: async ({ followerId, accept }: { followerId: string; accept: boolean }) => {
      if (!userId) throw new Error('signed out');
      const query = accept
        ? supabase.from('follows').update({ status: 'accepted' }).eq('follower_id', followerId).eq('followee_id', userId)
        : supabase.from('follows').delete().eq('follower_id', followerId).eq('followee_id', userId);
      const { error } = await query;
      if (error) throw error;
    },
    onMutate: async ({ followerId }) => {
      await client.cancelQueries({ queryKey: key });
      const previous = client.getQueryData<FollowRequest[]>(key);
      client.setQueryData<FollowRequest[]>(key, (list) => list?.filter((r) => r.follower_id !== followerId));
      return { previous };
    },
    onError: (_error, _vars, context) => client.setQueryData(key, context?.previous),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: key });
      void client.invalidateQueries({ queryKey: keys.profiles() });
    },
  });
}

/* Blocking --------------------------------------------------------------------------- */

export type BlockedAccount = Fns['my_blocked_accounts']['Returns'][number];

/** The people you blocked, newest first. */
export function useBlockedAccounts(userId: string | undefined) {
  return useQuery({
    queryKey: keys.blocked(userId ?? ''),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('my_blocked_accounts');
      if (error) throw error;
      return data ?? [];
    },
    enabled: Boolean(userId),
    staleTime: fresh.mine,
  });
}

/**
 * Block or unblock someone. Blocking also ends any follow between you (a
 * database trigger), so every profile, search result and post list is
 * checked again afterwards.
 */
export function useBlock(userId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ personId, block }: { personId: string; block: boolean }) => {
      if (!userId) throw new Error('signed out');
      const { error } = block
        ? await supabase.from('blocks').insert({ blocker_id: userId, blocked_id: personId })
        : await supabase.from('blocks').delete().eq('blocker_id', userId).eq('blocked_id', personId);
      if (error && error.code !== '23505') throw error;
    },
    onMutate: async ({ personId, block }) => {
      if (block) return { previous: undefined };
      const key = keys.blocked(userId ?? '');
      await client.cancelQueries({ queryKey: key });
      const previous = client.getQueryData<BlockedAccount[]>(key);
      client.setQueryData<BlockedAccount[]>(key, (list) => list?.filter((b) => b.id !== personId));
      return { previous };
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) client.setQueryData(keys.blocked(userId ?? ''), context.previous);
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: keys.blocked(userId ?? '') });
      void client.invalidateQueries({ queryKey: keys.profiles() });
      void client.invalidateQueries({ queryKey: keys.followRequests(userId ?? '') });
      void client.invalidateQueries({ queryKey: keys.following(userId ?? '') });
      void client.invalidateQueries({ queryKey: ['search'] });
      void client.invalidateQueries({ queryKey: ['posts'] });
      // Their posts leave the Home feeds too (blocking from a post's menu, M5).
      void client.invalidateQueries({ queryKey: ['feed'] });
    },
  });
}
