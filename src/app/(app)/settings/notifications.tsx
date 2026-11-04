import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, Linking, ScrollView, StyleSheet, View } from 'react-native';

import { SafeAreaView } from '@/components/safe-area';
import { SettingsRow } from '@/components/settings';
import { BackButton, Button, Icon, Toggle } from '@/components/ui';
import { PageTile } from '@/components/pages';
import { useAuth } from '@/lib/auth';
import { useMyPages, useSetPageInboxPush } from '@/lib/claims';
import { isArchive } from '@/lib/pages';
import { useMyProfile } from '@/lib/profiles';
import {
  type PushSetting,
  requestPushPermission,
  usePushPermission,
  usePushSettings,
  useSetPushSetting,
} from '@/lib/push';
import { space, stroke, Text, useColors } from '@/theme';

/**
 * Settings › Push notifications: one switch per type, all on by default.
 * The bell lists everything either way; these only decide what reaches the
 * phone.
 *
 * Grouped You / Pages / Inboxes of pages you manage (Settings-Push-Pages,
 * PR 5). "Park fixes" became "Fixes and suggestions", covering suggested
 * brands and products going live too. Pages has Teams and claims and Pages
 * you follow joining. Inboxes has a switch per page you're on, off by
 * default and only for you.
 */
export default function PushNotificationSettings() {
  const { t } = useTranslation();
  const c = useColors();
  const { session } = useAuth();
  const userId = session?.user.id;
  const { data: profile } = useMyProfile(userId);
  const permission = usePushPermission();
  const settings = usePushSettings(userId);
  const setSetting = useSetPushSetting(userId);
  const myPages = useMyPages(userId);
  const setInbox = useSetPageInboxPush(userId);
  const inboxes = (myPages.data ?? []).filter((p) => p.state === 'managed' || !isArchive(p));

  const metro = profile?.homeMetro?.name;
  const rows: { key: PushSetting; title: string; body: string }[] = [
    { key: 'comments', title: t('push.comments'), body: t('push.commentsBody') },
    { key: 'mentions', title: t('push.mentions'), body: t('push.mentionsBody') },
    { key: 'tags', title: t('push.tags'), body: t('push.tagsBody') },
    { key: 'filmer_credits', title: t('push.filmer'), body: t('push.filmerBody') },
    // Changes, cancellations and the 1-hour reminder for meetups you're going to (PR 5).
    { key: 'meetups', title: t('push.meetups'), body: t('push.meetupsBody') },
    { key: 'invites', title: t('push.invites'), body: t('push.invitesBody') },
    { key: 'park_fixes', title: t('push.fixes'), body: t('push.fixesBody') },
    {
      key: 'someone_new',
      title: t('push.someoneNew'),
      body: metro ? t('push.someoneNewBody', { metro }) : t('push.someoneNewBodyNoCity'),
    },
  ];
  const pageRows: { key: PushSetting; title: string; body: string }[] = [
    { key: 'teams_claims', title: t('push.teamsClaims'), body: t('push.teamsClaimsBody') },
    { key: 'pages_joining', title: t('push.pagesJoining'), body: t('push.pagesJoiningBody') },
  ];

  const flip = (setting: PushSetting, enabled: boolean) =>
    setSetting.mutate({ setting, enabled }, { onError: () => Alert.alert(t('errors.generic'), t('errors.network')) });

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.screen, { backgroundColor: c.surface }]}>
      <View style={styles.header}>
        <BackButton />
        <Text variant="display" accessibilityRole="header" style={styles.title}>
          {t('push.title')}
        </Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text variant="bodySm" color="textSecondary" style={styles.intro}>
          {t('push.intro')}
        </Text>

        {permission.data === 'denied' ? (
          <View style={[styles.notice, { borderColor: c.border, backgroundColor: c.surfaceRaised }]}>
            <Text variant="headline">{t('push.offTitle')}</Text>
            <Text variant="bodySm" color="textSecondary">
              {t('push.offBody')}
            </Text>
            <Button label={t('push.openSettings')} variant="secondary" onPress={() => void Linking.openSettings()} />
          </View>
        ) : permission.data === 'undetermined' ? (
          <View style={[styles.notice, { borderColor: c.border, backgroundColor: c.surfaceRaised }]}>
            <Text variant="headline">{t('push.askTitle')}</Text>
            <Text variant="bodySm" color="textSecondary">
              {t('push.askBody')}
            </Text>
            <Button label={t('push.ask')} onPress={() => void requestPushPermission()} />
          </View>
        ) : null}

        {settings.isPending ? (
          <ActivityIndicator color={c.text} accessibilityLabel={t('common.loading')} style={styles.loading} />
        ) : settings.isError && !settings.data ? (
          <View style={styles.intro}>
            <Text variant="body" color="statusClosed">
              {t('errors.network')}
            </Text>
            <Button label={t('common.retry')} variant="secondary" onPress={() => void settings.refetch()} />
          </View>
        ) : (
          <View>
            <Text variant="label" color="textSecondary" accessibilityRole="header" style={styles.group}>
              {t('push.groupYou')}
            </Text>
            {rows.map((row, i) => (
              <SettingsRow
                key={row.key}
                first={i === 0}
                title={row.title}
                subtitle={row.body}
                control={
                  <Toggle value={settings.data[row.key]} onChange={(v) => flip(row.key, v)} label={row.title} fg={c.text} />
                }
              />
            ))}
            <Text variant="label" color="textSecondary" accessibilityRole="header" style={styles.group}>
              {t('push.groupPages')}
            </Text>
            {pageRows.map((row, i) => (
              <SettingsRow
                key={row.key}
                first={i === 0}
                title={row.title}
                subtitle={row.body}
                control={
                  <Toggle value={settings.data[row.key]} onChange={(v) => flip(row.key, v)} label={row.title} fg={c.text} />
                }
              />
            ))}
            {inboxes.length > 0 ? (
              <>
                <Text variant="label" color="textSecondary" accessibilityRole="header" style={styles.group}>
                  {t('push.groupInboxes')}
                </Text>
                {inboxes.map((p, i) => (
                  <SettingsRow
                    key={p.pageId}
                    first={i === 0}
                    icon={<PageTile page={p} size={32} />}
                    title={t('push.inbox', { name: p.displayName })}
                    subtitle={t('push.inboxBody', { name: p.displayName })}
                    control={
                      <Toggle
                        value={p.inboxPush}
                        onChange={(v) =>
                          setInbox.mutate(
                            { pageId: p.pageId, enabled: v },
                            { onError: () => Alert.alert(t('errors.generic'), t('errors.network')) },
                          )
                        }
                        label={t('push.inbox', { name: p.displayName })}
                        fg={c.text}
                      />
                    }
                  />
                ))}
                <Text variant="bodySm" color="textSecondary" style={styles.inboxNote}>
                  {t('push.inboxNote')}
                </Text>
              </>
            ) : null}
          </View>
        )}

        <View style={[styles.likes, { borderColor: c.borderSubtle }]}>
          <Icon name="heart" color={c.textSecondary} size={20} />
          <Text variant="bodySm" color="textSecondary" style={styles.likesText}>
            {t('push.likes')}
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: space[2], paddingHorizontal: space[3], paddingTop: space[3] },
  title: { fontSize: 24, lineHeight: 26, flexShrink: 1 },
  content: { paddingBottom: space[12] },
  intro: { paddingHorizontal: 20, paddingTop: space[4], paddingBottom: space[6], gap: space[3] },
  notice: { marginHorizontal: 20, marginBottom: space[6], padding: space[4], gap: space[2], borderWidth: stroke.rule },
  loading: { marginTop: space[6] },
  group: { paddingHorizontal: 20, paddingTop: space[6], paddingBottom: space[2] },
  inboxNote: { paddingHorizontal: 20, paddingTop: space[2] },
  likes: {
    marginHorizontal: 20,
    marginTop: space[6],
    padding: space[3],
    borderWidth: stroke.rule,
    borderStyle: 'dashed',
    flexDirection: 'row',
    gap: space[2],
  },
  likesText: { flex: 1 },
});
