import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, RefreshControl, ScrollView, Share, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BackButton, Button } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import {
  formatInviteCode,
  type Invite,
  inviteLink,
  useCancelInvite,
  useCreateInvite,
  useMyInvites,
} from '@/lib/social';
import { fontFamily, space, stroke, Text, useColors } from '@/theme';

const DAY = 86_400_000;

/**
 * Your invites (from the Invites button on your profile). Each link works
 * once, for 7 days. Cancelling an unused link, or letting it expire, gives
 * the invite back. Admins can give more later (M5).
 */
export default function Invites() {
  const { t, i18n } = useTranslation();
  const c = useColors();
  const { session, profile } = useAuth();
  const userId = session?.user.id;
  // Days left are counted from when the list was loaded, so render stays pure.
  const { data, dataUpdatedAt, isPending, isError, refetch, isRefetching } = useMyInvites(userId);
  const create = useCreateInvite(userId);
  const cancel = useCancelInvite(userId);

  async function share(code: string) {
    const message = t('invites.shareMessage', {
      username: profile?.username ?? '',
      code: formatInviteCode(code),
      link: inviteLink(code),
    });
    try {
      await Share.share({ message });
    } catch {
      // Closing the share sheet isn't an error worth showing.
    }
  }

  function make() {
    create.mutate(undefined, {
      onSuccess: (invite) => void share(invite.code),
      onError: (e) =>
        Alert.alert(
          e.message === 'noneLeft' ? t('invites.noneLeftTitle') : t('errors.generic'),
          e.message === 'noneLeft' ? t('invites.noneLeftBody') : t('errors.network'),
        ),
    });
  }

  function confirmCancel(invite: Invite) {
    Alert.alert(t('invites.cancelTitle'), t('invites.cancelBody', { code: formatInviteCode(invite.code) }), [
      { text: t('invites.keep'), style: 'cancel' },
      {
        text: t('invites.cancel'),
        style: 'destructive',
        onPress: () =>
          cancel.mutate(invite.id, { onError: () => Alert.alert(t('errors.generic'), t('errors.network')) }),
      },
    ]);
  }

  const date = (iso: string) => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(new Date(iso));
  const shown = (data?.invites ?? []).filter((i) => i.state !== 'cancelled');
  const remaining = data?.remaining ?? 0;

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.screen, { backgroundColor: c.surface }]}>
      <View style={styles.header}>
        <BackButton />
        <Text variant="display" accessibilityRole="header" style={styles.title}>
          {t('invites.title')}
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} tintColor={c.text} />}
      >
        {isPending ? (
          <ActivityIndicator color={c.text} accessibilityLabel={t('common.loading')} style={styles.loading} />
        ) : isError && !data ? (
          <View style={styles.block}>
            <Text variant="body" color="statusClosed">
              {t('errors.network')}
            </Text>
            <Button label={t('common.retry')} variant="secondary" onPress={() => void refetch()} />
          </View>
        ) : (
          <>
            <View style={styles.block}>
              <Text variant="display" style={styles.count}>
                {remaining}
              </Text>
              <Text variant="headline">{t('invites.left', { count: remaining })}</Text>
              <Text variant="bodySm" color="textSecondary">
                {t('invites.body')}
              </Text>
              <Button
                label={t('invites.make')}
                onPress={make}
                loading={create.isPending}
                disabled={remaining <= 0}
              />
              {remaining <= 0 ? (
                <Text variant="bodySm" color="textSecondary">
                  {t('invites.noneLeftBody')}
                </Text>
              ) : null}
            </View>

            {shown.length > 0 ? (
              <View>
                <Text variant="label" color="textSecondary" accessibilityRole="header" style={styles.section}>
                  {t('invites.yours')}
                </Text>
                {shown.map((invite, i) => (
                  <View
                    key={invite.id}
                    style={[
                      styles.row,
                      { backgroundColor: c.surfaceRaised, borderColor: c.borderSubtle, borderTopWidth: i === 0 ? stroke.hairline : 0 },
                    ]}
                  >
                    <View style={styles.rowText}>
                      <Text
                        variant="body"
                        color={invite.state === 'active' ? 'text' : 'textSecondary'}
                        style={styles.code}
                        accessibilityLabel={formatInviteCode(invite.code).split('').join(' ')}
                      >
                        {formatInviteCode(invite.code)}
                      </Text>
                      <Text variant="bodySm" color="textSecondary">
                        {invite.state === 'active'
                          ? t('invites.expiresIn', {
                              count: Math.max(1, Math.ceil((new Date(invite.expires_at).getTime() - dataUpdatedAt) / DAY)),
                            })
                          : invite.state === 'used'
                            ? invite.used_by_username
                              ? t('invites.usedBy', { username: invite.used_by_username, date: date(invite.used_at!) })
                              : t('invites.usedByDeleted', { date: date(invite.used_at!) })
                            : t('invites.expired', { date: date(invite.expires_at) })}
                      </Text>
                    </View>
                    {invite.state === 'active' ? (
                      <View style={styles.rowActions}>
                        <Button label={t('invites.share')} variant="secondary" onPress={() => void share(invite.code)} style={styles.small} />
                        <Button label={t('invites.cancel')} variant="tertiary" onPress={() => confirmCancel(invite)} style={styles.small} />
                      </View>
                    ) : invite.state === 'used' && invite.used_by_username ? (
                      <Button
                        label={t('invites.view')}
                        variant="tertiary"
                        onPress={() =>
                          router.push({ pathname: '/profile/[username]', params: { username: invite.used_by_username! } })
                        }
                        style={styles.small}
                      />
                    ) : null}
                  </View>
                ))}
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: space[2], paddingHorizontal: space[3], paddingTop: space[3] },
  title: { fontSize: 28, lineHeight: 30 },
  content: { paddingBottom: space[12] },
  loading: { marginTop: space[12] },
  block: { paddingHorizontal: 20, paddingTop: space[6], gap: space[3] },
  count: { fontSize: 64, lineHeight: 64 },
  section: { paddingHorizontal: 20, paddingTop: space[8], paddingBottom: space[2] },
  row: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderBottomWidth: stroke.hairline,
    gap: space[2],
  },
  rowText: { gap: 2 },
  code: { fontFamily: fontFamily.display, fontSize: 18, letterSpacing: 2 },
  rowActions: { flexDirection: 'row', gap: space[2] },
  small: { flex: 1, minHeight: 48 },
});
