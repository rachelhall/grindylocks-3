import { Stack } from 'expo-router';

import { useAuth } from '@/lib/auth';
import { OnboardingProvider } from '@/lib/onboarding';
import { useColors } from '@/theme';

/**
 * Onboarding: age check → username and disciplines → home city (and
 * optional park) → regulars notice, then (an owner joining through a page
 * invite, with no logo yet) the page's logo. Each step saves to the profile as it
 * goes, so a member who closes the app picks up at the first unfinished step.
 */
export default function OnboardingLayout() {
  const c = useColors();
  const { onboardingStep } = useAuth();
  return (
    <OnboardingProvider>
      <Stack
        initialRouteName={onboardingStep}
        screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.surface } }}
      >
        <Stack.Screen name="age" />
        <Stack.Screen name="username" />
        <Stack.Screen name="city" />
        <Stack.Screen name="regulars" />
        <Stack.Screen name="logo" />
      </Stack>
    </OnboardingProvider>
  );
}
