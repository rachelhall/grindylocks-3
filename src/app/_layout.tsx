import '@/i18n';

import { Archivo_400Regular, Archivo_600SemiBold } from '@expo-google-fonts/archivo';
import { ArchivoBlack_400Regular } from '@expo-google-fonts/archivo-black';
import { useFonts } from 'expo-font';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui';
import { AuthProvider, useAuth } from '@/lib/auth';
import { initSentry, Sentry } from '@/lib/sentry';
import { colors, space, Text, useColorSchemeName } from '@/theme';

initSentry();
SplashScreen.preventAutoHideAsync();

function RootLayout() {
  const scheme = useColorSchemeName();
  const c = colors[scheme];
  const [fontsLoaded, fontError] = useFonts({
    ArchivoBlack_400Regular,
    Archivo_400Regular,
    Archivo_600SemiBold,
  });

  if (!fontsLoaded && !fontError) return null;

  const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
  const navTheme = {
    ...base,
    colors: {
      ...base.colors,
      primary: c.accent,
      background: c.surface,
      card: c.surface,
      text: c.text,
      border: c.border,
    },
  };

  return (
    <ThemeProvider value={navTheme}>
      <AuthProvider>
        <RootNavigator />
      </AuthProvider>
    </ThemeProvider>
  );
}

/**
 * Three route groups, one open at a time:
 * - (auth): signed out — welcome and email sign-in
 * - (onboarding): signed in, profile not finished
 * - (app): signed in and onboarded
 * When the session or profile changes, Expo Router moves to the first
 * screen that's open.
 */
function RootNavigator() {
  const scheme = useColorSchemeName();
  const c = colors[scheme];
  const { ready, session, onboarded, profileError } = useAuth();
  const signedIn = Boolean(session);

  useEffect(() => {
    if (ready) SplashScreen.hideAsync();
  }, [ready]);

  if (!ready) return null;
  if (signedIn && profileError) return <ProfileError />;

  return (
    <>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.surface } }}>
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="(auth)" />
        </Stack.Protected>
        <Stack.Protected guard={signedIn && !onboarded}>
          <Stack.Screen name="(onboarding)" />
        </Stack.Protected>
        <Stack.Protected guard={signedIn && onboarded}>
          <Stack.Screen name="(app)" />
        </Stack.Protected>
      </Stack>
    </>
  );
}

/** Signed in, but the profile couldn't load (usually no connection). */
function ProfileError() {
  const { t } = useTranslation();
  const scheme = useColorSchemeName();
  const c = colors[scheme];
  const { refreshProfile, signOut } = useAuth();
  return (
    <View style={[styles.error, { backgroundColor: c.surface }]}>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Text variant="title">{t('errors.generic')}</Text>
      <Text variant="body" color="textSecondary">
        {t('errors.network')}
      </Text>
      <Button label={t('common.retry')} onPress={refreshProfile} />
      <Button label={t('common.signOut')} variant="tertiary" onPress={signOut} />
    </View>
  );
}

const styles = StyleSheet.create({
  error: { flex: 1, justifyContent: 'center', padding: space[6], gap: space[4] },
});

export default Sentry.wrap(RootLayout);
