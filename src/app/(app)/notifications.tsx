import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from '@/components/safe-area';

import { Avatar } from '@/components/profile';
import { BackButton, Button } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { useAnswerFollowRequest, useFollowRequests, useInviteNotices } from '@/lib/social';
import { space, stroke, Text, useColors } from '@/theme';

/**
 * Opened from the bell on the Home feed (Nov 1), not a tab. So far it has
 * follow requests (for private accounts) and "joined with your invite";
 * comments, tags, filmer credit and "someone new" come with M4, along with
 * the bell's unread dot.
 */
export default function Notifications() {
  const { t, i18n } = useTranslation();
  const c = useColors();
  const { session } = useAuth();
  const userId = session?.user.id;
  const requests = useFollowRequests(userId);
  const notices = useInviteNotices(userId);
  const answer = useAnswerFollowRequest(userId);

  const openProfile = (username: string) => router.push({ pathname: '/profile/[username]', params: { username } });
  const date = (iso: string) => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(new Date(iso));
  const reply = (followerId: string, accept: boolean) =>
    answer.mutate({ followerId, accept }, { onError: () => Alert.alert(t('errors.generic'), t('errors.network')) });

  const pending = requests.data ?? [];
  const joined = notices.data ?? [];
  const empty = !requests.isPending && !notices.isPending && pending.length === 0 && joined.length === 0;

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.screen, { backgroundColor: c.surface }]}>
      <View style={styles.header}>
        <BackButton />
        <Text variant="display" accessibilityRole="header" style={styles.title}>
          {t('notifications.title')}
        </Text>
      </View>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={requests.isRefetching || notices.isRefetching}
            onRefresh={() => {
              void requests.refetch();
              void notices.refetch();
            }}
            tintColor={c.text}
          />
        }
      >
        {requests.isError || notices.isError ? (
          <Text variant="bodySm" color="statusClosed" style={styles.pad}>
            {t('errors.network')}
          </Text>
        ) : null}

        {pending.length > 0 ? (
          <View>
            <Text variant="label" color="textSecondary" accessibilityRole="header" style={styles.section}>
              {t('follow.requestsTitle')}
            </Text>
            {pending.map((r, i) => (
              <View
                key={r.follower_id}
                style={[
                  styles.row,
                  { backgroundColor: c.surfaceRaised, borderColor: c.borderSubtle, borderTopWidth: i === 0 ? stroke.hairline : 0 },
                ]}
              >
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={r.username}
                  onPress={() => openProfile(r.username)}
                  style={styles.person}
                >
                  <Avatar path={r.avatar_path} username={r.username} size={40} />
                  <View style={styles.rowText}>
                    <Text variant="body" numberOfLines={1}>
                      {r.username}
                    </Text>
                    <Text variant="bodySm" color="textSecondary">
                      {t('follow.wantsToFollow')}
                    </Text>
                  </View>
                </Pressable>
                <View style={styles.actions}>
                  <Button label={t('follow.accept')} onPress={() => reply(r.follower_id, true)} style={styles.small} />
                  <Button
                    label={t('follow.decline')}
                    variant="secondary"
                    onPress={() => reply(r.follower_id, false)}
                    style={styles.small}
                  />
                </View>
              </View>
            ))}
          </View>
        ) : null}

        {joined.length > 0 ? (
          <View>
            <Text variant="label" color="textSecondary" accessibilityRole="header" style={styles.section}>
              {t('notifications.earlier')}
            </Text>
            {joined.map((n, i) => (
              <Pressable
                key={n.id}
                accessibilityRole={n.username ? 'button' : undefined}
                disabled={!n.username}
                onPress={() => n.username && openProfile(n.username)}
                style={({ pressed }) => [
                  styles.row,
                  styles.rowLine,
                  { backgroundColor: c.surfaceRaised, borderColor: c.borderSubtle, borderTopWidth: i === 0 ? stroke.hairline : 0 },
                  pressed && styles.pressed,
                ]}
              >
                <View style={styles.rowText}>
                  <Text variant="body">
                    {n.username
                      ? t('notifications.inviteUsed', { username: n.username })
                      : t('notifications.inviteUsedSomeone')}
                  </Text>
                  <Text variant="bodySm" color="textSecondary">
                    {date(n.createdAt)}
                  </Text>
                </View>
              </Pressable>
            ))}
          </View>
        ) : null}

        {empty ? (
          <Text variant="body" color="textSecondary" style={styles.pad}>
            {t('notifications.empty')}
          </Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: space[2], paddingHorizontal: space[3], paddingTop: space[3] },
  title: { fontSize: 28, lineHeight: 30 },
  content: { paddingBottom: space[12] },
  pad: { paddingHorizontal: 20, paddingTop: space[6] },
  section: { paddingHorizontal: 20, paddingTop: space[6], paddingBottom: space[2] },
  row: { paddingHorizontal: 20, paddingVertical: 10, borderBottomWidth: stroke.hairline, gap: space[2] },
  rowLine: { flexDirection: 'row', alignItems: 'center', minHeight: 56 },
  person: { flexDirection: 'row', alignItems: 'center', gap: space[3], minHeight: 48 },
  rowText: { flex: 1, minWidth: 0, gap: 2 },
  actions: { flexDirection: 'row', gap: space[2] },
  small: { flex: 1, minHeight: 48 },
  pressed: { opacity: 0.75 },
});
