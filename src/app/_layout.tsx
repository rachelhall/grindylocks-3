import '@/i18n';

import { Archivo_400Regular, Archivo_600SemiBold } from '@expo-google-fonts/archivo';
import { ArchivoBlack_400Regular } from '@expo-google-fonts/archivo-black';
import { useFonts } from 'expo-font';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';

import { initSentry, Sentry } from '@/lib/sentry';
import { colors, useColorSchemeName } from '@/theme';

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

  useEffect(() => {
    if (fontsLoaded || fontError) SplashScreen.hideAsync();
  }, [fontsLoaded, fontError]);

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
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.surface } }} />
    </ThemeProvider>
  );
}

export default Sentry.wrap(RootLayout);
