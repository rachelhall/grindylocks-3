/**
 * Profiles: yours and other members', their posts grid, profile photos, and
 * saving changes from Edit profile and Settings.
 *
 * What other members can see is decided by the database: the profiles read
 * rule hides people blocked either way, the role rule hides hidden badges,
 * and the posts rule hides a private account's posts from non-followers.
 */
import {
  type InfiniteData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import type { Database } from './database.types';
import { photoUrls } from './media';
import { fresh, keys } from './query';
import { supabase } from './supabase';
import { uuid } from './uuid';

type Enums = Database['public']['Enums'];
export type Discipline = Enums['discipline'];
export type RoleName = Enums['role_name'];
export type FollowStatus = Enums['follow_status'];

/** Signup offers these three; BMX and scooter exist only for park sessions. */
export const PROFILE_DISCIPLINES = ['inline', 'quad', 'skateboard'] as const satisfies readonly Discipline[];

export const BIO_MAX = 150;

/** Characters as the database counts them (code points, so an emoji is one). */
export const bioLength = (bio: string) => [...bio].length;

/* Reading a profile ---------------------------------------------------------------- */

export type RoleBadge = {
  id: string;
  role: RoleName;
  /** The park or city the role is for; null for the owner. */
  place: string | null;
  hidden: boolean;
};

export type Profile = {
  id: string;
  username: string;
  avatarPath: string | null;
  bio: string | null;
  disciplines: Discipline[];
  isPrivate: boolean;
  openToMeetup: boolean;
  hideFromRegulars: boolean;
  joinedAt: string;
  lastActiveAt: string;
  usernameChangedAt: string | null;
  homeMetro: { id: string; name: string } | null;
  homePark: { id: string; slug: string; name: string } | null;
  /** Active roles (accepted, not ended). Other members only get ones with the badge shown. */
  roles: RoleBadge[];
  /** Whether the viewer follows them. Always null on your own profile. */
  followStatus: FollowStatus | null;
};

const PROFILE_COLUMNS = `id, username, avatar_path, bio, disciplines, is_private, open_to_meetup,
  hide_from_regulars, joined_at, last_active_at, username_changed_at, deleted_at, onboarded_at,
  metro_areas!profiles_home_metro_area_id_fkey(id, name),
  parks!profiles_home_park_id_fkey(id, slug, display_name),
  role_assignments!role_assignments_user_id_fkey(id, role, accepted_at, ended_at, badge_hidden,
    metro_areas(name), parks(display_name))`;

/** Owner first, then city admin, park admin, park contributor. */
const ROLE_ORDER: RoleName[] = ['owner', 'city_admin', 'park_admin', 'park_contributor'];

async function loadProfile(match: { id: string } | { username: string }, viewerId: string): Promise<Profile | null> {
  let query = supabase.from('profiles').select(PROFILE_COLUMNS);
  query = 'id' in match ? query.eq('id', match.id) : query.eq('username', match.username);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  // No row: unknown name, or blocked either way. Deleted and unfinished
  // accounts aren't shown either.
  if (!data || !data.username || data.deleted_at || !data.onboarded_at) return null;

  let followStatus: FollowStatus | null = null;
  if (data.id !== viewerId) {
    const follow = await supabase
      .from('follows')
      .select('status')
      .eq('follower_id', viewerId)
      .eq('followee_id', data.id)
      .maybeSingle();
    if (follow.error) throw follow.error;
    followStatus = follow.data?.status ?? null;
  }

  const roles = data.role_assignments
    .filter((r) => r.accepted_at && !r.ended_at)
    .sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role))
    .map((r) => ({
      id: r.id,
      role: r.role,
      place: r.parks?.display_name ?? r.metro_areas?.name ?? null,
      hidden: r.badge_hidden,
    }));

  return {
    id: data.id,
    username: data.username,
    avatarPath: data.avatar_path,
    bio: data.bio,
    disciplines: data.disciplines,
    isPrivate: data.is_private,
    openToMeetup: data.open_to_meetup,
    hideFromRegulars: data.hide_from_regulars,
    joinedAt: data.joined_at,
    lastActiveAt: data.last_active_at,
    usernameChangedAt: data.username_changed_at,
    homeMetro: data.metro_areas,
    homePark: data.parks ? { id: data.parks.id, slug: data.parks.slug, name: data.parks.display_name } : null,
    roles,
    followStatus,
  };
}

/** The badge to show on a profile: the highest active role, unless hidden. */
export function visibleBadge(profile: Profile): RoleBadge | null {
  return profile.roles.find((r) => !r.hidden) ?? null;
}

/** Your own profile. Always checked again when shown (`fresh.mine`). */
export function useMyProfile(userId: string | undefined) {
  return useQuery({
    queryKey: keys.myProfile(userId ?? ''),
    queryFn: () => loadProfile({ id: userId! }, userId!),
    enabled: Boolean(userId),
    staleTime: fresh.mine,
  });
}

/** Someone's profile by username. Null when it doesn't exist or either of you blocked the other. */
export function useProfile(username: string | undefined, viewerId: string | undefined) {
  return useQuery({
    queryKey: keys.profile(username ?? ''),
    queryFn: () => loadProfile({ username: username! }, viewerId!),
    enabled: Boolean(username && viewerId),
    staleTime: fresh.mine,
  });
}

/* Profile photos ------------------------------------------------------------------------ */

const AVATAR_BUCKET = 'avatars';
const AVATAR_SIZE = 512;
const AVATAR_QUALITY = 0.8;

async function signAvatar(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from(AVATAR_BUCKET).createSignedUrl(path, 60 * 60);
  if (error) throw error;
  return data?.signedUrl ?? null;
}

/** A signed URL for a profile photo, or null when there's none. */
export function useAvatarUrl(path: string | null | undefined) {
  const { data } = useQuery({
    queryKey: keys.avatar(path ?? ''),
    queryFn: () => signAvatar(path!),
    enabled: Boolean(path),
    staleTime: fresh.avatars,
    // The signed URL lasts an hour, so the cached one must never outlive it.
    gcTime: fresh.avatars,
  });
  return path ? (data ?? null) : null;
}

/**
 * Opens the photo library for one photo, cropped to a square (the system
 * crop screen), then re-encodes it to a 512 px JPEG. Returns the local file,
 * or null if the member backed out.
 */
export async function pickAvatar(): Promise<string | null> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect: [1, 1],
    quality: 1,
    exif: false,
  });
  if (result.canceled || !result.assets[0]) return null;
  const asset = result.assets[0];

  // The crop screen should give a square already; center-crop in case it didn't.
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
  ctx.resize({ width: AVATAR_SIZE, height: AVATAR_SIZE });
  const image = await ctx.renderAsync();
  const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: AVATAR_QUALITY });
  return saved.uri;
}

/** Uploads a prepared photo to <user>/<new id>.jpg and returns its path. */
async function uploadAvatar(userId: string, localUri: string): Promise<string> {
  // A new name each time, so a cached signed URL never shows the old photo.
  const path = `${userId}/${uuid()}.jpg`;
  const bytes = await new File(localUri).arrayBuffer();
  const { error } = await supabase.storage
    .from(AVATAR_BUCKET)
    .upload(path, bytes, { contentType: 'image/jpeg', upsert: false });
  if (error) throw error;
  return path;
}

async function removeAvatar(path: string) {
  await supabase.storage.from(AVATAR_BUCKET).remove([path]);
}

/* Posts grid ------------------------------------------------------------------------------- */

export type GridPost = {
  id: string;
  publishedAt: string;
  slideCount: number;
  /** The first slide, at its stored size. */
  cover: {
    kind: 'photo' | 'video';
    width: number;
    height: number;
    durationS: number | null;
    photoUrl?: string;
    videoId?: string | null;
  } | null;
};

const PAGE_SIZE = 30;

async function fetchProfilePosts(userId: string, page: number): Promise<GridPost[]> {
  const { data, error } = await supabase
    .from('posts')
    .select('id, published_at, slide_count, post_slides(position, kind, width, height, duration_s, storage_path, stream_video_id)')
    .eq('author_id', userId)
    .eq('status', 'visible')
    .not('published_at', 'is', null)
    .eq('post_slides.position', 0)
    .order('published_at', { ascending: false })
    .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
  if (error) throw error;

  const rows = data ?? [];
  const urls = await photoUrls(
    rows
      .map((r) => r.post_slides[0])
      .filter((s) => s?.kind === 'photo' && s.storage_path)
      .map((s) => s!.storage_path!),
  );
  return rows.map((r) => {
    const s = r.post_slides[0];
    return {
      id: r.id,
      publishedAt: r.published_at!,
      slideCount: r.slide_count,
      cover: s
        ? {
            kind: s.kind,
            width: s.width,
            height: s.height,
            durationS: s.duration_s,
            photoUrl: s.storage_path ? urls[s.storage_path] : undefined,
            videoId: s.stream_video_id,
          }
        : null,
    };
  });
}

/**
 * A member's published posts, newest first, 30 at a time. Off when the
 * viewer can't see them (a private account they don't follow).
 */
export function useProfilePosts(userId: string | undefined, enabled = true) {
  return useInfiniteQuery<GridPost[], Error, InfiniteData<GridPost[]>, readonly unknown[], number>({
    queryKey: keys.profilePosts(userId ?? ''),
    queryFn: ({ pageParam }) => fetchProfilePosts(userId!, pageParam),
    initialPageParam: 0,
    getNextPageParam: (last, all) => (last.length === PAGE_SIZE ? all.length : undefined),
    enabled: Boolean(userId) && enabled,
    // Photo URLs are signed for an hour (see `fresh.posts`).
    staleTime: fresh.posts,
  });
}

/* Reserved usernames ------------------------------------------------------------------------ */

/** Names you changed away from that are still held for you. */
export function useReservedUsernames(userId: string | undefined) {
  return useQuery({
    queryKey: keys.reservedUsernames(userId ?? ''),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('reserved_usernames')
        .select('username, reserved_until')
        .eq('user_id', userId!)
        .gt('reserved_until', new Date().toISOString())
        .order('reserved_until', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: Boolean(userId),
    staleTime: fresh.mine,
  });
}

/** The 30-day limit between username changes, from the last change. */
export const USERNAME_COOLDOWN_DAYS = 30;

export function nextUsernameChange(changedAt: string | null): Date | null {
  if (!changedAt) return null;
  const next = new Date(new Date(changedAt).getTime() + USERNAME_COOLDOWN_DAYS * 24 * 60 * 60 * 1000);
  return next.getTime() > Date.now() ? next : null;
}

/* Saving --------------------------------------------------------------------------------- */

export type ProfileChanges = Partial<{
  username: string;
  bio: string | null;
  disciplines: Discipline[];
  home_metro_area_id: string;
  home_park_id: string | null;
  open_to_meetup: boolean;
  is_private: boolean;
  hide_from_regulars: boolean;
}>;

/** Why a save failed, in terms the screens can show. */
export type SaveError = 'usernameTaken' | 'usernameCooldown' | 'generic';

export class ProfileSaveError extends Error {
  constructor(public reason: SaveError) {
    super(reason);
  }
}

function toSaveError(error: { code?: string; message?: string }): ProfileSaveError {
  // 23505: someone has the name (or it's held for them) since the check ran.
  if (error.code === '23505') return new ProfileSaveError('usernameTaken');
  if (error.message === 'username_cooldown') return new ProfileSaveError('usernameCooldown');
  return new ProfileSaveError('generic');
}

/**
 * Saves Edit profile: uploads a new photo first (if picked), then every
 * changed field in one update, then removes the old photo. If the update
 * fails, the new photo is removed again.
 */
export function useSaveProfile(userId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({
      changes,
      newPhoto,
      oldPhotoPath,
    }: {
      changes: ProfileChanges;
      /** Local file from pickAvatar(). */
      newPhoto?: string | null;
      oldPhotoPath?: string | null;
    }) => {
      if (!userId) throw new ProfileSaveError('generic');
      let avatarPath: string | undefined;
      if (newPhoto) {
        avatarPath = await uploadAvatar(userId, newPhoto).catch(() => {
          throw new ProfileSaveError('generic');
        });
      }
      const update = { ...changes, ...(avatarPath ? { avatar_path: avatarPath } : {}) };
      if (Object.keys(update).length > 0) {
        const { error } = await supabase.from('profiles').update(update).eq('id', userId);
        if (error) {
          if (avatarPath) await removeAvatar(avatarPath).catch(() => undefined);
          throw toSaveError(error);
        }
      }
      if (avatarPath && oldPhotoPath) await removeAvatar(oldPhotoPath).catch(() => undefined);
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: keys.profiles() });
      if (userId) void client.invalidateQueries({ queryKey: keys.reservedUsernames(userId) });
    },
  });
}

type Setting = 'is_private' | 'hide_from_regulars' | 'badge_hidden';

/**
 * One Settings switch. Flips at once and flips back if the save fails.
 * The role badge switch applies to every active role the member has.
 */
export function useProfileSetting(userId: string | undefined) {
  const client = useQueryClient();
  const key = keys.myProfile(userId ?? '');

  return useMutation({
    mutationFn: async ({ setting, value }: { setting: Setting; value: boolean }) => {
      if (!userId) throw new Error('signed out');
      const { error } =
        setting === 'badge_hidden'
          ? await supabase
              .from('role_assignments')
              .update({ badge_hidden: value })
              .eq('user_id', userId)
              .not('accepted_at', 'is', null)
              .is('ended_at', null)
          : await supabase
              .from('profiles')
              .update(setting === 'is_private' ? { is_private: value } : { hide_from_regulars: value })
              .eq('id', userId);
      if (error) throw error;
    },
    onMutate: async ({ setting, value }) => {
      await client.cancelQueries({ queryKey: key });
      const previous = client.getQueryData<Profile | null>(key);
      client.setQueryData<Profile | null>(key, (p) => {
        if (!p) return p;
        if (setting === 'badge_hidden') return { ...p, roles: p.roles.map((r) => ({ ...r, hidden: value })) };
        return setting === 'is_private' ? { ...p, isPrivate: value } : { ...p, hideFromRegulars: value };
      });
      return { previous };
    },
    onError: (_error, _vars, context) => {
      client.setQueryData(key, context?.previous);
    },
    onSettled: () => client.invalidateQueries({ queryKey: keys.profiles() }),
  });
}
