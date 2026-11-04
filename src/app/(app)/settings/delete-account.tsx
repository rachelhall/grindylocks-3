import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { PageTile } from '@/components/pages';
import { useTeamErrorAlert } from '@/components/page-team';
import { SafeAreaView } from '@/components/safe-area';
import { BackButton, Button, CheckBox, Icon } from '@/components/ui';
import { useMyContentCounts } from '@/lib/account';
import { authErrorKey } from '@/lib/auth-errors';
import { useAuth } from '@/lib/auth';
import { isReviewEmail } from '@/lib/review-sign-in';
import { type RoleBadge, useMyProfile } from '@/lib/profiles';
import { type OwnedPage, useCancelPageInvite, useMyOwnedPages } from '@/lib/page-team';
import { pageKind } from '@/lib/pages';
import { useMyInvites } from '@/lib/social';
import { supabase } from '@/lib/supabase';
import { fontFamily, space, stroke, Text, useColors } from '@/theme';

/**
 * Delete your account (Settings-Delete mockup, M5): what happens, with your
 * own roles, unused invites and post count filled in; keep your posts up
 * anonymized (the default) or delete them; then a sign-in code to your own
 * address confirms it on the next screen (the database only deletes with a
 * code entered in the last 15 minutes).
 *
 * Owning a page (part A, PR 7a): with other people on its team, the page
 * needs a new owner first, and Send me a code stays off until it has one
 * (Delete-Owner-Team); the database refuses too. As the only one on the
 * team, you tick that the page goes back to Unofficial (Delete-Owner-Solo).
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
  const owned = useMyOwnedPages(userId);
  const withTeam = (owned.data ?? []).filter((p) => p.teamSize > 1);
  const solo = (owned.data ?? []).filter((p) => p.teamSize <= 1 && p.state === 'managed');
  const [soloOk, setSoloOk] = useState(false);
  const blocked = withTeam.length > 0 || (solo.length > 0 && !soloOk) || owned.isPending;
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
    ...(owned.data ?? []).map((p) => t('deleteAccount.owner.pagePosts', { name: p.displayName })),
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
    // The App Review account confirms with its fixed code; nothing to email.
    if (isReviewEmail(email)) {
      router.push({ pathname: '/settings/delete-code', params: { keep: keepPosts ? '1' : '0' } });
      return;
    }
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
          <Text variant="body">
            {withTeam.length > 0 ? t('deleteAccount.owner.first', { name: withTeam[0].displayName }) : t('deleteAccount.body')}
          </Text>
        </View>

        {withTeam.map((p) => (
          <OwnedWithTeam key={p.pageId} page={p} userId={userId} />
        ))}
        {solo.map((p) => (
          <View key={p.pageId} style={[styles.card, { borderColor: c.border, backgroundColor: c.surfaceRaised }]}>
            <View style={styles.cardHead}>
              <PageTile page={p} />
              <View style={styles.flex}>
                <Text variant="headline">{t('deleteAccount.owner.youOwn', { name: p.displayName })}</Text>
                <Text variant="bodySm" color="textSecondary">
                  {t('deleteAccount.owner.onlyOne', { kind: t(`page.${pageKind(p)}`) })}
                </Text>
              </View>
            </View>
            {[t('deleteAccount.owner.soloUnofficial'), t('deleteAccount.owner.soloPosts'), t('deleteAccount.owner.soloFollowers')].map((line) => (
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
        ))}
        {solo.length > 0 ? (
          <View style={styles.group}>
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: soloOk }}
              onPress={() => setSoloOk((v) => !v)}
              style={({ pressed }) => [styles.option, { backgroundColor: c.surfaceRaised, borderColor: soloOk ? c.border : c.borderSubtle }, pressed && styles.pressed]}
            >
              <CheckBox checked={soloOk} c={c} />
              <Text variant="body" style={styles.flex}>
                {t('deleteAccount.owner.soloTick', { name: solo.map((p) => p.displayName).join(', ') })}
              </Text>
            </Pressable>
            <Text variant="bodySm" color="textSecondary">
              {t('deleteAccount.owner.soloElse')}
            </Text>
          </View>
        ) : null}

        <View style={styles.intro}>
          <Text variant="label" color="textSecondary" accessibilityRole="header">
            {t('deleteAccount.owner.whenYouDelete')}
          </Text>
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
          <Button label={t('deleteAccount.sendCode')} onPress={() => void sendCode()} loading={busy} disabled={!email || blocked} />
          {withTeam.length > 0 ? (
            <Text variant="bodySm" color="textSecondary">
              {t('deleteAccount.owner.availableOnce', { name: withTeam.map((p) => p.displayName).join(', ') })}
            </Text>
          ) : null}
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

/** "You own 8SET": hand it over first (Delete-Owner-Team). */
function OwnedWithTeam({ page, userId }: { page: OwnedPage; userId: string | undefined }) {
  const { t } = useTranslation();
  const c = useColors();
  const cancel = useCancelPageInvite(page.pageId, userId);
  const alertError = useTeamErrorAlert();
  return (
    <View style={[styles.card, { borderColor: c.border, backgroundColor: c.surfaceRaised }]}>
      <View style={styles.cardHead}>
        <PageTile page={page} />
        <View style={styles.flex}>
          <Text variant="headline">{t('deleteAccount.owner.youOwn', { name: page.displayName })}</Text>
          <Text variant="bodySm" color="textSecondary">
            {t('deleteAccount.owner.teamLine', { kind: t(`page.${pageKind(page)}`), count: page.teamSize })}
          </Text>
        </View>
      </View>
      <Text variant="bodySm" color="textSecondary">
        {t('deleteAccount.owner.handOver')}
      </Text>
      {page.handoverId ? (
        <View style={[styles.waiting, { borderColor: c.border }]}>
          <Icon name="hourglass" color={c.textSecondary} size={22} />
          <Text variant="bodySm" style={styles.flex}>
            {t('pageTeam.waitingFor', { username: page.handoverUsername ?? '' })}
          </Text>
          <Button
            variant="secondary"
            label={t('common.cancel')}
            onPress={() => cancel.mutate(page.handoverId!, { onError: (err) => void alertError(err) })}
            style={styles.smallButton}
          />
        </View>
      ) : (
        <>
          {page.declinedUsername ? (
            <Text variant="bodySm" color="textSecondary">
              {t('pageTeam.declined', { username: page.declinedUsername })}
            </Text>
          ) : null}
          <Button
            icon="key"
            label={t('deleteAccount.owner.transfer', { name: page.displayName })}
            onPress={() => router.push({ pathname: '/page-team/[handle]', params: { handle: page.handle } })}
          />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  card: { borderWidth: stroke.rule, padding: 14, gap: space[3] },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  waiting: { flexDirection: 'row', alignItems: 'center', gap: space[3], borderWidth: stroke.rule, borderStyle: 'dashed', padding: space[3] },
  smallButton: { minHeight: 40, paddingHorizontal: 10 },
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
