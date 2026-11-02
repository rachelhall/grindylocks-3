import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useTranslation } from 'react-i18next';
import { Platform, StyleSheet, View } from 'react-native';
import { SafeAreaView } from '@/components/safe-area';

import { CityTape, Wordmark } from '@/components/brand';
import { HalftoneGround } from '@/components/park-header';
import { Button } from '@/components/ui';
import { brand, colors, space, Text } from '@/theme';

// Brand layer: this screen is always ink, in light and dark mode alike.
const ink = brand.ink;
const paper = brand.paper;
const muted = colors.dark.textSecondary;
const quietBorder = colors.light.textSecondary;

/**
 * First screen for anyone signed out, per "C2 · City tape from the park
 * directory" on the Mockups canvas: the wordmark on one line, the metro
 * areas that have parks as tape, then sign-in. Existing members sign in
 * here; new people come through an invite link, or type their invite code.
 *
 * Apple and Google sign-in need native setup and a new build, so their
 * buttons are shown but switched off until then.
 */
const providersReady = { apple: false, google: false };

export default function Welcome() {
  const { t } = useTranslation();
  const showApple = Platform.OS === 'ios';

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: ink }]}>
      <StatusBar style="light" />
      <HalftoneGround fromTopRight fadeStart={0.55} fadeEnd={1} />

      <View style={styles.top}>
        <Text variant="label" style={{ color: muted }}>
          {t('auth.welcome.kicker')}
        </Text>
        <Wordmark />
        <Text variant="headline" style={{ color: paper }}>
          {t('auth.welcome.tagline')}
        </Text>
      </View>

      <View style={styles.middle}>
        <CityTape />
      </View>

      <View style={styles.actions}>
        <Button
          label={t('auth.welcome.email')}
          onPress={() => router.push('/email')}
          palette={{ fill: paper, text: ink, border: paper }}
        />
        <View style={styles.providers}>
          {showApple ? (
            <Button
              label={t('auth.welcome.appleShort')}
              note={providersReady.apple ? undefined : t('auth.welcome.soon')}
              disabled={!providersReady.apple}
              palette={{ fill: ink, text: paper, border: quietBorder }}
              style={styles.provider}
            />
          ) : null}
          <Button
            label={t(showApple ? 'auth.welcome.googleShort' : 'auth.welcome.google')}
            note={providersReady.google ? undefined : t('auth.welcome.soon')}
            disabled={!providersReady.google}
            palette={{ fill: ink, text: paper, border: quietBorder }}
            style={styles.provider}
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
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: space[4], paddingTop: space[8], paddingBottom: space[2] },
  top: { gap: space[3] },
  middle: { flex: 1, justifyContent: 'center', paddingVertical: space[4] },
  actions: { gap: space[3] },
  providers: { flexDirection: 'row', gap: space[3] },
  provider: { flex: 1 },
  footnote: { marginTop: space[1], textAlign: 'center' },
});
