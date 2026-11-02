/**
 * Push notifications (M4b part 2).
 *
 * The server decides what's pushed (see supabase/migrations/…_push.sql and
 * the push-send Edge Function); this file only:
 * - asks for permission once, on the first Home visit after onboarding,
 * - registers this phone's Expo push token, with the app's language, each
 *   time the app opens signed in (tokens and languages can change),
 * - forgets the phone on sign-out,
 * - reads and flips the per-type switches in Settings › Push notifications,
 * - opens the right screen when a push is tapped, and
 * - refreshes the bell when a push arrives while the app is open.
 *
 * Pushes never set the app icon's badge: no counts anywhere.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { Platform } from 'react-native';

import i18n from '@/i18n';

import { fresh, keys, queryClient } from './query';
import { Sentry } from './sentry';
import { supabase } from './supabase';

const TOKEN_KEY = 'push.token';
const ASKED_KEY = 'push.asked';

/* Showing pushes ------------------------------------------------------------- */

let configured = false;

/** How pushes behave while the app is open. Call once at startup. */
export function configurePush() {
  if (configured || Platform.OS === 'web') return;
  configured = true;

  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });

  // Something new arrived: the bell's dot and list should know at once.
  Notifications.addNotificationReceivedListener(() => {
    void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    void queryClient.invalidateQueries({ queryKey: ['notifications-unread'] });
  });

  if (Platform.OS === 'android') {
    // Android 8+ needs a channel, and Android 13+ only shows the permission
    // prompt once one exists.
    void Notifications.setNotificationChannelAsync('default', {
      name: i18n.t('push.channel'),
      importance: Notifications.AndroidImportance.HIGH,
    });
  }
}

/* Permission ------------------------------------------------------------------ */

export type PushPermission = 'granted' | 'denied' | 'undetermined';

async function readPermission(): Promise<PushPermission> {
  const status = await Notifications.getPermissionsAsync();
  if (status.granted) return 'granted';
  const ios = status.ios?.status;
  if (ios === Notifications.IosAuthorizationStatus.PROVISIONAL || ios === Notifications.IosAuthorizationStatus.EPHEMERAL) {
    return 'granted';
  }
  return status.canAskAgain ? 'undetermined' : 'denied';
}

/** Whether the phone lets Grindylocks notify, checked each time it's shown. */
export function usePushPermission() {
  return useQuery({
    queryKey: keys.pushPermission(),
    queryFn: readPermission,
    staleTime: fresh.mine,
    enabled: Platform.OS !== 'web',
  });
}

/* This phone ---------------------------------------------------------------------- */

async function expoToken(): Promise<string | null> {
  const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
  try {
    const { data } = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    return data;
  } catch (error) {
    // Offline, or a simulator that can't receive pushes. Tried again next launch.
    if (__DEV__) console.warn('No push token', error);
    return null;
  }
}

/**
 * Registers this phone for the signed-in member, if notifications are
 * allowed. Safe to call on every launch.
 */
export async function registerThisPhone(): Promise<void> {
  if (Platform.OS === 'web') return;
  if ((await readPermission()) !== 'granted') return;
  const token = await expoToken();
  if (!token) return;
  const { error } = await supabase.rpc('register_push_device', {
    token,
    platform: Platform.OS === 'ios' ? 'ios' : 'android',
    language: i18n.language,
  });
  if (error) {
    Sentry.captureException(error, { tags: { where: 'register_push_device' } });
    return;
  }
  await AsyncStorage.setItem(TOKEN_KEY, token).catch(() => undefined);
}

/** Forgets this phone, so the next person to sign in here gets their own pushes. */
export async function forgetThisPhone(): Promise<void> {
  const token = await AsyncStorage.getItem(TOKEN_KEY).catch(() => null);
  if (!token) return;
  const { error } = await supabase.rpc('unregister_push_device', { token });
  if (error) Sentry.captureException(error, { tags: { where: 'unregister_push_device' } });
  await AsyncStorage.removeItem(TOKEN_KEY).catch(() => undefined);
}

/**
 * Asks for permission the first time Home opens after onboarding, then
 * registers the phone. Never asks twice: after that, Settings › Push
 * notifications points to the phone's settings.
 */
export function useAskForPushOnce(enabled: boolean) {
  const client = useQueryClient();
  useEffect(() => {
    if (!enabled || Platform.OS === 'web') return;
    let cancelled = false;
    void (async () => {
      const asked = await AsyncStorage.getItem(ASKED_KEY).catch(() => null);
      if (asked || cancelled) return;
      if ((await readPermission()) === 'undetermined') {
        await Notifications.requestPermissionsAsync();
      }
      await AsyncStorage.setItem(ASKED_KEY, '1').catch(() => undefined);
      await registerThisPhone();
      void client.invalidateQueries({ queryKey: keys.pushPermission() });
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, client]);
}

/** Asks again from Settings when the phone still allows a prompt. */
export async function requestPushPermission(): Promise<PushPermission> {
  await Notifications.requestPermissionsAsync();
  await AsyncStorage.setItem(ASKED_KEY, '1').catch(() => undefined);
  await registerThisPhone();
  const now = await readPermission();
  queryClient.setQueryData(keys.pushPermission(), now);
  return now;
}

/* Tapping a push -------------------------------------------------------------- */

function open(data: Record<string, unknown> | undefined) {
  if (!data) return;
  const str = (k: string) => (typeof data[k] === 'string' ? (data[k] as string) : undefined);
  switch (str('open')) {
    case 'post': {
      const id = str('id');
      if (id) router.push({ pathname: '/post/[id]', params: str('comments') ? { id, comments: '1' } : { id } });
      return;
    }
    case 'profile': {
      const username = str('username');
      if (username) router.push({ pathname: '/profile/[username]', params: { username } });
      return;
    }
    case 'notifications':
      router.push('/notifications');
      return;
  }
}

/**
 * Opens the screen a tapped push points to, including the push that
 * launched the app. Mount once inside the signed-in app.
 */
export function usePushTaps() {
  const last = Notifications.useLastNotificationResponse();

  useEffect(() => {
    if (!last || last.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
    open(last.notification.request.content.data);
    void Notifications.clearLastNotificationResponseAsync();
  }, [last]);
}

/* Switches ------------------------------------------------------------------------- */

export type PushSetting = 'comments' | 'mentions' | 'tags' | 'filmer_credits' | 'invites' | 'someone_new' | 'park_fixes';
export type PushSettings = Record<PushSetting, boolean>;

const ALL_ON: PushSettings = {
  comments: true,
  mentions: true,
  tags: true,
  filmer_credits: true,
  invites: true,
  someone_new: true,
  park_fixes: true,
};

async function fetchPushSettings(): Promise<PushSettings> {
  const { data, error } = await supabase.rpc('my_push_settings');
  if (error) throw error;
  return data?.[0] ?? ALL_ON;
}

export function usePushSettings(userId: string | undefined) {
  return useQuery({
    queryKey: keys.pushSettings(userId ?? ''),
    queryFn: fetchPushSettings,
    enabled: Boolean(userId),
    staleTime: fresh.mine,
  });
}

/** Flips one switch at once, and puts it back if saving fails. */
export function useSetPushSetting(userId: string | undefined) {
  const client = useQueryClient();
  const key = keys.pushSettings(userId ?? '');
  return useMutation({
    mutationFn: async ({ setting, enabled }: { setting: PushSetting; enabled: boolean }) => {
      const { error } = await supabase.rpc('set_push_setting', { setting, enabled });
      if (error) throw error;
    },
    onMutate: async ({ setting, enabled }) => {
      await client.cancelQueries({ queryKey: key });
      const previous = client.getQueryData<PushSettings>(key);
      client.setQueryData<PushSettings>(key, (s) => ({ ...(s ?? ALL_ON), [setting]: enabled }));
      return { previous };
    },
    onError: (_error, _vars, context) => client.setQueryData(key, context?.previous),
    onSettled: () => client.invalidateQueries({ queryKey: key }),
  });
}
