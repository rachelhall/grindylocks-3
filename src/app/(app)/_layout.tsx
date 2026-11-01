import { Stack } from 'expo-router';
import { useEffect } from 'react';

import { useAuth } from '@/lib/auth';
import { uploads } from '@/lib/uploads';
import { useColors } from '@/theme';

/**
 * The signed-in, onboarded app: the tabs, plus screens that open over them
 * (new post, a post, a park). Starts the upload queue for this member, so
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
      <Stack.Screen name="post/[id]" />
      <Stack.Screen name="park/[slug]" />
    </Stack>
  );
}
