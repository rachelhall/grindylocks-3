/**
 * Server data cache (TanStack Query).
 *
 * Every read from Supabase goes through a query hook with a key from `keys`
 * below, so screens share one cache: a park loaded for the map card is the
 * same entry the park page reads, and going back to a park shows it at once.
 * Writes go through mutations, which update or invalidate the keys they touch.
 *
 * React Native has no window focus, so the cache is told about the app coming
 * back to the foreground (AppState) and the connection coming back
 * (expo-network). Stale queries refetch then.
 */
import { focusManager, onlineManager, QueryClient } from '@tanstack/react-query';
import * as Network from 'expo-network';
import { AppState, Platform } from 'react-native';

import { supabase } from './supabase';

const MINUTE = 60_000;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Most data here is slow-moving; screens that need fresher data set
      // their own staleTime (see `fresh` below).
      staleTime: 5 * MINUTE,
      gcTime: 30 * MINUTE,
      retry: 2,
    },
  },
});

/** How long each kind of data can be shown before it's checked again. */
export const fresh = {
  /**
   * Parks, obstacles, hours, metro areas and park photos: edited rarely, by a
   * few people. Park photo URLs are signed for an hour, well past this.
   */
  parks: 10 * MINUTE,
  /** Search results for the same text. */
  search: 5 * MINUTE,
  /** Your own saved parks, posts and other things you change yourself. */
  mine: 0,
  /**
   * Posts carry signed photo URLs that expire after an hour, so a cached
   * post must never outlive them: refetched after 5 minutes, dropped after 30.
   */
  posts: 5 * MINUTE,
  /** Comments under a post, and the bell's dot: checked again after 30 s. */
  social: 30_000,
  /** Profile photo URLs are signed for an hour too; re-signed after 50 minutes. */
  avatars: 50 * MINUTE,
} as const;

/** Query keys, in one place so invalidation can't miss a spelling. */
export const keys = {
  park: (slug: string) => ['park', slug] as const,
  /** A park's gallery. Shared by everyone, so no user ID. */
  parkPhotos: (parkId: string) => ['park-photos', parkId] as const,
  /** Your role at a park (badge, Add photos button). */
  parkRole: (userId: string, parkId: string) => ['park-role', userId, parkId] as const,
  parksInBounds: (b: { north: number; south: number; east: number; west: number }) =>
    // Rounded to about 100 m so small pans reuse the same entry.
    ['parks', 'bounds', ...[b.north, b.south, b.east, b.west].map((n) => Math.round(n * 1000) / 1000)] as const,
  parksNear: (lat: number, lng: number, max: number) =>
    ['parks', 'near', Math.round(lat * 1000) / 1000, Math.round(lng * 1000) / 1000, max] as const,
  parksInMetro: (metroId: string) => ['parks', 'metro', metroId] as const,
  metro: (id: string) => ['metro', id] as const,
  directory: () => ['directory'] as const,
  /** Metro area names for the signed-out welcome screen's city tape. */
  welcomeMetros: () => ['welcome-metros'] as const,
  search: (q: string) => ['search', q] as const,
  savedParks: (userId: string) => ['saved-parks', userId] as const,
  myPosts: (userId: string) => ['posts', 'mine', userId] as const,
  post: (id: string) => ['post', id] as const,
  parkName: (id: string) => ['park-name', id] as const,
  parksByIds: (ids: string[]) => ['parks', 'ids', ...[...ids].sort()] as const,
  /** Every profile query starts with 'profile', so one invalidation covers them all. */
  profiles: () => ['profile'] as const,
  /** Someone's profile, looked up by username (any capitals). */
  profile: (username: string) => ['profile', 'username', username.toLowerCase()] as const,
  /** The signed-in member's own profile, with their private settings. */
  myProfile: (userId: string) => ['profile', 'me', userId] as const,
  /** A member's posts for the profile grid. */
  profilePosts: (userId: string) => ['posts', 'by', userId] as const,
  /** Usernames you changed away from in the last 14 days. */
  reservedUsernames: (userId: string) => ['reserved-usernames', userId] as const,
  /** A signed URL for a profile photo. */
  avatar: (path: string) => ['avatar', path] as const,
  /** Your invite links and how many you have left. */
  myInvites: (userId: string) => ['invites', userId] as const,
  /** People waiting for you to accept their follow request. */
  followRequests: (userId: string) => ['follow-requests', userId] as const,
  /** The people you follow (accepted), for the person picker and @mention suggestions. */
  following: (userId: string) => ['following', userId] as const,
  /** The people you blocked (Settings › Blocked accounts). */
  blocked: (userId: string) => ['blocked', userId] as const,
  /** A post's comments, oldest first. */
  comments: (postId: string) => ['comments', postId] as const,
  /** The Notifications list (M4b). */
  notifications: (userId: string) => ['notifications', userId] as const,
  /** First-slide thumbnails for notification rows. Starts with 'posts' so post invalidations cover it. */
  postCovers: (postIds: string[]) => ['posts', 'covers', ...postIds] as const,
  /** Whether the bell shows its dot. */
  notificationsUnread: (userId: string) => ['notifications-unread', userId] as const,
  /** Your push notification switches (Settings › Push notifications). */
  pushSettings: (userId: string) => ['push-settings', userId] as const,
  /** Whether the phone lets Grindylocks notify. Per phone, not per member. */
  pushPermission: () => ['push-permission'] as const,
  /** Home feed, people you follow. Every feed key starts with 'feed'. */
  feedFollowing: (userId: string) => ['feed', 'following', userId] as const,
  /** Home feed, near you (a metro area, minus people you follow). */
  feedNearby: (userId: string, metroId: string) => ['feed', 'nearby', userId, metroId] as const,
  /** A park's posts. Post lists start with 'posts', so one invalidation covers them. */
  parkPosts: (parkId: string) => ['posts', 'park', parkId] as const,
  obstaclePosts: (obstacleId: string) => ['posts', 'obstacle', obstacleId] as const,
  taggedPosts: (userId: string) => ['posts', 'tagged', userId] as const,
  filmedPosts: (userId: string) => ['posts', 'filmed', userId] as const,
  /** A park's regulars list. */
  parkRegulars: (parkId: string) => ['regulars', parkId] as const,
  /** Obstacles you can tag at a park (includes your own pending suggestions). */
  taggableObstacles: (parkId: string, userId: string) => ['obstacles', 'taggable', parkId, userId] as const,
  /** One obstacle, for its feed page. */
  obstacle: (id: string) => ['obstacle', id] as const,
};

let started = false;

/** Hooks the cache up to app state, connectivity and sign-out. Call once. */
export function startQueryClient() {
  if (started) return;
  started = true;

  if (Platform.OS !== 'web') {
    AppState.addEventListener('change', (state) => focusManager.setFocused(state === 'active'));

    onlineManager.setEventListener((setOnline) => {
      const sub = Network.addNetworkStateListener((state) => setOnline(Boolean(state.isConnected)));
      return () => sub.remove();
    });
  }

  // Nothing cached for one member is ever shown to the next one on this phone.
  supabase.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') queryClient.clear();
  });
}
