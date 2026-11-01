import { Stack } from 'expo-router';

import { useColors } from '@/theme';

export const unstable_settings = { initialRouteName: 'welcome' };

export default function AuthLayout() {
  const c = useColors();
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.surface } }}>
      <Stack.Screen name="welcome" />
      <Stack.Screen name="email" />
      <Stack.Screen name="code" />
    </Stack>
  );
}
