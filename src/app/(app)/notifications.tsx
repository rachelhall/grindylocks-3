import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from '@/components/safe-area';

import { timeAgo } from '@/components/post-card';
import { Avatar } from '@/components/profile';
import { BackButton, Button, Icon, type IconName } from '@/components/ui';
import { RestrictionBanner } from '@/components/safety';
import { useAuth } from '@/lib/auth';
import {
  type AppNotification,
  type NotificationKind,
  type PostCover,
  useMarkNotificationsSeen,
  useNotifications,
  usePostCovers,
} from '@/lib/engagement';
import { useRestriction } from '@/lib/moderation';
import { type FollowRequest, useAnswerFollowRequest, useFollowRequests } from '@/lib/social';
import { brand, fontFamily, space, stroke, Text, useColors } from '@/theme';

/**
 * Opened from the bell on the Home feed (Nov 1), not a tab. Laid out from
 * the "Notifications" mockup (Built from the brief, Nov 2):
 *
 * - Follow requests (private accounts) in a box at the top, Accept in pink
 *   and Decline outlined.
 * - What arrived since the last visit under New, on the pale pink; the rest
 *   under Earlier. Opening the screen clears the bell's dot.
 * - Each avatar carries a small ink type badge, so the list scans without
 *   relying on color. Post notifications show the post's first slide on the
 *   right and open the post; people notifications (invite used, says hi,
 *   visiting) have no thumbnail and open the profile.
 * - M5 (Notices mockup): a suspended or banned member gets the ink banner
 *   at the top. Moderation notices (post or comment removed, a warning, a
 *   suspension) and park fixes going live have no person, so their avatar
 *   is a plain square with the badge's icon; a removed post opens (its
 *   author still sees it), a fix opens the park. A vacated role shows the
 *   person whose role ended and opens their profile.
 * - Meetups (PR 5): for hosts, one row per date for people going ("Ana and
 *   3 others are going to Thursday at Fælled") and one for comments; for
 *   people going, changes, cancellations and the 1-hour reminder; the
 *   co-host invite; replies and mentions in meetup comments; and, for hosts,
 *   a date hidden by park admins. They all open the meetup.
 */

const BADGES: Record<NotificationKind, IconName> = {
  comment: 'badgeComment',
  reply: 'badgeReply',
  mention: 'badgeMention',
  caption_mention: 'badgeMention',
  tag: 'badgeTag',
  filmer_credit: 'video',
  invite_used: 'badgeInvite',
  someone_new: 'badgeWave',
  visiting: 'badgePlane',
  park_fix_live: 'pin',
  post_removed: 'badgeRemoved',
  comment_removed: 'badgeRemoved',
  warning: 'badgeWarning',
  suspension: 'badgeWarning',
  role_vacated: 'badgeRole',
  meetup_going: 'check',
  meetup_changed: 'calendar',
  meetup_cancelled: 'calendarOff',
  meetup_reminder: 'alarm',
  co_host_invite: 'coHost',
  meetup_comment: 'badgeComment',
  meetup_reply: 'badgeReply',
  meetup_mention: 'badgeMention',
  meetup_hidden: 'badgeRemoved',
};

const POST_KINDS = new Set<NotificationKind>(['comment', 'reply', 'mention', 'caption_mention', 'tag', 'filmer_credit']);

/** Notices from the admins or about a park: no person, so no avatar. */
const NOTICE_KINDS = new Set<NotificationKind>([
  'park_fix_live',
  'post_removed',
  'comment_removed',
  'warning',
  'suspension',
  'meetup_reminder',
  'meetup_hidden',
]);

/** Splits a sentence so the usernames in it can be set in bold. */
function withBoldNames(text: string, names: string[]): { text: string; bold: boolean }[] {
  const wanted = names.filter(Boolean).sort((a, b) => b.length - a.length);
  if (wanted.length === 0) return [{ text, bold: false }];
  const escaped = wanted.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return text
    .split(new RegExp(`(@?(?:${escaped.join('|')}))`, 'g'))
    .filter((part) => part.length > 0)
    .map((part) => ({ text: part, bold: wanted.includes(part.replace(/^@/, '')) }));
}

export default function Notifications() {
  const { t, i18n } = useTranslation();
  const c = useColors();
  const { session } = useAuth();
  const userId = session?.user.id;
  const requests = useFollowRequests(userId);
  const list = useNotifications(userId);
  const answer = useAnswerFollowRequest(userId);
  const markSeen = useMarkNotificationsSeen(userId);
  const restriction = useRestriction(userId);

  // Clear the dot once the list has loaded (so its New marks are kept).
  const marked = useRef(false);
  const loaded = list.isSuccess;
  const mark = markSeen.mutate;
  useEffect(() => {
    if (!loaded || marked.current) return;
    marked.current = true;
    mark();
  }, [loaded, mark]);

  const pending = requests.data ?? [];
  const items = list.data ?? [];
  const covers = usePostCovers(items.filter((n) => POST_KINDS.has(n.kind) && n.postId).map((n) => n.postId!));
  const fresh = items.filter((n) => n.unread);
  const older = items.filter((n) => !n.unread);
  const empty = !requests.isPending && !list.isPending && pending.length === 0 && items.length === 0;

  const openProfile = (username: string) => router.push({ pathname: '/profile/[username]', params: { username } });
  const reply = (followerId: string, accept: boolean) =>
    answer.mutate({ followerId, accept }, { onError: () => Alert.alert(t('errors.generic'), t('errors.network')) });

  function open(n: AppNotification) {
    if (n.meetup) {
      router.push({ pathname: '/meetup/[id]', params: { id: n.meetup.id } });
      return;
    }
    switch (n.kind) {
      case 'comment':
      case 'reply':
      case 'mention':
        if (n.postId) router.push({ pathname: '/post/[id]', params: { id: n.postId, comments: '1' } });
        return;
      case 'caption_mention':
      case 'tag':
      case 'filmer_credit':
      case 'post_removed':
        if (n.postId) router.push({ pathname: '/post/[id]', params: { id: n.postId } });
        return;
      case 'park_fix_live':
        if (n.park) router.push({ pathname: '/park/[slug]', params: { slug: n.park.slug } });
        return;
      case 'comment_removed':
      case 'warning':
      case 'suspension':
        // Nothing to open; the message is on the row.
        return;
      default: {
        const first = n.people[0]?.username;
        if (first) openProfile(first);
      }
    }
  }

  /** "Thursday blade night", or "Meetup at Memo" without a title or line. */
  const meetupName = (n: AppNotification) => n.meetup?.title ?? t('meetup.fallbackTitle', { park: n.park?.name ?? '' });
  /** On the park's clock: "Thursday", "Thu, Nov 5", "7:00 PM". */
  const meetupWhen = (n: AppNotification, style: 'day' | 'date' | 'dateTime' | 'time') => {
    if (!n.meetup) return '';
    const opts: Intl.DateTimeFormatOptions =
      style === 'day'
        ? { weekday: 'long' }
        : style === 'date'
          ? { weekday: 'short', month: 'short', day: 'numeric' }
          : style === 'dateTime'
            ? { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }
            : { hour: 'numeric', minute: '2-digit' };
    return new Intl.DateTimeFormat(i18n.language, { ...opts, timeZone: n.meetup.timeZone ?? undefined }).format(new Date(n.meetup.startsAt));
  };

  function describe(n: AppNotification): string {
    const name = (i: number) => n.people[i]?.username ?? t('common.deletedUser');
    const a = name(0);
    const park = n.park?.name ?? '';
    switch (n.kind) {
      case 'meetup_going': {
        const when = meetupWhen(n, 'day');
        if (n.peopleCount <= 1) return t('notifications.meetupGoingOne', { a, when, park });
        if (n.peopleCount === 2) return t('notifications.meetupGoingTwo', { a, b: name(1), when, park });
        return t('notifications.meetupGoingMany', { a, count: n.peopleCount - 1, when, park });
      }
      case 'meetup_changed':
        return t('notifications.meetupChanged', { meetup: meetupName(n), when: meetupWhen(n, 'dateTime'), park });
      case 'meetup_cancelled': {
        const [reason, scope] = (n.detail ?? 'other').split(':');
        const key = (['rained_out', 'park_closed', 'something_came_up'] as const).find((r) => r === reason) ?? 'other';
        const why = t(`meetup.reason.${key}`);
        return scope === 'series'
          ? t('notifications.meetupEnded', { meetup: meetupName(n), reason: why })
          : t('notifications.meetupCancelled', { meetup: meetupName(n), date: meetupWhen(n, 'date'), reason: why });
      }
      case 'meetup_reminder':
        return t('notifications.meetupReminder', { meetup: meetupName(n), time: meetupWhen(n, 'time'), park });
      case 'co_host_invite':
        return t('notifications.coHostInvite', { a, meetup: meetupName(n) });
      case 'meetup_comment':
        if (n.peopleCount <= 1) return t('notifications.meetupCommentOne', { a, meetup: meetupName(n) });
        if (n.peopleCount === 2) return t('notifications.meetupCommentTwo', { a, b: name(1), meetup: meetupName(n) });
        return t('notifications.meetupCommentMany', { a, b: name(1), count: n.peopleCount - 2, meetup: meetupName(n) });
      case 'meetup_reply':
        return t('notifications.meetupReply', { a, meetup: meetupName(n) });
      case 'meetup_mention':
        return t('notifications.meetupMention', { a, meetup: meetupName(n) });
      case 'meetup_hidden':
        return t('notifications.meetupHidden', { meetup: meetupName(n), date: meetupWhen(n, 'date') });
      case 'comment':
        if (n.peopleCount <= 1) return t('notifications.commentOne', { a });
        if (n.peopleCount === 2) return t('notifications.commentTwo', { a, b: name(1) });
        return t('notifications.commentMany', { a, b: name(1), count: n.peopleCount - 2 });
      case 'reply':
        return t('notifications.reply', { a });
      case 'mention':
        return t('notifications.mention', { a });
      case 'caption_mention':
        return t('notifications.captionMention', { a });
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
      case 'park_fix_live':
        return t('notifications.parkFixLive', { park: n.park?.name ?? '' });
      case 'post_removed':
        return t('notifications.postRemoved');
      case 'comment_removed':
        return t('notifications.commentRemoved');
      case 'warning':
        return t('notifications.warning');
      case 'suspension':
        return t('notifications.suspension');
      case 'role_vacated': {
        const role = t(`profile.role.${n.excerpt === 'city_admin' || n.excerpt === 'park_admin' ? n.excerpt : 'park_contributor'}`);
        return n.park
          ? t('notifications.roleVacatedPark', { a, role, park: n.park.name })
          : t('notifications.roleVacated', { a, role });
      }
    }
  }

  /** The words set in bold: usernames, or a notice's opening ("Your post was taken down"). */
  function boldParts(n: AppNotification): string[] {
    switch (n.kind) {
      case 'park_fix_live':
        return [t('notifications.parkFixLiveBold', { park: n.park?.name ?? '' })];
      case 'post_removed':
        return [t('notifications.postRemovedBold')];
      case 'comment_removed':
        return [t('notifications.commentRemovedBold')];
      case 'warning':
      case 'suspension':
        return [describe(n)];
      case 'meetup_changed':
      case 'meetup_cancelled':
      case 'meetup_reminder':
      case 'meetup_hidden':
        return [meetupName(n)];
      default:
        return n.people.map((p) => p.username ?? '');
    }
  }

  function Row({ n }: { n: AppNotification }) {
    const text = describe(n);
    const person = n.people[0];
    const notice = NOTICE_KINDS.has(n.kind);
    // role_vacated's excerpt is the role, already in the sentence.
    const excerpt = n.kind === 'role_vacated' ? null : n.excerpt;
    const when = timeAgo(n.createdAt, t, i18n.language);
    const isPost = POST_KINDS.has(n.kind);
    const cover: PostCover | undefined = isPost && n.postId ? covers.data?.[n.postId] : undefined;
    // On the pale pink the text is always ink, even in dark mode.
    const ink = n.unread ? c.onAccentSubtle : c.text;
    const secondary = n.unread ? c.onAccentSubtle : c.textSecondary;
    // The badge is ink on the pale pink; elsewhere it follows the text color.
    const badgeFill = n.unread ? brand.ink : c.text;
    const badgeIcon = n.unread ? brand.paper : c.surface;
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${n.unread ? t('notifications.unreadLabel', { text }) : text}, ${when}`}
        onPress={() => open(n)}
        style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      >
        <View style={styles.avatar}>
          {notice ? (
            <View style={[styles.noticeIcon, { backgroundColor: badgeFill }]}>
              <Icon name={BADGES[n.kind]} color={badgeIcon} size={20} />
            </View>
          ) : (
            <>
              <Avatar path={person?.avatarPath ?? null} username={person?.username ?? '?'} size={40} />
              <View style={[styles.badge, { backgroundColor: badgeFill }]}>
                <Icon name={BADGES[n.kind]} color={badgeIcon} size={12} />
              </View>
            </>
          )}
        </View>
        <View style={styles.rowText}>
          <Text variant="bodySm" style={{ color: ink }}>
            {withBoldNames(text, boldParts(n)).map((part, i) =>
              part.bold ? (
                <Text key={i} variant="bodySm" style={{ color: ink, fontFamily: fontFamily.sansSemiBold }}>
                  {part.text}
                </Text>
              ) : (
                part.text
              ),
            )}
          </Text>
          {excerpt ? (
            <Text variant="bodySm" numberOfLines={notice ? 4 : 2} style={{ color: secondary }}>
              “{excerpt}”
            </Text>
          ) : null}
          <Text variant="caption" style={{ color: secondary }}>
            {when}
          </Text>
        </View>
        {isPost && n.postId ? (
          <View style={[styles.thumb, { backgroundColor: c.surfaceSunk }]}>
            {cover?.uri ? (
              <Image source={{ uri: cover.uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
            ) : null}
          </View>
        ) : null}
      </Pressable>
    );
  }

  function RequestRow({ r, last }: { r: FollowRequest; last: boolean }) {
    const disciplines = (r.disciplines ?? []).map((d) => t(`disciplines.${d}`)).join(' · ');
    return (
      <View style={[styles.request, last && styles.requestLast]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={r.username}
          onPress={() => openProfile(r.username)}
          style={styles.person}
        >
          <Avatar path={r.avatar_path} username={r.username} size={40} />
          <View style={styles.rowText}>
            <Text variant="body" numberOfLines={1} style={{ fontFamily: fontFamily.sansSemiBold }}>
              {r.username}
            </Text>
            <Text variant="caption" color="textSecondary" numberOfLines={1}>
              {disciplines || t('follow.wantsToFollow')}
            </Text>
          </View>
        </Pressable>
        <Button
          label={t('follow.accept')}
          onPress={() => reply(r.follower_id, true)}
          palette={{ fill: c.accent, text: c.onAccent, border: c.border }}
          style={styles.small}
        />
        <Button
          label={t('follow.decline')}
          variant="secondary"
          onPress={() => reply(r.follower_id, false)}
          style={styles.small}
        />
      </View>
    );
  }

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.screen, { backgroundColor: c.surface }]}>
      <View style={styles.header}>
        <BackButton />
        <Text variant="title" accessibilityRole="header" style={styles.title}>
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
              void restriction.refetch();
              markSeen.mutate();
            }}
            tintColor={c.text}
          />
        }
      >
        {restriction.data ? <RestrictionBanner restriction={restriction.data} /> : null}

        {requests.isError || list.isError ? (
          <Text variant="bodySm" color="statusClosed" style={styles.pad}>
            {t('errors.network')}
          </Text>
        ) : null}

        {pending.length > 0 ? (
          <View style={[styles.requests, { backgroundColor: c.surfaceRaised, borderColor: c.border }]}>
            <Text variant="label" color="textSecondary" accessibilityRole="header" style={styles.requestsTitle}>
              {`${t('notifications.requests')} · ${pending.length}`}
            </Text>
            {pending.map((r, i) => (
              <RequestRow key={r.follower_id} r={r} last={i === pending.length - 1} />
            ))}
          </View>
        ) : null}

        {fresh.length > 0 ? (
          <View style={[styles.newBlock, { backgroundColor: c.accentSubtle, borderColor: c.border }]}>
            <Text
              variant="label"
              accessibilityRole="header"
              style={[styles.section, styles.newTitle, { color: c.onAccentSubtle }]}
            >
              {t('notifications.new')}
            </Text>
            {fresh.map((n) => (
              <Row key={n.id} n={n} />
            ))}
          </View>
        ) : null}

        {older.length > 0 ? (
          <View>
            <Text variant="label" color="textSecondary" accessibilityRole="header" style={styles.section}>
              {t('notifications.older')}
            </Text>
            {older.map((n) => (
              <Row key={n.id} n={n} />
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
  header: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingHorizontal: space[4], paddingTop: space[4], paddingBottom: space[2] },
  title: { flex: 1 },
  content: { paddingBottom: space[12] },
  pad: { paddingHorizontal: space[4], paddingTop: space[6] },
  requests: { marginHorizontal: space[4], marginTop: space[2], borderWidth: stroke.rule },
  requestsTitle: { paddingHorizontal: space[3], paddingTop: 10, paddingBottom: space[1] },
  request: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: space[3], paddingVertical: space[2] },
  requestLast: { paddingBottom: space[3] },
  person: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48 },
  small: { minHeight: 48, height: 48, paddingHorizontal: space[3], borderWidth: stroke.rule },
  newBlock: { marginTop: space[4], borderTopWidth: stroke.rule, borderBottomWidth: stroke.rule, paddingBottom: 2 },
  newTitle: { paddingTop: space[3] },
  section: { paddingHorizontal: space[4], paddingTop: 14, paddingBottom: 2 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space[3], paddingHorizontal: space[4], paddingVertical: space[3], minHeight: 56 },
  avatar: { width: 40, height: 40 },
  noticeIcon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', right: -4, bottom: -4, width: 20, height: 20, alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1, minWidth: 0, gap: 2 },
  thumb: { width: 44, height: 44, overflow: 'hidden' },
  pressed: { opacity: 0.75 },
});
