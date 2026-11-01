import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useTranslation } from 'react-i18next';
import { Platform, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/ui';
import { brand, colors, fontFamily, space, Text } from '@/theme';

// Brand layer: this screen is always ink, in light and dark mode alike, like
// the invite screen on the Mockups canvas.
const ink = brand.ink;
const paper = brand.paper;
const muted = colors.dark.textSecondary;
const quietBorder = colors.light.textSecondary;

/**
 * First screen for anyone signed out. Existing members sign in here; new
 * people come through an invite link, or type their invite code.
 *
 * Apple and Google sign-in need native setup and a new build, so their
 * buttons are shown but switched off until then.
 */
const providersReady = { apple: false, google: false };

export default function Welcome() {
  const { t } = useTranslation();

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: ink }]}>
      <StatusBar style="light" />
      <Text variant="label" style={{ color: muted }}>
        {t('auth.welcome.kicker')}
      </Text>
      <Text
        accessibilityRole="header"
        accessibilityLabel={t('common.appName')}
        style={styles.wordmark}
      >
        {'Grindy\nlocks'}
      </Text>
      <Text variant="headline" style={{ color: paper }}>
        {t('auth.welcome.tagline')}
      </Text>

      <View style={styles.spacer} />

      <View style={styles.actions}>
        <Button
          label={t('auth.welcome.email')}
          onPress={() => router.push('/email')}
          palette={{ fill: paper, text: ink, border: paper }}
        />
        {Platform.OS === 'ios' ? (
          <Button
            label={t('auth.welcome.apple')}
            note={providersReady.apple ? undefined : t('auth.welcome.soon')}
            disabled={!providersReady.apple}
            palette={{ fill: 'transparent', text: paper, border: paper }}
          />
        ) : null}
        <Button
          label={t('auth.welcome.google')}
          note={providersReady.google ? undefined : t('auth.welcome.soon')}
          disabled={!providersReady.google}
          palette={{ fill: 'transparent', text: paper, border: quietBorder }}
        />
      </View>
      <Text variant="bodySm" style={[styles.footnote, { color: muted }]}>
        {t('auth.welcome.inviteOnly')}
      </Text>
      <Button
        variant="tertiary"
        label={t('auth.welcome.haveCode')}
        onPress={() => router.push('/invite')}
        palette={{ fill: 'transparent', text: paper, border: 'transparent' }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: space[6], paddingTop: space[12], paddingBottom: space[4] },
  wordmark: {
    marginTop: space[3],
    marginBottom: space[6],
    fontFamily: fontFamily.display,
    fontSize: 64,
    lineHeight: 62,
    letterSpacing: -1,
    textTransform: 'uppercase',
    color: brand.pink,
    // Overprinted blue offset, as on the invite mockup.
    textShadowColor: brand.blue,
    textShadowOffset: { width: 3, height: 3 },
    textShadowRadius: Platform.OS === 'android' ? 0.01 : 0,
  },
  spacer: { flex: 1 },
  actions: { gap: space[3] },
  footnote: { marginTop: space[4], textAlign: 'center' },
});
