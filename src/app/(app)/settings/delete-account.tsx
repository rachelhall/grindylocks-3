import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { SafeAreaView } from '@/components/safe-area';
import { BackButton, Button } from '@/components/ui';
import { useMyContentCounts } from '@/lib/account';
import { authErrorKey } from '@/lib/auth-errors';
import { useAuth } from '@/lib/auth';
import { type RoleBadge, useMyProfile } from '@/lib/profiles';
import { useMyInvites } from '@/lib/social';
import { supabase } from '@/lib/supabase';
import { fontFamily, space, stroke, Text, useColors } from '@/theme';

/**
 * Delete your account (Settings-Delete mockup, M5): what happens, with your
 * own roles, unused invites and post count filled in; keep your posts up
 * anonymized (the default) or delete them; then a sign-in code to your own
 * address confirms it on the next screen (the database only deletes with a
 * code entered in the last 15 minutes).
 */
export default function DeleteAccount() {
  const { t } = useTranslation();
  const c = useColors();
  const { session } = useAuth();
  const userId = session?.user.id;
  const email = session?.user.email ?? '';
  const { data: profile } = useMyProfile(userId);
  const invites = useMyInvites(userId);
  const counts = useMyContentCounts(userId);
  const [keepPosts, setKeepPosts] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const unused = invites.data?.invites.filter((i) => i.state === 'active').length ?? 0;
  const roles = (profile?.roles ?? []).filter((r) => r.role !== 'owner');

  const roleLine = (r: RoleBadge) => {
    const role = t(`profile.role.${r.role}`);
    const next =
      r.role === 'park_contributor'
        ? t('deleteAccount.nextParkAdmin')
        : r.role === 'park_admin'
          ? t('deleteAccount.nextCityAdmin')
          : t('deleteAccount.nextOwner');
    return r.place ? t('deleteAccount.roleAt', { role, place: r.place, next }) : t('deleteAccount.role', { role, next });
  };

  const what = [
    t('deleteAccount.profile'),
    t('deleteAccount.tags'),
    ...roles.map(roleLine),
    ...(unused > 0 ? [t('deleteAccount.invites', { count: unused })] : []),
  ];

  const postsLabel = counts.data
    ? counts.data.photos > 0
      ? t('deleteAccount.postsAndPhotos', {
          posts: t('deleteAccount.postCount', { count: counts.data.posts }),
          photos: t('deleteAccount.photoCount', { count: counts.data.photos }),
        })
      : t('deleteAccount.postsOnly', { posts: t('deleteAccount.postCount', { count: counts.data.posts }) })
    : t('deleteAccount.yourPosts');

  async function sendCode() {
    if (!email) return;
    setError(null);
    setBusy(true);
    const { error: sendError } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
    setBusy(false);
    if (sendError) {
      setError(t(authErrorKey(sendError)));
      return;
    }
    router.push({ pathname: '/settings/delete-code', params: { keep: keepPosts ? '1' : '0' } });
  }

  const choices = [
    { keep: true, title: t('deleteAccount.keep'), body: t('deleteAccount.keepBody') },
    { keep: false, title: t('deleteAccount.remove'), body: t('deleteAccount.removeBody') },
  ];

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.screen, { backgroundColor: c.surface }]}>
      <View style={styles.header}>
        <BackButton />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.intro}>
          <Text variant="display" accessibilityRole="header" style={styles.title}>
            {t('deleteAccount.title')}
          </Text>
          <Text variant="body">{t('deleteAccount.body')}</Text>
          <View style={styles.list}>
            {what.map((line) => (
              <View key={line} style={styles.bullet}>
                <Text variant="bodySm" color="textSecondary">
                  {'•'}
                </Text>
                <Text variant="bodySm" color="textSecondary" style={styles.flex}>
                  {line}
                </Text>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.group} accessibilityRole="radiogroup">
          <Text variant="label" color="textSecondary">
            {postsLabel}
          </Text>
          {choices.map((choice) => {
            const selected = keepPosts === choice.keep;
            return (
              <Pressable
                key={String(choice.keep)}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={`${choice.title}, ${choice.body}`}
                onPress={() => setKeepPosts(choice.keep)}
                style={({ pressed }) => [
                  styles.option,
                  { backgroundColor: c.surfaceRaised, borderColor: selected ? c.border : c.borderSubtle },
                  pressed && styles.pressed,
                ]}
              >
                <View style={[styles.radio, { borderColor: c.border }]}>
                  {selected ? <View style={[styles.radioDot, { backgroundColor: c.text }]} /> : null}
                </View>
                <View style={styles.flex}>
                  <Text variant="headline" style={styles.optionTitle}>
                    {choice.title}
                  </Text>
                  <Text variant="bodySm" color="textSecondary">
                    {choice.body}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.group}>
          <Text variant="bodySm" color="textSecondary">
            {t('deleteAccount.dataFirst')}{' '}
            <Text
              variant="bodySm"
              color="accentText"
              accessibilityRole="link"
              onPress={() => router.push('/settings/data')}
              style={styles.link}
            >
              {t('settings.dataCopy')}
            </Text>
          </Text>
          <Button label={t('deleteAccount.sendCode')} onPress={() => void sendCode()} loading={busy} disabled={!email} />
          {error ? (
            <Text variant="bodySm" color="statusClosed" accessibilityLiveRegion="polite">
              {error}
            </Text>
          ) : (
            <Text variant="bodySm" color="textSecondary">
              {t('deleteAccount.sendCodeBody', { email })}
            </Text>
          )}
          <Button variant="tertiary" label={t('deleteAccount.cancel')} onPress={() => router.back()} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1 },
  pressed: { opacity: 0.75 },
  header: { flexDirection: 'row', paddingHorizontal: space[3], paddingTop: space[3] },
  content: { paddingHorizontal: 20, paddingTop: space[2], paddingBottom: space[12], gap: space[6] },
  intro: { gap: 14 },
  title: { fontSize: 32, lineHeight: 32 },
  list: { gap: space[2] },
  bullet: { flexDirection: 'row', gap: space[2], paddingLeft: space[1] },
  group: { gap: 10 },
  option: { flexDirection: 'row', gap: space[3], alignItems: 'flex-start', padding: 14, borderWidth: stroke.rule },
  optionTitle: { fontSize: 15 },
  radio: { width: 22, height: 22, borderWidth: stroke.rule, alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: 10, height: 10 },
  link: { fontFamily: fontFamily.sansSemiBold },
});
