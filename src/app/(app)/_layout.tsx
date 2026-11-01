import { Stack } from 'expo-router';
import { useEffect } from 'react';

import { useAuth } from '@/lib/auth';
import { uploads } from '@/lib/uploads';
import { brand, useColors } from '@/theme';

/**
 * The signed-in, onboarded app: the tabs, plus screens that open over them
 * (new post, notifications, a post, a park and its photos, a profile, edit
 * profile, settings and invites). Starts the upload queue for this member, so
 * posts left uploading last time carry on as soon as the app opens.
 */
export default function AppLayout() {
  const c = useColors();
  const { session } = useAuth();
  const userId = session?.user.id ?? null;

  useEffect(() => {
    if (!userId) return;
    void uploads.start(userId);
    return () => uploads.stop();
  }, [userId]);

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.surface } }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="new-post" options={{ presentation: 'fullScreenModal' }} />
      <Stack.Screen name="notifications" />
      <Stack.Screen name="post/[id]/index" />
      <Stack.Screen name="post/[id]/edit" options={{ presentation: 'fullScreenModal' }} />
      <Stack.Screen name="park/[slug]/index" />
      <Stack.Screen name="park/[slug]/obstacle/[id]" />
      <Stack.Screen
        name="park/[slug]/photos"
        options={{ presentation: 'fullScreenModal', animation: 'fade', contentStyle: { backgroundColor: brand.ink } }}
      />
      <Stack.Screen name="profile/[username]" />
      <Stack.Screen name="edit-profile" options={{ presentation: 'fullScreenModal' }} />
      <Stack.Screen name="say-hi" options={{ presentation: 'fullScreenModal', gestureEnabled: false }} />
      <Stack.Screen name="settings/index" />
      <Stack.Screen name="settings/email" />
      <Stack.Screen name="settings/credits" />
      <Stack.Screen name="settings/blocked" />
      <Stack.Screen name="invites" />
    </Stack>
  );
}
