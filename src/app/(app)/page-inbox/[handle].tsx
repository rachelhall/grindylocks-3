import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/avatar';
import { timeAgo } from '@/components/post-card';
import { SuspendedNotice, useTeamErrorAlert } from '@/components/page-team';
import { PageTile } from '@/components/pages';
import { SafeAreaView } from '@/components/safe-area';
import { BackButton, Button, Icon, Toggle, useActionSheet } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { useMyPages, useSetPageInboxPush } from '@/lib/claims';
import { type InboxItem, roleRank, useMarkInboxSeen, usePageBlock, usePageFollowerCount, usePageInbox } from '@/lib/page-team';
import { type Page, usePage, usePageViewerState } from '@/lib/pages';
import { brand, fontFamily, space, Text, useColors } from '@/theme';

/**
 * A page's inbox (Page-Inbox mockup, part A PR 7a), for everyone on the
 * team: the follower number (only the team sees it, nobody sees who), then
 * New since you last looked and Earlier: the @mentions of the page from
 * captions, comments and meetup comments (by people, or by other pages),
 * and since PR 8b comments on the page's posts, grouped per post ("thea and
 * 2 others commented on 8SET's post"), and replies to the page's comments.
 *
 * Managers and the owner can block someone from the page from a row's ⋯.
 * The push switch is yours alone, off by default.
 */
export default function PageInboxScreen() {
  const { t } = useTranslation();
  const c = useColors();
  const { handle } = useLocalSearchParams<{ handle: string }>();
  const { session } = useAuth();
  const { data: page, isError, refetch } = usePage(handle);
  const viewer = usePageViewerState(session?.user.id, page?.id);
  if (!page || !viewer.data) {
    return (
      <SafeAreaView style={[styles.screen, { backgroundColor: c.surface }]}>
        <View style={styles.top}>
          <BackButton />
        </View>
        {isError || viewer.isError ? (
          <View style={styles.block}>
            <Text variant="body" color="textSecondary">
              {t('errors.network')}
            </Text>
            <Button label={t('common.retry')} onPress={() => void refetch()} />
          </View>
        ) : (
          <ActivityIndicator color={c.text} accessibilityLabel={t('common.loading')} style={styles.loading} />
        )}
      </SafeAreaView>
    );
  }
  if (!viewer.data.teamRole) {
    return (
      <SafeAreaView style={[styles.screen, { backgroundColor: c.surface }]}>
        <View style={styles.top}>
          <BackButton />
        </View>
        <View style={styles.block}>
          <Text variant="body" color="textSecondary">
            {t('pageEdit.notYours')}
          </Text>
        </View>
      </SafeAreaView>
    );
  }
  return <Inbox page={page} canBlock={roleRank(viewer.data.teamRole) >= 2 && page.state === 'managed'} />;
}

function Inbox({ page, canBlock }: { page: Page; canBlock: boolean }) {
  const { t, i18n } = useTranslation();
  const c = useColors();
  const { session } = useAuth();
  const userId = session?.user.id;
  const name = page.displayName;
  const inbox = usePageInbox(userId, page.id);
  const followers = usePageFollowerCount(page.id);
  const myPages = useMyPages(userId);
  const setPush = useSetPageInboxPush(userId);
  const markSeen = useMarkInboxSeen(page.id, userId);
  const block = usePageBlock(page.id, userId);
  const alertError = useTeamErrorAlert();
  const actions = useActionSheet();
  const pushOn = myPages.data?.find((p) => p.pageId === page.id)?.inboxPush ?? false;

  // Opening the inbox marks it seen; this visit still shows what's New.
  const marked = useRef(false);
  const mark = markSeen.mutate;
  useFocusEffect(
    useCallback(() => {
      if (marked.current) return;
      marked.current = true;
      mark();
    }, [mark]),
  );

  const items = inbox.data ?? [];
  const fresh = group(items.filter((i) => i.unread));
  const earlier = group(items.filter((i) => !i.unread));

  const open = (item: InboxItem) => {
    if (item.eventId) return router.push({ pathname: '/meetup/[id]', params: { id: item.eventId } });
    if (item.postId) router.push({ pathname: '/post/[id]', params: { id: item.postId, ...(item.commentId ? { comments: '1' } : {}) } });
  };
  const sentence = (row: InboxRow) => {
    const item = row.items[0];
    const username = authorName(item) ?? t('common.deletedUser');
    if (item.kind === 'post_comment') {
      return row.others > 0
        ? t('pageInbox.postComments', { username, name, count: row.others })
        : t('pageInbox.postComment', { username, name });
    }
    if (item.kind === 'reply') return t('pageInbox.reply', { username, name });
    if (item.kind === 'meetup_comment') return t('pageInbox.meetupComment', { username, name, meetup: item.eventTitle ?? '' });
    return t(item.kind === 'comment' ? 'pageInbox.comment' : 'pageInbox.caption', { username, name });
  };
  const options = (item: InboxItem) => {
    const username = item.authorUsername;
    const list: { label: string; onPress: () => void; destructive?: boolean }[] = [];
    // Written by another page: open it; pages can't be blocked from a page.
    if (item.authorPage) {
      const handle = item.authorPage.handle;
      list.push({ label: t('pageInbox.viewPage'), onPress: () => router.push({ pathname: '/page/[handle]', params: { handle } }) });
      actions.show({ title: item.authorPage.displayName, actions: list });
      return;
    }
    if (username) list.push({ label: t('pageInbox.viewProfile'), onPress: () => router.push({ pathname: '/profile/[username]', params: { username } }) });
    if (canBlock && item.authorId)
      list.push({
        label: t('pageInbox.block', { name }),
        destructive: true,
        onPress: () =>
          Alert.alert(t('pageInbox.blockConfirm', { username: username ?? '', name }), t('pageInbox.blockBody', { name }), [
            { text: t('common.cancel'), style: 'cancel' },
            {
              text: t('block.block'),
              style: 'destructive',
              onPress: () => block.mutate({ who: item.authorId!, on: true }, { onSuccess: () => void inbox.refetch(), onError: (err) => void alertError(err) }),
            },
          ]),
      });
    actions.show({ title: username ?? undefined, actions: list });
  };

  const row = (entry: InboxRow) => {
    const item = entry.items[0];
    const mention = item.kind === 'caption' || item.kind === 'comment' || item.kind === 'meetup_comment';
    return (
    <View key={entry.key} style={[styles.row, { borderBottomColor: c.borderSubtle }, item.unread && { backgroundColor: c.accentSubtle }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${sentence(entry)}. ${item.body ?? ''}. ${timeAgo(item.createdAt, t, i18n.language)}`}
        onPress={() => open(item)}
        style={({ pressed }) => [styles.rowMain, pressed && styles.pressed]}
      >
        <View>
          {item.authorPage ? (
            <PageTile page={item.authorPage} size={40} />
          ) : (
            <Avatar path={item.authorAvatarPath} username={item.authorUsername ?? '?'} size={40} />
          )}
          <View style={[styles.badge, { backgroundColor: mention ? brand.pink : brand.ink }]}>
            {mention ? (
              <Text variant="caption" style={{ color: brand.ink, fontFamily: fontFamily.sansSemiBold }}>
                @
              </Text>
            ) : (
              <Icon name="badgeComment" color={brand.paper} size={12} />
            )}
          </View>
        </View>
        <View style={styles.flex}>
          <Text variant="bodySm" style={{ color: item.unread ? c.onAccentSubtle : c.text, fontFamily: fontFamily.sansSemiBold }}>
            {sentence(entry)}
          </Text>
          {item.body ? (
            <Text variant="bodySm" numberOfLines={3} style={{ color: item.unread ? c.onAccentSubtle : c.textSecondary }}>
              “{item.body}”
            </Text>
          ) : null}
          <Text variant="caption" style={{ color: item.unread ? c.onAccentSubtle : c.textSecondary }}>
            {timeAgo(item.createdAt, t, i18n.language)}
          </Text>
        </View>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('pageInbox.options', { username: authorName(item) ?? '' })}
        onPress={() => options(item)}
        hitSlop={4}
        style={({ pressed }) => [styles.more, pressed && styles.pressed]}
      >
        <Icon name="more" color={item.unread ? c.onAccentSubtle : c.text} />
      </Pressable>
    </View>
    );
  };

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: c.surface }]}>
      <View style={styles.top}>
        <BackButton />
        <View style={styles.flex}>
          <Text variant="label" color="textSecondary">
            {name}
          </Text>
          <Text variant="title" accessibilityRole="header" style={styles.upper}>
            {t('pageTeam.bar.inbox')}
          </Text>
        </View>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        {/* Rachel's suspension notice, pinned here too (PR 6b). */}
        <SuspendedNotice page={page} last />
        <View style={[styles.followers, { backgroundColor: brand.ink }]} accessible accessibilityLabel={`${t('pageInbox.followersLine', { count: followers.data ?? 0, name })}. ${t('pageInbox.followersNote')}`}>
          <View>
            <Text variant="display" style={[styles.count, { color: brand.pink }]} accessibilityElementsHidden>
              {followers.data ?? '–'}
            </Text>
            <Text variant="display" style={[styles.count, styles.countTop, { color: brand.paper }]}>
              {followers.data ?? '–'}
            </Text>
          </View>
          <View style={styles.flex}>
            <Text variant="headline" style={{ color: brand.paper }}>
              {t('pageInbox.followersLine', { count: followers.data ?? 0, name })}
            </Text>
            <Text variant="caption" style={{ color: brand.paper, opacity: 0.8 }}>
              {t('pageInbox.followersNote')}
            </Text>
          </View>
        </View>

        {inbox.isPending ? <ActivityIndicator color={c.text} accessibilityLabel={t('common.loading')} style={styles.loading} /> : null}
        {inbox.isError ? (
          <View style={styles.block}>
            <Text variant="body" color="statusClosed">
              {t('errors.network')}
            </Text>
            <Button variant="secondary" label={t('common.retry')} onPress={() => void inbox.refetch()} />
          </View>
        ) : null}
        {inbox.data && items.length === 0 ? (
          <Text variant="body" color="textSecondary" style={styles.empty}>
            {t('pageInbox.empty', { name })}
          </Text>
        ) : null}
        {fresh.length > 0 ? (
          <>
            <Text variant="label" color="textSecondary" accessibilityRole="header" style={styles.heading}>
              {t('pageInbox.new')}
            </Text>
            <View style={[styles.group, { borderTopColor: c.borderSubtle }]}>{fresh.map(row)}</View>
          </>
        ) : null}
        {earlier.length > 0 ? (
          <>
            <Text variant="label" color="textSecondary" accessibilityRole="header" style={styles.heading}>
              {t('pageInbox.earlier')}
            </Text>
            <View style={[styles.group, { borderTopColor: c.borderSubtle }]}>{earlier.map(row)}</View>
          </>
        ) : null}

        <View style={[styles.pushRow, { borderTopColor: c.borderSubtle }]}>
          <View style={styles.flex}>
            <Text variant="body" style={{ fontFamily: fontFamily.sansSemiBold }}>
              {t('pageInbox.push')}
            </Text>
            <Text variant="caption" color="textSecondary">
              {t('pageInbox.pushBody')}
            </Text>
          </View>
          <Toggle
            value={pushOn}
            onChange={(next) => setPush.mutate({ pageId: page.id, enabled: next }, { onError: () => Alert.alert(t('errors.generic'), t('errors.network')) })}
            label={t('pageInbox.push')}
            fg={c.text}
          />
        </View>
      </ScrollView>
      {actions.sheet}
    </SafeAreaView>
  );
}

/** One inbox row: a mention or reply on its own, or a post's comments together. */
type InboxRow = { key: string; items: InboxItem[]; others: number };

/** A person's username or the writing page's name. */
const authorName = (item: InboxItem) => item.authorPage?.displayName ?? item.authorUsername;

/**
 * Groups comments on the same post of the page (newest first, as they come),
 * so "thea and 2 others commented on 8SET's post" is one row; the newest
 * comment leads. Mentions and replies stay one row each.
 */
function group(items: InboxItem[]): InboxRow[] {
  const rows: InboxRow[] = [];
  const byPost = new Map<string, InboxRow>();
  for (const item of items) {
    if (item.kind === 'post_comment' && item.postId) {
      const existing = byPost.get(item.postId);
      if (existing) {
        existing.items.push(item);
        continue;
      }
      const row: InboxRow = { key: `p:${item.postId}`, items: [item], others: 0 };
      byPost.set(item.postId, row);
      rows.push(row);
      continue;
    }
    rows.push({ key: item.id, items: [item], others: 0 });
  }
  for (const row of rows) {
    const who = new Set(row.items.map((i) => i.authorPage?.id ?? i.authorId ?? i.id));
    row.others = who.size - 1;
  }
  return rows;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1 },
  pressed: { opacity: 0.75 },
  upper: { textTransform: 'uppercase' },
  top: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingHorizontal: space[4], paddingTop: space[2] },
  block: { paddingHorizontal: space[4], gap: space[3], paddingTop: space[4] },
  loading: { marginTop: space[6] },
  content: { paddingTop: space[4], paddingBottom: space[12] },
  followers: { marginHorizontal: space[4], paddingHorizontal: 14, paddingVertical: space[3], flexDirection: 'row', alignItems: 'center', gap: space[3] },
  count: { fontSize: 30, lineHeight: 32, position: 'absolute', top: 2, left: 2 },
  countTop: { position: 'relative', top: 0, left: 0 },
  empty: { paddingHorizontal: space[4], paddingTop: space[6] },
  heading: { paddingHorizontal: space[4], paddingTop: space[4], paddingBottom: 6 },
  group: { borderTopWidth: 1 },
  row: { flexDirection: 'row', alignItems: 'flex-start', borderBottomWidth: 1 },
  rowMain: { flex: 1, flexDirection: 'row', gap: space[3], paddingLeft: space[4], paddingVertical: space[3] },
  badge: { position: 'absolute', right: -6, bottom: -6, width: 20, height: 20, alignItems: 'center', justifyContent: 'center' },
  more: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', marginTop: space[1] },
  pushRow: { marginHorizontal: space[4], marginTop: space[6], minHeight: 56, borderTopWidth: 1, flexDirection: 'row', alignItems: 'center', gap: space[3] },
});
