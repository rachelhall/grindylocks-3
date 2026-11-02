import { router } from 'expo-router';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from '@/components/safe-area';

import { timeAgo } from '@/components/post-card';
import { Avatar } from '@/components/profile';
import { BackButton, Button } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { type AppNotification, useMarkNotificationsSeen, useNotifications } from '@/lib/engagement';
import { useAnswerFollowRequest, useFollowRequests } from '@/lib/social';
import { fontFamily, space, stroke, Text, useColors } from '@/theme';

/**
 * Opened from the bell on the Home feed (Nov 1), not a tab. Follow requests
 * (for private accounts) sit at the top with Accept and Decline. Below them,
 * newest first: comments on your posts (grouped by post), replies, mentions,
 * tags, filmer credit, "joined with your invite" and "someone new" in your
 * city (M4b). Opening it clears the bell's dot; what arrived since the last
 * visit is marked New for this visit.
 */
export default function Notifications() {
  const { t, i18n } = useTranslation();
  const c = useColors();
  const { session } = useAuth();
  const userId = session?.user.id;
  const requests = useFollowRequests(userId);
  const list = useNotifications(userId);
  const answer = useAnswerFollowRequest(userId);
  const markSeen = useMarkNotificationsSeen(userId);

  // Clear the dot once the list has loaded (so its New marks are kept).
  const marked = useRef(false);
  const loaded = list.isSuccess;
  const mark = markSeen.mutate;
  useEffect(() => {
    if (!loaded || marked.current) return;
    marked.current = true;
    mark();
  }, [loaded, mark]);

  const openProfile = (username: string) => router.push({ pathname: '/profile/[username]', params: { username } });
  const reply = (followerId: string, accept: boolean) =>
    answer.mutate({ followerId, accept }, { onError: () => Alert.alert(t('errors.generic'), t('errors.network')) });

  const pending = requests.data ?? [];
  const items = list.data ?? [];
  const fresh = items.filter((n) => n.unread);
  const older = items.filter((n) => !n.unread);
  const empty = !requests.isPending && !list.isPending && pending.length === 0 && items.length === 0;

  function open(n: AppNotification) {
    const first = n.people[0]?.username;
    switch (n.kind) {
      case 'comment':
      case 'reply':
      case 'mention':
        if (n.postId) router.push({ pathname: '/post/[id]', params: { id: n.postId, comments: '1' } });
        return;
      case 'tag':
      case 'filmer_credit':
        if (n.postId) router.push({ pathname: '/post/[id]', params: { id: n.postId } });
        return;
      default:
        if (first) openProfile(first);
    }
  }

  function describe(n: AppNotification): string {
    const name = (i: number) => n.people[i]?.username ?? t('common.deletedUser');
    const a = name(0);
    switch (n.kind) {
      case 'comment':
        if (n.peopleCount <= 1) return t('notifications.commentOne', { a });
        if (n.peopleCount === 2) return t('notifications.commentTwo', { a, b: name(1) });
        return t('notifications.commentMany', { a, b: name(1), count: n.peopleCount - 2 });
      case 'reply':
        return t('notifications.reply', { a });
      case 'mention':
        return t('notifications.mention', { a });
      case 'tag':
        return t('notifications.tag', { a });
      case 'filmer_credit':
        return t('notifications.filmer', { a });
      case 'invite_used':
        return n.people[0]?.username
          ? t('notifications.inviteUsed', { username: a })
          : t('notifications.inviteUsedSomeone');
      case 'someone_new':
        return t('notifications.someoneNew', { a, metro: n.metroName ?? '' });
      case 'visiting':
        return n.park
          ? t('notifications.visitingPark', { a, metro: n.metroName ?? '', park: n.park.name })
          : t('notifications.visiting', { a, metro: n.metroName ?? '' });
    }
  }

  function Row({ n, first }: { n: AppNotification; first: boolean }) {
    const text = describe(n);
    const person = n.people[0];
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${n.unread ? t('notifications.unreadLabel', { text }) : text}, ${timeAgo(n.createdAt, t, i18n.language)}`}
        onPress={() => open(n)}
        style={({ pressed }) => [
          styles.row,
          styles.rowLine,
          {
            backgroundColor: n.unread ? c.accentSubtle : c.surfaceRaised,
            borderColor: c.borderSubtle,
            borderTopWidth: first ? stroke.hairline : 0,
          },
          pressed && styles.pressed,
        ]}
      >
        <View style={styles.avatars}>
          <Avatar path={person?.avatarPath ?? null} username={person?.username ?? '?'} size={40} />
          {n.kind === 'comment' && n.people[1] ? (
            <View style={[styles.second, { borderColor: n.unread ? c.accentSubtle : c.surfaceRaised }]}>
              <Avatar path={n.people[1].avatarPath} username={n.people[1].username ?? '?'} size={24} />
            </View>
          ) : null}
        </View>
        <View style={styles.rowText}>
          <Text variant="bodySm" style={n.unread ? { color: c.onAccentSubtle, fontFamily: fontFamily.sansSemiBold } : undefined}>
            {text}
          </Text>
          {n.excerpt ? (
            <Text
              variant="bodySm"
              numberOfLines={2}
              style={{ color: n.unread ? c.onAccentSubtleSecondary : c.textSecondary }}
            >
              “{n.excerpt}”
            </Text>
          ) : null}
          <Text variant="caption" style={{ color: n.unread ? c.onAccentSubtleSecondary : c.textMuted }}>
            {timeAgo(n.createdAt, t, i18n.language)}
          </Text>
        </View>
      </Pressable>
    );
  }

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
            refreshing={requests.isRefetching || list.isRefetching}
            onRefresh={() => {
              void requests.refetch();
              void list.refetch();
              markSeen.mutate();
            }}
            tintColor={c.text}
          />
        }
      >
        {requests.isError || list.isError ? (
          <Text variant="bodySm" color="statusClosed" style={styles.pad}>
            {t('errors.network')}
          </Text>
        ) : null}

        {pending.length > 0 ? (
          <View>
            <Text variant="label" color="textSecondary" accessibilityRole="header" style={styles.section}>
              {t('notifications.requests')}
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

        {fresh.length > 0 ? (
          <View>
            <Text variant="label" color="textSecondary" accessibilityRole="header" style={styles.section}>
              {t('notifications.new')}
            </Text>
            {fresh.map((n, i) => (
              <Row key={n.id} n={n} first={i === 0} />
            ))}
          </View>
        ) : null}

        {older.length > 0 ? (
          <View>
            <Text variant="label" color="textSecondary" accessibilityRole="header" style={styles.section}>
              {t('notifications.older')}
            </Text>
            {older.map((n, i) => (
              <Row key={n.id} n={n} first={i === 0} />
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
  rowLine: { flexDirection: 'row', alignItems: 'flex-start', gap: space[3], minHeight: 56 },
  avatars: { width: 44, height: 44 },
  second: { position: 'absolute', right: -2, bottom: -2, borderWidth: 2 },
  person: { flexDirection: 'row', alignItems: 'center', gap: space[3], minHeight: 48 },
  rowText: { flex: 1, minWidth: 0, gap: 2 },
  actions: { flexDirection: 'row', gap: space[2] },
  small: { flex: 1, minHeight: 48 },
  pressed: { opacity: 0.75 },
});
