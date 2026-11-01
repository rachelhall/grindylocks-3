import { Stack, useGlobalSearchParams } from 'expo-router';
import { useState } from 'react';

import { PostDraftProvider } from '@/lib/post-draft';
import { useColors } from '@/theme';

/**
 * New post (M4a): pick photos and clips → tag them → caption and post. The
 * draft is shared by the three screens and dropped when the flow closes.
 * Opened with `park` and `parkName` (from a park page's "Post a clip here"),
 * the park starts picked.
 */
export default function NewPostLayout() {
  const c = useColors();
  const params = useGlobalSearchParams<{ park?: string; parkName?: string }>();
  // Read once: the flow's own park choice wins after that.
  const [initialPark] = useState(() =>
    params.park && params.parkName ? { id: params.park, name: params.parkName } : null,
  );
  return (
    <PostDraftProvider initialPark={initialPark}>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.surface } }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="tag" />
        <Stack.Screen name="caption" />
      </Stack>
    </PostDraftProvider>
  );
}
