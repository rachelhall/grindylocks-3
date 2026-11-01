import { Stack } from 'expo-router';

import { useColors } from '@/theme';

/** The map tab: the map itself and city search, both above the tab bar. */
export default function MapLayout() {
  const c = useColors();
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.surface } }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="search" options={{ animation: 'fade' }} />
    </Stack>
  );
}
