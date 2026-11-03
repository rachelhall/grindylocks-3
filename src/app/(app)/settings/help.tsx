import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { SafeAreaView } from '@/components/safe-area';
import { openSupportMail, SettingsRow, SettingsSection } from '@/components/settings';
import { BackButton, Button, Icon } from '@/components/ui';
import { appConfig } from '@/lib/config';
import { fontFamily, space, stroke, Text, useColors } from '@/theme';

const TOPICS = ['reporting', 'parkFix', 'blocking', 'whereISkate'] as const;
type Topic = (typeof TOPICS)[number];

/**
 * Help and contact (Help mockup, M5): the support email, short answers to
 * how reporting, park fixes, blocking and regulars lists work, and your
 * data (a copy of it, the privacy policy).
 */
export default function Help() {
  const { t } = useTranslation();
  const c = useColors();
  const [open, setOpen] = useState<Topic | null>('reporting');

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.screen, { backgroundColor: c.surface }]}>
      <View style={styles.header}>
        <BackButton />
        <Text variant="display" accessibilityRole="header" style={styles.title}>
          {t('help.title')}
        </Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.contact}>
          <Text variant="body">{t('help.intro')}</Text>
          <Button
            icon="mail"
            label={t('help.email', { email: appConfig.supportEmail })}
            palette={{ fill: c.accent, text: c.onAccent, border: c.accent }}
            onPress={() => void openSupportMail()}
          />
          <Text variant="bodySm" color="textSecondary">
            {t('help.emailBody')}
          </Text>
        </View>

        <SettingsSection title={t('help.howItWorks')}>
          {TOPICS.map((topic, i) => {
            const expanded = open === topic;
            return (
              <View
                key={topic}
                style={[
                  styles.topic,
                  { backgroundColor: c.surfaceRaised, borderColor: c.borderSubtle, borderTopWidth: i === 0 ? stroke.hairline : 0 },
                ]}
              >
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ expanded }}
                  onPress={() => setOpen(expanded ? null : topic)}
                  style={({ pressed }) => [styles.topicHead, pressed && styles.pressed]}
                >
                  <Text variant="body" style={styles.topicTitle}>
                    {t(`help.topics.${topic}.title`)}
                  </Text>
                  <Icon name={expanded ? 'chevronUp' : 'chevronDown'} color={c.textSecondary} size={20} />
                </Pressable>
                {expanded ? (
                  <Text variant="bodySm" color="textSecondary" style={styles.answer}>
                    {t(`help.topics.${topic}.body`)}
                  </Text>
                ) : null}
              </View>
            );
          })}
        </SettingsSection>

        <SettingsSection title={t('help.yourData')}>
          <SettingsRow
            first
            title={t('settings.dataCopy')}
            subtitle={t('settings.dataCopyBody')}
            trailing="chevron"
            onPress={() => router.push('/settings/data')}
          />
          <SettingsRow
            title={t('settings.privacyPolicy')}
            trailing="external"
            onPress={() => void WebBrowser.openBrowserAsync(appConfig.privacyPolicyUrl)}
          />
        </SettingsSection>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: space[2], paddingHorizontal: space[3], paddingTop: space[3] },
  title: { fontSize: 28, lineHeight: 30 },
  content: { paddingBottom: space[12] },
  contact: { paddingHorizontal: 20, paddingTop: space[4], gap: 10 },
  topic: { paddingHorizontal: 20, borderBottomWidth: stroke.hairline },
  topicHead: { minHeight: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[3] },
  topicTitle: { flex: 1, fontFamily: fontFamily.sansSemiBold, fontSize: 15 },
  answer: { paddingBottom: space[3] },
  pressed: { opacity: 0.75 },
});
