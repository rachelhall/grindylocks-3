/**
 * Running a page (brand and shop accounts, part A, PR 7a). The rules live in
 * the database (migration `page_team`), following the PRD's permissions:
 *
 * - Everyone on the team sees the team, the inbox and the follower number,
 *   and can set Closed for a while on a shop.
 * - Managers and the owner edit the page, invite people, move staff up to
 *   manager, remove staff and block skaters from the page.
 * - Only the owner moves a manager down, removes a manager, hands the page
 *   over (the new owner accepts from the bell) or closes it for good.
 * - Address and pin (managers and the owner) and hours (everyone on the
 *   team) came with PR 7b.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import i18n from '@/i18n';

import type { Database, Json } from './database.types';
import type { rowsFromSets } from './page-hours';
import type { PageMemberRole, PageRole, PageState } from './pages';
import { fresh, keys } from './query';
import { supabase } from './supabase';
import { uuid } from './uuid';

type Enums = Database['public']['Enums'];
export type ShopLocationType = Enums['shop_location_type'];

/** The languages a page can write in: the app's four. */
export const PAGE_LANGUAGES = ['en', 'es', 'da', 'de'] as const;
export type PageLanguage = (typeof PAGE_LANGUAGES)[number];
export const MAX_PAGE_LINKS = 3;
export const MAX_DESCRIPTION = 300;
export const MAX_CLOSED_NOTE = 200;
/** Open team invites a page can have at once (the database's cap). */
export const MAX_OPEN_INVITES = 10;

const appLanguage = () => (['en', 'es', 'da', 'de'].includes(i18n.language) ? i18n.language : 'en');

/** Rank, to compare roles: owner > manager > staff. */
export const roleRank = (r: PageMemberRole | null | undefined) => (r === 'owner' ? 3 : r === 'manager' ? 2 : r === 'staff' ? 1 : 0);

/* The team ------------------------------------------------------------------------------- */

export type TeamMember = {
  userId: string;
  username: string | null;
  avatarPath: string | null;
  role: PageMemberRole;
  joinedAt: string;
  isMe: boolean;
};

export function usePageTeam(pageId: string | undefined) {
  return useQuery({
    queryKey: keys.pageTeam(pageId ?? ''),
    queryFn: async (): Promise<TeamMember[]> => {
      const { data, error } = await supabase.rpc('page_team', { page: pageId! });
      if (error) throw error;
      return (data ?? []).map((r) => ({
        userId: r.user_id,
        username: r.username,
        avatarPath: r.avatar_path,
        role: r.role as PageMemberRole,
        joinedAt: r.joined_at,
        isMe: r.is_me,
      }));
    },
    enabled: Boolean(pageId),
    staleTime: fresh.mine,
  });
}

export type TeamInvite = {
  id: string;
  kind: 'team' | 'ownership';
  role: PageMemberRole | null;
  username: string | null;
  avatarPath: string | null;
  email: string | null;
  createdAt: string;
  expiresAt: string;
};

/** Open invites (managers and the owner only). */
export function usePageTeamInvites(pageId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: keys.pageTeamInvites(pageId ?? ''),
    queryFn: async (): Promise<TeamInvite[]> => {
      const { data, error } = await supabase.rpc('page_team_invites', { page: pageId! });
      if (error) throw error;
      return (data ?? []).map((r) => ({
        id: r.id,
        kind: r.kind as TeamInvite['kind'],
        role: (r.role as PageMemberRole | null) ?? null,
        username: r.username,
        avatarPath: r.avatar_path,
        email: r.email,
        createdAt: r.created_at,
        expiresAt: r.expires_at,
      }));
    },
    enabled: Boolean(pageId) && enabled,
    staleTime: fresh.mine,
  });
}

/** Every team write refreshes the team, its invites, your pages and the page's viewer state. */
function useTeamInvalidate(pageId: string | undefined, userId: string | undefined) {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['page-team', pageId ?? ''] });
    void qc.invalidateQueries({ queryKey: keys.myPages(userId ?? '') });
    void qc.invalidateQueries({ queryKey: ['page', 'state'] });
  };
}

/** Invite by username or email (managers and the owner). Returns the invite's ID. */
export function useInviteToPage(pageId: string | undefined, userId: string | undefined) {
  const done = useTeamInvalidate(pageId, userId);
  return useMutation({
    mutationFn: async ({ who, role }: { who: string; role: 'staff' | 'manager' }) => {
      const { data, error } = await supabase.rpc('invite_to_page', {
        page: pageId!,
        who: who.trim(),
        role,
        language: appLanguage(),
      });
      if (error) throw error;
      return data as string;
    },
    onSettled: done,
  });
}

export function useCancelPageInvite(pageId: string | undefined, userId: string | undefined) {
  const done = useTeamInvalidate(pageId, userId);
  return useMutation({
    mutationFn: async (inviteId: string) => {
      const { error } = await supabase.rpc('cancel_page_invite', { invite: inviteId });
      if (error) throw error;
    },
    onSettled: done,
  });
}

export function useSetMemberRole(pageId: string | undefined, userId: string | undefined) {
  const done = useTeamInvalidate(pageId, userId);
  return useMutation({
    mutationFn: async ({ member, role }: { member: string; role: 'staff' | 'manager' }) => {
      const { error } = await supabase.rpc('set_page_member_role', { page: pageId!, member, role });
      if (error) throw error;
    },
    onSettled: done,
  });
}

export function useRemoveMember(pageId: string | undefined, userId: string | undefined) {
  const done = useTeamInvalidate(pageId, userId);
  return useMutation({
    mutationFn: async (member: string) => {
      const { error } = await supabase.rpc('remove_page_member', { page: pageId!, member });
      if (error) throw error;
    },
    onSettled: done,
  });
}

export function useLeaveTeam(pageId: string | undefined, userId: string | undefined) {
  const done = useTeamInvalidate(pageId, userId);
  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('leave_page_team', { page: pageId! });
      if (error) throw error;
    },
    onSettled: done,
  });
}

/** The owner offers the page to someone on the team; offering again replaces the open one. */
export function useOfferOwnership(pageId: string | undefined, userId: string | undefined) {
  const done = useTeamInvalidate(pageId, userId);
  return useMutation({
    mutationFn: async (member: string) => {
      const { data, error } = await supabase.rpc('offer_page_ownership', { page: pageId!, member });
      if (error) throw error;
      return data as string;
    },
    onSettled: done,
  });
}

/* Blocking skaters from the page --------------------------------------------------------- */

export type BlockedPerson = {
  userId: string;
  username: string | null;
  avatarPath: string | null;
  blockedAt: string;
  blockedByUsername: string | null;
};

export function usePageBlocked(pageId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: keys.pageBlocked(pageId ?? ''),
    queryFn: async (): Promise<BlockedPerson[]> => {
      const { data, error } = await supabase.rpc('page_blocked_people', { page: pageId! });
      if (error) throw error;
      return (data ?? []).map((r) => ({
        userId: r.user_id,
        username: r.username,
        avatarPath: r.avatar_path,
        blockedAt: r.blocked_at,
        blockedByUsername: r.blocked_by_username,
      }));
    },
    enabled: Boolean(pageId) && enabled,
    staleTime: fresh.mine,
  });
}

export function usePageBlock(pageId: string | undefined, userId: string | undefined) {
  const done = useTeamInvalidate(pageId, userId);
  return useMutation({
    mutationFn: async ({ who, on }: { who: string; on: boolean }) => {
      const { error } = on
        ? await supabase.rpc('block_from_page', { page: pageId!, who })
        : await supabase.rpc('unblock_from_page', { page: pageId!, who });
      if (error) throw error;
    },
    onSettled: done,
  });
}

/* The inbox ------------------------------------------------------------------------------ */

export type InboxItem = {
  id: string;
  /**
   * @mentions: 'caption', 'comment', 'meetup_comment'. Since PR 8b also
   * 'post_comment' (a comment on the page's post) and 'reply' (an answer to
   * one of the page's comments).
   */
  kind: 'caption' | 'comment' | 'meetup_comment' | 'post_comment' | 'reply';
  createdAt: string;
  unread: boolean;
  /** Null when another page wrote it (authorPage is set instead). */
  authorId: string | null;
  authorUsername: string | null;
  authorAvatarPath: string | null;
  authorPage: { id: string; handle: string; displayName: string; logoPath: string | null; state: PageState } | null;
  body: string | null;
  postId: string | null;
  commentId: string | null;
  eventId: string | null;
  eventTitle: string | null;
};

function inboxPage(raw: unknown): InboxItem['authorPage'] {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as { id: string; handle: string; display_name: string; logo_path: string | null; state: PageState };
  return { id: p.id, handle: p.handle, displayName: p.display_name, logoPath: p.logo_path, state: p.state };
}

export function usePageInbox(userId: string | undefined, pageId: string | undefined) {
  return useQuery({
    queryKey: keys.pageInbox(userId ?? '', pageId ?? ''),
    queryFn: async (): Promise<InboxItem[]> => {
      const { data, error } = await supabase.rpc('page_inbox', { page: pageId! });
      if (error) throw error;
      return (data ?? []).map((r) => ({
        id: r.id,
        kind: r.kind as InboxItem['kind'],
        createdAt: r.created_at,
        unread: r.unread,
        authorId: r.author_id,
        authorUsername: r.author_username,
        authorAvatarPath: r.author_avatar_path,
        authorPage: inboxPage(r.author_page),
        body: r.body,
        postId: r.post_id,
        commentId: r.comment_id,
        eventId: r.event_id,
        eventTitle: r.event_title,
      }));
    },
    enabled: Boolean(userId && pageId),
    staleTime: fresh.mine,
  });
}

/** Opening the inbox: what's there now becomes Earlier next time, and the dots go. */
export function useMarkInboxSeen(pageId: string | undefined, userId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('mark_page_inbox_seen', { page: pageId! });
      if (error) throw error;
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: keys.myPages(userId ?? '') }),
  });
}

export function usePageFollowerCount(pageId: string | undefined) {
  return useQuery({
    queryKey: keys.pageFollowers(pageId ?? ''),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('page_follower_count', { page: pageId! });
      if (error) throw error;
      return (data as number | null) ?? 0;
    },
    enabled: Boolean(pageId),
    staleTime: fresh.mine,
  });
}

/* Edit page ------------------------------------------------------------------------------ */

/** After an edit, the page and anything that shows it (Search, the map, your pages). */
function usePageEdited(userId: string | undefined) {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['page'] });
    void qc.invalidateQueries({ queryKey: ['page-search'] });
    void qc.invalidateQueries({ queryKey: ['shops'] });
    void qc.invalidateQueries({ queryKey: keys.myPages(userId ?? '') });
  };
}

export type PageDetailsInput = {
  pageId: string;
  mainLanguage: PageLanguage;
  links: string[];
  /** Only the languages that changed; an empty body takes that language off. */
  descriptions: { locale: PageLanguage; body: string }[];
  locationType?: { value: ShopLocationType; showPin: boolean } | null;
};

/** Saves the managers' part of Edit page in one go: details and links, descriptions, how people visit. */
export function useSavePageDetails(userId: string | undefined) {
  const done = usePageEdited(userId);
  return useMutation({
    mutationFn: async (input: PageDetailsInput) => {
      // The main language's description goes in first, so it's never empty when the language switches.
      const ordered = [...input.descriptions].sort((a, b) =>
        a.locale === input.mainLanguage ? -1 : b.locale === input.mainLanguage ? 1 : 0,
      );
      for (const d of ordered.filter((x) => x.body.trim())) {
        const { error } = await supabase.rpc('set_page_description', { page: input.pageId, locale: d.locale, body: d.body });
        if (error) throw error;
      }
      const { error } = await supabase.rpc('update_page_details', {
        page: input.pageId,
        main_language: input.mainLanguage,
        links: input.links,
      });
      if (error) throw error;
      for (const d of ordered.filter((x) => !x.body.trim())) {
        const { error: removeError } = await supabase.rpc('set_page_description', { page: input.pageId, locale: d.locale, body: '' });
        if (removeError) throw removeError;
      }
      if (input.locationType) {
        const { error: typeError } = await supabase.rpc('set_page_location_type', {
          page: input.pageId,
          location_type: input.locationType.value,
          show_pin: input.locationType.showPin,
        });
        if (typeError) throw typeError;
      }
    },
    onSettled: done,
  });
}

/** Closed for a while (everyone on the team). `closedUntil` is a YYYY-MM-DD date or null for "Closed for now". */
export function useSetTempClosed(userId: string | undefined) {
  const done = usePageEdited(userId);
  return useMutation({
    mutationFn: async ({ pageId, closed, closedUntil, note }: { pageId: string; closed: boolean; closedUntil: string | null; note: string }) => {
      const { error } = await supabase.rpc('set_page_temp_closed', {
        page: pageId,
        closed,
        closed_until: closed && closedUntil ? closedUntil : undefined,
        note: closed ? note.trim() : undefined,
      });
      if (error) throw error;
    },
    onSettled: done,
  });
}

export function useSetBrandsCarried(userId: string | undefined) {
  const done = usePageEdited(userId);
  return useMutation({
    mutationFn: async ({ pageId, brandIds }: { pageId: string; brandIds: string[] }) => {
      const { error } = await supabase.rpc('set_page_brands_carried', { page: pageId, brands: brandIds });
      if (error) throw error;
    },
    onSettled: done,
  });
}

/** Address and pin (PR 7b; managers and the owner). A null pin takes it off the map. */
export function useSetPageLocation(userId: string | undefined) {
  const done = usePageEdited(userId);
  return useMutation({
    mutationFn: async ({ pageId, address, pin }: { pageId: string; address: string; pin: { latitude: number; longitude: number } | null }) => {
      const { error } = await supabase.rpc('set_page_location', {
        page: pageId,
        address: address.trim(),
        // null, not undefined: the function has no defaults, and undefined drops out of the request.
        latitude: (pin?.latitude ?? null) as number,
        longitude: (pin?.longitude ?? null) as number,
      });
      if (error) throw error;
    },
    onSettled: done,
  });
}

/** A shop's hours, replaced in one go (PR 7b; everyone on the team). See `src/lib/page-hours.ts`. */
export function useSetPageHours(userId: string | undefined) {
  const done = usePageEdited(userId);
  return useMutation({
    mutationFn: async ({ pageId, rows }: { pageId: string; rows: ReturnType<typeof rowsFromSets> }) => {
      const { error } = await supabase.rpc('set_page_hours', { page: pageId, hours: rows as unknown as Json });
      if (error) throw error;
    },
    onSettled: done,
  });
}

/** Owner only: a shop becomes Closed, a brand Retired. Returns the new state. */
export function useClosePageForGood(userId: string | undefined) {
  const done = usePageEdited(userId);
  return useMutation({
    mutationFn: async (pageId: string) => {
      const { data, error } = await supabase.rpc('close_page_for_good', { page: pageId });
      if (error) throw error;
      return data as PageState;
    },
    onSettled: done,
  });
}

/* Header photo ---------------------------------------------------------------------------- */

const HEADER_WIDTH = 1600;

/**
 * Picks a header photo, cropped wide (the header is about 4:3 on a phone),
 * at most 1600 px across as a JPEG, so it stays under the bucket's 2 MB.
 */
export async function pickHeaderPhoto(): Promise<string | null> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect: [4, 3],
    quality: 1,
    exif: false,
  });
  if (result.canceled || !result.assets[0]) return null;
  const asset = result.assets[0];
  const ctx = ImageManipulator.manipulate(asset.uri);
  if (asset.width > HEADER_WIDTH) ctx.resize({ width: HEADER_WIDTH });
  const image = await ctx.renderAsync();
  const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.8 });
  return saved.uri;
}

/** Uploads a picked header photo to the page's folder and sets it; `localUri: null` takes it off. */
export function useSetPageHeader(userId: string | undefined) {
  const done = usePageEdited(userId);
  return useMutation({
    mutationFn: async ({ pageId, localUri }: { pageId: string; localUri: string | null }) => {
      if (!localUri) {
        const { error } = await supabase.rpc('set_page_header', { page: pageId });
        if (error) throw error;
        return null;
      }
      const path = `${pageId}/header-${uuid()}.jpg`;
      const bytes = await new File(localUri).arrayBuffer();
      const { error: uploadError } = await supabase.storage
        .from('page-images')
        .upload(path, bytes, { contentType: 'image/jpeg', upsert: false });
      if (uploadError) throw uploadError;
      const { error } = await supabase.rpc('set_page_header', { page: pageId, path });
      if (error) {
        await supabase.storage.from('page-images').remove([path]);
        throw error;
      }
      return path;
    },
    onSettled: done,
  });
}

/* Deleting your account while you own a page --------------------------------------------- */

export type OwnedPage = {
  pageId: string;
  handle: string;
  displayName: string;
  roles: PageRole[];
  state: PageState;
  logoPath: string | null;
  teamSize: number;
  handoverId: string | null;
  handoverUsername: string | null;
  declinedUsername: string | null;
};

export function useMyOwnedPages(userId: string | undefined) {
  return useQuery({
    queryKey: keys.myOwnedPages(userId ?? ''),
    queryFn: async (): Promise<OwnedPage[]> => {
      const { data, error } = await supabase.rpc('my_owned_pages');
      if (error) throw error;
      return (data ?? []).map((r) => ({
        pageId: r.page_id,
        handle: r.handle,
        displayName: r.display_name,
        roles: r.roles as PageRole[],
        state: r.state as PageState,
        logoPath: r.logo_path,
        teamSize: r.team_size,
        handoverId: r.handover_id,
        handoverUsername: r.handover_username,
        declinedUsername: r.declined_username,
      }));
    },
    enabled: Boolean(userId),
    staleTime: fresh.mine,
  });
}

/** The database's reason, for alerts: `not_allowed`, `too_many_invites` and so on. */
export function teamError(err: unknown): string {
  const message = (err as { message?: string } | null)?.message ?? '';
  return message;
}
