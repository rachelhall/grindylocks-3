/**
 * Claiming pages and getting people in (brand and shop accounts, part A,
 * PR 5). The rules live in the database (migration `page_claims`):
 *
 * - Claim this page: a work email confirmed with a 6-digit code, or a
 *   GRIND-XXXX code posted on the brand's Instagram or website (7 days).
 *   Only the claimant and Rachel see a claim; Rachel decides it.
 * - Invites: Rachel's claim invite (the person becomes the owner) and team
 *   invites from owners and managers (the Team screen comes in PR 7).
 *   Emailed invites carry an invite code that also opens sign-up for that
 *   email, without using anyone's personal invites. Members answer from the
 *   bell's Page invites box.
 * - Logos: the public `page-images` bucket, one folder per page. A claim
 *   isn't finished until the page has a logo; the first one makes the page
 *   OFFICIAL and tells its followers it's here.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import i18n from '@/i18n';

import type { Database } from './database.types';
import type { PageMemberRole, PageRole, PageState } from './pages';
import { fresh, keys } from './query';
import { supabase } from './supabase';
import { uuid } from './uuid';

type Enums = Database['public']['Enums'];
export type ClaimProof = Enums['page_claim_proof'];
export type ClaimStatus = Enums['page_claim_status'];

/** The app's language, for the emails the database sends on your behalf. */
const appLanguage = () => (['en', 'es', 'da', 'de'].includes(i18n.language) ? i18n.language : 'en');

/* Claims ------------------------------------------------------------------------------------ */

export type MyClaim = {
  id: string;
  status: ClaimStatus;
  proof: ClaimProof;
  roleTitle: string;
  email: string | null;
  postedCode: string | null;
  postedCodeExpiresAt: string | null;
  postedUrl: string | null;
  sentAt: string | null;
  decidedAt: string | null;
  /** Rachel's words, or 'another_claim_approved' when someone else's claim went through. */
  declineReason: string | null;
  createdAt: string;
};

/** Your latest claim on a page, or null. */
export function useMyPageClaim(userId: string | undefined, pageId: string | undefined) {
  return useQuery({
    queryKey: keys.myPageClaim(userId ?? '', pageId ?? ''),
    queryFn: async (): Promise<MyClaim | null> => {
      const { data, error } = await supabase
        .from('page_claims')
        .select('id, status, proof, role_title, email, posted_code, posted_code_expires_at, posted_url, sent_at, decided_at, decline_reason, created_at')
        .eq('page_id', pageId!)
        .eq('user_id', userId!)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return {
        id: data.id,
        status: data.status,
        proof: data.proof,
        roleTitle: data.role_title,
        email: data.email,
        postedCode: data.posted_code,
        postedCodeExpiresAt: data.posted_code_expires_at,
        postedUrl: data.posted_url,
        sentAt: data.sent_at,
        decidedAt: data.decided_at,
        declineReason: data.decline_reason,
        createdAt: data.created_at,
      };
    },
    enabled: Boolean(userId && pageId),
    staleTime: fresh.mine,
  });
}

/**
 * Whether an email's domain matches the page's website or links, for the
 * sheet's live hint. The database works it out again for Rachel.
 */
export function emailMatchesPage(email: string, page: { website: string | null; links: string[] }): boolean | null {
  const domain = email.trim().toLowerCase().split('@')[1] ?? '';
  if (!/^[^\s@]+\.[^\s@]+$/.test(domain)) return null;
  const social = ['instagram.com', 'facebook.com', 'youtube.com', 'tiktok.com', 'x.com', 'twitter.com', 'linktr.ee', 'vimeo.com', 'gmail.com'];
  const hosts = [page.website, ...page.links]
    .filter((u): u is string => Boolean(u))
    .map((u) => u.toLowerCase().trim().replace(/^[a-z][a-z0-9+.-]*:\/\//, '').replace(/^www\./, '').replace(/[/:?#].*$/, ''))
    .filter((h) => h && !social.includes(h));
  if (hosts.length === 0) return null;
  return hosts.some((h) => domain === h || domain.endsWith(`.${h}`) || h.endsWith(`.${domain}`));
}

export type StartedClaim = {
  claimId: string;
  postedCode: string | null;
  postedCodeExpiresAt: string | null;
  domainMatches: boolean | null;
};

/** Starts a claim (or picks up your draft). A work email is sent a code. */
export function useStartClaim(userId: string | undefined, pageId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { roleTitle: string; proof: ClaimProof; email?: string; note?: string }): Promise<StartedClaim> => {
      const { data, error } = await supabase.rpc('start_page_claim', {
        page: pageId,
        role_title: input.roleTitle.trim(),
        proof: input.proof,
        email: input.proof === 'email' ? input.email?.trim() : undefined,
        note: input.note?.trim() || undefined,
        language: appLanguage(),
      });
      if (error) throw error;
      const row = data?.[0];
      if (!row) throw new Error('no_claim');
      return {
        claimId: row.claim_id,
        postedCode: row.posted_code,
        postedCodeExpiresAt: row.posted_code_expires_at,
        domainMatches: row.domain_matches,
      };
    },
    onSettled: () => qc.invalidateQueries({ queryKey: keys.myPageClaim(userId ?? '', pageId) }),
  });
}

export type SendClaimResult = 'pending' | 'wrong_code' | 'code_expired' | 'too_many_tries';

/** Sends the claim to Rachel, with the email code or where the code is posted. */
export function useSendClaim(userId: string | undefined, pageId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { claimId: string; emailCode?: string; postedUrl?: string }): Promise<SendClaimResult> => {
      const { data, error } = await supabase.rpc('send_page_claim', {
        claim: input.claimId,
        email_code: input.emailCode,
        posted_url: input.postedUrl?.trim(),
      });
      if (error) throw error;
      return data as SendClaimResult;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: keys.myPageClaim(userId ?? '', pageId) }),
  });
}

/** 'sent', 'wait' (once a minute) or 'too_many_codes'. */
export async function resendClaimCode(claimId: string): Promise<'sent' | 'wait' | 'too_many_codes'> {
  const { data, error } = await supabase.rpc('resend_page_claim_code', { claim: claimId, language: appLanguage() });
  if (error) throw error;
  return data as 'sent' | 'wait' | 'too_many_codes';
}

export function useWithdrawClaim(userId: string | undefined, pageId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (claimId: string) => {
      const { error } = await supabase.rpc('withdraw_page_claim', { claim: claimId });
      if (error) throw error;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: keys.myPageClaim(userId ?? '', pageId) }),
  });
}

/* Invites ----------------------------------------------------------------------------------- */

/** A page invite as the invite screen or the Page invites box shows it. */
export type PageInviteInfo = {
  kind: 'team' | 'ownership' | 'claim';
  /** The role a team invite offers. */
  role: PageMemberRole | null;
  page: {
    handle: string;
    displayName: string;
    roles: PageRole[];
    state: PageState;
    logoPath: string | null;
    city: string | null;
    country: string | null;
  };
  inviterUsername: string | null;
  expiresAt: string;
};

export type PageInvitePreview = PageInviteInfo & { email: string | null };

/** What an emailed page invite code is for, before signing in. Null when it isn't one (or is used up). */
export async function previewPageInvite(code: string): Promise<PageInvitePreview | null> {
  const { data, error } = await supabase.rpc('page_invite_preview', { code });
  if (error) throw error;
  const r = data?.[0];
  if (!r) return null;
  return {
    kind: r.kind as PageInviteInfo['kind'],
    role: (r.role as PageMemberRole | null) ?? null,
    page: {
      handle: r.page_handle,
      displayName: r.page_name,
      roles: r.page_roles as PageRole[],
      state: r.page_state as PageState,
      logoPath: r.page_logo_path,
      city: r.page_city,
      country: r.page_country,
    },
    inviterUsername: r.inviter_username,
    expiresAt: r.expires_at,
    email: r.email,
  };
}

export type MyPageInvite = PageInviteInfo & {
  id: string;
  createdAt: string;
  inviterAvatarPath: string | null;
  /** Your current role on the page (an ownership hand-over goes to a member). */
  myRole: PageMemberRole | null;
};

export function useMyPageInvites(userId: string | undefined) {
  return useQuery({
    queryKey: keys.myPageInvites(userId ?? ''),
    queryFn: async (): Promise<MyPageInvite[]> => {
      const { data, error } = await supabase.rpc('my_page_invites');
      if (error) throw error;
      return (data ?? []).map((r) => ({
        id: r.id,
        kind: r.kind as PageInviteInfo['kind'],
        role: (r.role as PageMemberRole | null) ?? null,
        createdAt: r.created_at,
        expiresAt: r.expires_at,
        page: {
          handle: r.page_handle,
          displayName: r.page_name,
          roles: r.page_roles as PageRole[],
          state: r.page_state as PageState,
          logoPath: r.page_logo_path,
          city: r.page_city,
          country: r.page_country,
        },
        inviterUsername: r.inviter_username,
        inviterAvatarPath: r.inviter_avatar_path,
        myRole: (r.my_role as PageMemberRole | null) ?? null,
      }));
    },
    enabled: Boolean(userId),
    staleTime: fresh.mine,
  });
}

/** Accept or decline; returns the page's handle. */
export function useAnswerPageInvite(userId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ inviteId, accept }: { inviteId: string; accept: boolean }) => {
      const { data, error } = await supabase.rpc('answer_page_invite', { invite: inviteId, accept });
      if (error) throw error;
      return data as string;
    },
    onSettled: (handle) => {
      void qc.invalidateQueries({ queryKey: keys.myPageInvites(userId ?? '') });
      void qc.invalidateQueries({ queryKey: keys.myPages(userId ?? '') });
      void qc.invalidateQueries({ queryKey: keys.notificationsUnread(userId ?? '') });
      if (handle) void qc.invalidateQueries({ queryKey: keys.page(handle) });
      void qc.invalidateQueries({ queryKey: ['page', 'state'] });
    },
  });
}

/**
 * Onboarding, after the age check: takes the emailed page invite the account
 * was created with. Returns the page's handle, or null. Safe to repeat.
 */
export async function redeemMyPageInvite(): Promise<string | null> {
  const { data, error } = await supabase.rpc('redeem_my_page_invite');
  if (error) throw error;
  return (data as string | null) ?? null;
}

/** The page someone joined through when they signed up, for onboarding. */
export type PageJoin = {
  pageId: string;
  handle: string;
  displayName: string;
  roles: PageRole[];
  role: PageMemberRole;
  city: string | null;
  /** A shop's metro area, to fill in the home city ("FROM 8SET"). */
  metroAreaId: string | null;
  /** An owner whose page has no logo yet gets the logo step last. */
  needsLogo: boolean;
};

export async function fetchMyPageOnboarding(): Promise<PageJoin | null> {
  const { data, error } = await supabase.rpc('my_page_onboarding');
  if (error) throw error;
  const r = data?.[0];
  if (!r) return null;
  return {
    pageId: r.page_id,
    handle: r.handle,
    displayName: r.display_name,
    roles: r.roles as PageRole[],
    role: r.role as PageMemberRole,
    city: r.city,
    metroAreaId: r.metro_area_id,
    needsLogo: r.needs_logo,
  };
}

/* Your pages -------------------------------------------------------------------------------- */

export type MyPage = {
  pageId: string;
  handle: string;
  displayName: string;
  roles: PageRole[];
  state: PageState;
  logoPath: string | null;
  role: PageMemberRole;
  inboxPush: boolean;
};

export function useMyPages(userId: string | undefined) {
  return useQuery({
    queryKey: keys.myPages(userId ?? ''),
    queryFn: async (): Promise<MyPage[]> => {
      const { data, error } = await supabase.rpc('my_pages');
      if (error) throw error;
      return (data ?? []).map((r) => ({
        pageId: r.page_id,
        handle: r.handle,
        displayName: r.display_name,
        roles: r.roles as PageRole[],
        state: r.state as PageState,
        logoPath: r.logo_path,
        role: r.role as PageMemberRole,
        inboxPush: r.inbox_push,
      }));
    },
    enabled: Boolean(userId),
    staleTime: fresh.mine,
  });
}

/** Flips your push switch for one page's inbox at once, and puts it back if saving fails. */
export function useSetPageInboxPush(userId: string | undefined) {
  const qc = useQueryClient();
  const key = keys.myPages(userId ?? '');
  return useMutation({
    mutationFn: async ({ pageId, enabled }: { pageId: string; enabled: boolean }) => {
      const { error } = await supabase.rpc('set_page_inbox_push', { page: pageId, enabled });
      if (error) throw error;
    },
    onMutate: async ({ pageId, enabled }) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<MyPage[]>(key);
      qc.setQueryData<MyPage[]>(key, (list) => list?.map((p) => (p.pageId === pageId ? { ...p, inboxPush: enabled } : p)));
      return { previous };
    },
    onError: (_e, _v, context) => qc.setQueryData(key, context?.previous),
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });
}

/* Logos ------------------------------------------------------------------------------------- */

const LOGO_SIZE = 512;

/**
 * Opens the photo library for one image, cropped square (the system crop
 * screen), and saves it as a 512 px PNG so a transparent logo stays
 * transparent. Returns the local file, or null if they backed out.
 */
export async function pickLogo(): Promise<string | null> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect: [1, 1],
    quality: 1,
    exif: false,
  });
  if (result.canceled || !result.assets[0]) return null;
  const asset = result.assets[0];
  const side = Math.min(asset.width, asset.height);
  const ctx = ImageManipulator.manipulate(asset.uri);
  if (asset.width !== asset.height && side > 0) {
    ctx.crop({
      originX: Math.floor((asset.width - side) / 2),
      originY: Math.floor((asset.height - side) / 2),
      width: side,
      height: side,
    });
  }
  ctx.resize({ width: Math.min(LOGO_SIZE, side || LOGO_SIZE), height: Math.min(LOGO_SIZE, side || LOGO_SIZE) });
  const image = await ctx.renderAsync();
  const saved = await image.saveAsync({ format: SaveFormat.PNG });
  return saved.uri;
}

/** Uploads a picked logo to the page's folder and makes it the page's logo. */
export function useSetPageLogo(userId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ pageId, localUri }: { pageId: string; localUri: string }) => {
      // A new name each time, so a cached image never shows the old logo.
      const path = `${pageId}/${uuid()}.png`;
      const bytes = await new File(localUri).arrayBuffer();
      const { error: uploadError } = await supabase.storage
        .from('page-images')
        .upload(path, bytes, { contentType: 'image/png', upsert: false });
      if (uploadError) throw uploadError;
      const { error } = await supabase.rpc('set_page_logo', { page: pageId, path });
      if (error) {
        await supabase.storage.from('page-images').remove([path]);
        throw error;
      }
      return path;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['page'] });
      void qc.invalidateQueries({ queryKey: keys.myPages(userId ?? '') });
      void qc.invalidateQueries({ queryKey: ['page-search'] });
    },
  });
}

/* The bell ---------------------------------------------------------------------------------- */

export type PageNoticeKind = 'page_claim_approved' | 'page_claim_declined' | 'page_team_change' | 'page_claimed' | 'suggestion_live';

/** A page notification in the bell, beside the people ones. */
export type PageNotice = {
  id: string;
  kind: PageNoticeKind;
  createdAt: string;
  unread: boolean;
  page: { id: string; handle: string; displayName: string; roles: PageRole[]; state: PageState; logoPath: string | null };
  actorUsername: string | null;
  /**
   * Declined: Rachel's reason ('another_claim_approved' when someone else's
   * went through). Team change: 'role:manager', 'role:staff', 'removed' or
   * 'owner'. Suggestion live: what went live.
   */
  message: string | null;
};

const NOTICE_KINDS = new Set<string>(['page_claim_approved', 'page_claim_declined', 'page_team_change', 'page_claimed', 'suggestion_live']);

export function useMyPageNotifications(userId: string | undefined) {
  return useQuery({
    queryKey: keys.myPageNotifications(userId ?? ''),
    queryFn: async (): Promise<PageNotice[]> => {
      const { data, error } = await supabase.rpc('my_page_notifications');
      if (error) throw error;
      return (data ?? [])
        .filter((r) => NOTICE_KINDS.has(r.kind))
        .map((r) => ({
          id: r.id,
          kind: r.kind as PageNoticeKind,
          createdAt: r.created_at,
          unread: r.unread,
          page: {
            id: r.page_id,
            handle: r.page_handle,
            displayName: r.page_name,
            roles: r.page_roles as PageRole[],
            state: r.page_state as PageState,
            logoPath: r.page_logo_path,
          },
          actorUsername: r.actor_username,
          message: r.message,
        }));
    },
    enabled: Boolean(userId),
    staleTime: fresh.mine,
  });
}
