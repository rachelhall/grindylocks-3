import Constants from 'expo-constants';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useTranslation } from 'react-i18next';
import { Alert, Linking, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from '@/components/safe-area';

import { useRoleLabel } from '@/components/profile';
import { SettingsRow, SettingsSection } from '@/components/settings';
import { BackButton, Button, Toggle } from '@/components/ui';
import { usesMetric } from '@/i18n';
import { useAuth } from '@/lib/auth';
import { appConfig } from '@/lib/config';
import { useMyProfile, useProfileSetting } from '@/lib/profiles';
import { space, Text, useColors } from '@/theme';

/** Opens the mail app; if there isn't one, shows the address instead. */
async function openMail(subject?: string) {
  const url = `mailto:${appConfig.supportEmail}${subject ? `?subject=${encodeURIComponent(subject)}` : ''}`;
  try {
    await Linking.openURL(url);
  } catch {
    Alert.alert(appConfig.supportEmail);
  }
}

/**
 * Settings. Rows arrive with their features: blocked accounts came with
 * blocking; push notifications come with notifications (M4) and delete
 * account with M5, never as disabled placeholders.
 */
export default function Settings() {
  const { t } = useTranslation();
  const c = useColors();
  const { session, profile: authProfile, signOut } = useAuth();
  const userId = session?.user.id;
  const { data: profile } = useMyProfile(userId);
  const setting = useProfileSetting(userId);
  const roleLabel = useRoleLabel();

  const role = profile?.roles[0] ?? null;
  const pendingEmail = session?.user.new_email;
  const version = Constants.expoConfig?.version ?? '';

  const flip = (name: 'is_private' | 'hide_from_regulars' | 'badge_hidden', value: boolean) =>
    setting.mutate(
      { setting: name, value },
      { onError: () => Alert.alert(t('errors.generic'), t('errors.network')) },
    );

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.screen, { backgroundColor: c.surface }]}>
      <View style={styles.header}>
        <BackButton />
        <Text variant="display" accessibilityRole="header" style={styles.title}>
          {t('settings.title')}
        </Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <SettingsSection title={t('settings.account')}>
          <SettingsRow
            first
            title={t('settings.email')}
            subtitle={
              pendingEmail ? t('settings.emailPending', { email: session?.user.email ?? '', next: pendingEmail }) : session?.user.email
            }
            value={t('settings.change')}
            trailing="chevron"
            onPress={() => router.push('/settings/email')}
          />
          <SettingsRow
            title={t('settings.appleGoogle')}
            subtitle={t('settings.appleGoogleBody')}
            value={t('auth.welcome.soon')}
          />
        </SettingsSection>

        <SettingsSection title={t('settings.privacy')}>
          <SettingsRow
            first
            title={t('settings.private')}
            subtitle={t('settings.privateBody')}
            control={
              <Toggle
                value={profile?.isPrivate ?? false}
                onChange={(v) => flip('is_private', v)}
                label={t('settings.private')}
                fg={c.text}
              />
            }
          />
          <SettingsRow
            title={t('settings.regulars')}
            subtitle={t('settings.regularsBody')}
            control={
              <Toggle
                value={!(profile?.hideFromRegulars ?? false)}
                onChange={(v) => flip('hide_from_regulars', !v)}
                label={t('settings.regulars')}
                fg={c.text}
              />
            }
          />
          {role ? (
            <SettingsRow
              title={t('settings.roleBadge')}
              subtitle={roleLabel(role)}
              control={
                <Toggle
                  value={!role.hidden}
                  onChange={(v) => flip('badge_hidden', !v)}
                  label={t('settings.roleBadge')}
                  fg={c.text}
                />
              }
            />
          ) : null}
          <SettingsRow
            title={t('block.listTitle')}
            trailing="chevron"
            onPress={() => router.push('/settings/blocked')}
          />
        </SettingsSection>

        <SettingsSection title={t('settings.app')}>
          <SettingsRow
            first
            title={t('settings.language')}
            subtitle={t('settings.languageBody')}
            value={t('settings.languageName')}
            trailing="external"
            onPress={() => void Linking.openSettings()}
          />
          <SettingsRow
            title={t('settings.distances')}
            subtitle={t('settings.distancesBody')}
            value={usesMetric() ? t('settings.kilometers') : t('settings.miles')}
          />
        </SettingsSection>

        <SettingsSection title={t('settings.help')}>
          <SettingsRow first title={t('settings.contact')} trailing="external" onPress={() => void openMail()} />
          <SettingsRow
            title={t('settings.privacyPolicy')}
            trailing="external"
            onPress={() => void WebBrowser.openBrowserAsync(appConfig.privacyPolicyUrl)}
          />
          <SettingsRow
            title={t('settings.dataCopy')}
            subtitle={t('settings.dataCopyBody')}
            trailing="external"
            onPress={() =>
              void openMail(t('settings.dataCopySubject', { username: authProfile?.username ?? '' }))
            }
          />
          <SettingsRow
            title={t('settings.credits')}
            subtitle={t('credits.osm')}
            trailing="chevron"
            onPress={() => router.push('/settings/credits')}
          />
        </SettingsSection>

        <View style={styles.footer}>
          <Button label={t('common.signOut')} variant="secondary" onPress={signOut} />
          <Text variant="caption" color="textSecondary" style={styles.version}>
            {t('settings.version', { version })}
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: space[2], paddingHorizontal: space[3], paddingTop: space[3] },
  title: { fontSize: 28, lineHeight: 30 },
  content: { paddingBottom: space[12] },
  footer: { paddingHorizontal: 20, paddingTop: space[8], gap: space[3] },
  version: { textAlign: 'center' },
});
