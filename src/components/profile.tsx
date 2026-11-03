import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { type ReactNode, useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Alert,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from '@/components/safe-area';

import { MediaTag } from '@/components/media';
import { ParkRow, useParkLine } from '@/components/parks';
import { BackButton, Button, Icon, useActionSheet } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { formatDuration, videoThumbnailUrl } from '@/lib/media';
import { useParksByIds, useSavedParks } from '@/lib/parks';
import { toGridPost, useFilmedPosts, useTaggedPosts } from '@/lib/posts';
import {
  type GridPost,
  type Profile,
  type RoleBadge,
  useAvatarUrl,
  useMyProfile,
  useProfile,
  useProfilePosts,
  visibleBadge,
} from '@/lib/profiles';
import { useBlock, useFollow, useMyInvites } from '@/lib/social';
import { fontFamily, size, space, stroke, Text, useColors } from '@/theme';

type Tab = 'posts' | 'tagged' | 'filmed' | 'saved';

/* Avatar ------------------------------------------------------------------------------- */

/** Square profile photo, or the first two letters of the username on a plain tile. */
export function Avatar({
  path,
  username,
  size: s = 84,
  localUri,
}: {
  path: string | null;
  username: string;
  size?: number;
  /** A photo picked but not saved yet (Edit profile). */
  localUri?: string | null;
}) {
  const c = useColors();
  const signed = useAvatarUrl(localUri ? null : path);
  const uri = localUri ?? signed;
  return (
    <View
      style={[styles.avatar, { width: s, height: s, backgroundColor: c.borderSubtle }]}
      accessibilityElementsHidden
      importantForAccessibility="no"
    >
      {uri ? (
        <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" accessibilityIgnoresInvertColors />
      ) : (
        <Text variant="display" style={{ fontSize: Math.round(s * 0.36), lineHeight: Math.round(s * 0.4) }}>
          {username.slice(0, 2).toUpperCase()}
        </Text>
      )}
    </View>
  );
}

/* Header -------------------------------------------------------------------------------- */

/** "Park admin · City Heights", or just "Owner". */
export function useRoleLabel() {
  const { t } = useTranslation();
  return (badge: RoleBadge) =>
    badge.role === 'owner' || !badge.place
      ? t(`profile.role.${badge.role}`)
      : t('profile.roleAt', { role: t(`profile.role.${badge.role}`), place: badge.place });
}

/** "Active today", "Active yesterday", "Active 3 days ago", then "Active Oct 2026". */
function useActiveLabel() {
  const { t, i18n } = useTranslation();
  return (iso: string) => {
    const then = new Date(iso);
    const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const days = Math.round((startOf(new Date()) - startOf(then)) / 86_400_000);
    if (days <= 0) return t('profile.activeToday');
    if (days === 1) return t('profile.activeYesterday');
    if (days < 30) return t('profile.activeDaysAgo', { count: days });
    return t('profile.activeOn', {
      date: new Intl.DateTimeFormat(i18n.language, { month: 'short', year: 'numeric' }).format(then),
    });
  };
}

function ProfileHeader({ profile, actions }: { profile: Profile; actions?: ReactNode }) {
  const { t, i18n } = useTranslation();
  const c = useColors();
  const roleLabel = useRoleLabel();
  const activeLabel = useActiveLabel();
  const badge = visibleBadge(profile);
  const joined = new Intl.DateTimeFormat(i18n.language, { month: 'short', year: 'numeric' }).format(
    new Date(profile.joinedAt),
  );
  const order = ['inline', 'quad', 'skateboard', 'bmx', 'scooter'] as const;

  return (
    <View style={styles.header}>
      <View style={styles.identity}>
        <Avatar path={profile.avatarPath} username={profile.username} />
        <View style={styles.identityText}>
          <Text variant="title" accessibilityRole="header" style={styles.username} numberOfLines={2}>
            {profile.username}
          </Text>
          <View style={styles.chips}>
            {order
              .filter((d) => profile.disciplines.includes(d))
              .map((d) => (
                <View key={d} style={[styles.chip, { backgroundColor: c.text }]}>
                  <Text variant="caption" style={{ color: c.surface, fontFamily: fontFamily.sansSemiBold }}>
                    {t(`disciplines.${d}`)}
                  </Text>
                </View>
              ))}
            {badge ? (
              <View style={[styles.chip, { backgroundColor: c.role }]}>
                <Text variant="label" style={{ color: c.onRole }}>
                  {roleLabel(badge)}
                </Text>
              </View>
            ) : null}
          </View>
        </View>
      </View>

      <View style={styles.details}>
        {profile.homeMetro ? (
          <View style={styles.place}>
            <Icon name="pin" color={c.text} size={16} />
            <Text variant="bodySm" style={styles.shrink}>
              {profile.homeMetro.name}
              {profile.homePark ? (
                <>
                  {` · ${t('profile.homePark')} `}
                  <Text
                    variant="bodySm"
                    color="accentText"
                    accessibilityRole="link"
                    style={{ fontFamily: fontFamily.sansSemiBold }}
                    onPress={() =>
                      router.push({ pathname: '/park/[slug]', params: { slug: profile.homePark!.slug } })
                    }
                  >
                    {profile.homePark.name}
                  </Text>
                </>
              ) : null}
            </Text>
          </View>
        ) : null}
        <Text variant="bodySm" color="textSecondary">
          {`${t('profile.joined', { date: joined })} · ${activeLabel(profile.lastActiveAt)}`}
        </Text>
      </View>

      {profile.bio ? <Text variant="bodySm">{profile.bio}</Text> : null}

      {profile.openToMeetup ? (
        <View style={[styles.meetup, { borderColor: c.border }]}>
          <Text variant="caption" style={{ fontFamily: fontFamily.sansSemiBold }}>
            {t('profile.openToMeetup')}
          </Text>
        </View>
      ) : null}

      {actions}
    </View>
  );
}

/** Edit profile and Invites, side by side under your own bio. */
function OwnActions({ userId }: { userId: string }) {
  const { t } = useTranslation();
  const { data } = useMyInvites(userId);
  return (
    <View style={styles.actionRow}>
      <Button
        label={t('profile.edit')}
        variant="secondary"
        onPress={() => router.push('/edit-profile')}
        style={styles.ownButton}
      />
      <Button
        label={data && data.remaining !== null ? t('profile.invitesCount', { count: data.remaining }) : t('profile.invites')}
        variant="secondary"
        onPress={() => router.push('/invites')}
        style={styles.ownButton}
      />
    </View>
  );
}

/**
 * Follow, Requested (private accounts) or Following. Following and Requested
 * ask before undoing, since a private account would have to accept again.
 */
function FollowButton({ viewerId, profile }: { viewerId: string; profile: Profile }) {
  const { t } = useTranslation();
  const follow = useFollow(viewerId, profile);
  const status = profile.followStatus;
  const onError = () => Alert.alert(t('errors.generic'), t('errors.network'));

  function press() {
    if (!status) {
      follow.mutate('follow', { onError });
      return;
    }
    const pending = status === 'pending';
    Alert.alert(
      pending ? t('follow.cancelRequestTitle') : t('follow.unfollowTitle', { username: profile.username }),
      pending || !profile.isPrivate ? undefined : t('follow.unfollowPrivateBody'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: pending ? t('follow.cancelRequest') : t('follow.unfollow'),
          style: 'destructive',
          onPress: () => follow.mutate('unfollow', { onError }),
        },
      ],
    );
  }

  return (
    <Button
      label={status === 'accepted' ? t('find.following') : status === 'pending' ? t('find.requested') : t('follow.follow')}
      variant={status ? 'secondary' : 'primary'}
      onPress={press}
      style={styles.editButton}
    />
  );
}

/* Tabs ---------------------------------------------------------------------------------- */

function ProfileTabs({ tabs, current, onChange }: { tabs: Tab[]; current: Tab; onChange: (tab: Tab) => void }) {
  const { t } = useTranslation();
  const c = useColors();
  return (
    <View accessibilityRole="tablist" style={[styles.tabs, { borderBottomColor: c.borderSubtle }]}>
      {tabs.map((tab) => {
        const on = tab === current;
        const label = t(`profile.tabs.${tab}`);
        return (
          <Pressable
            key={tab}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={tab === 'saved' ? `${label}, ${t('profile.onlyYou')}` : label}
            onPress={() => onChange(tab)}
            style={({ pressed }) => [styles.tab, pressed && styles.pressed]}
          >
            <View style={styles.tabLabel}>
              {tab === 'saved' ? <Icon name="lock" color={on ? c.text : c.textSecondary} size={14} /> : null}
              <Text
                variant="body"
                color={on ? 'text' : 'textSecondary'}
                style={{ fontFamily: on ? fontFamily.display : fontFamily.sansSemiBold, fontSize: 15 }}
              >
                {label}
              </Text>
            </View>
            <View style={[styles.tabLine, { backgroundColor: on ? c.text : 'transparent' }]} />
          </Pressable>
        );
      })}
    </View>
  );
}

/* Posts grid ------------------------------------------------------------------------------- */

const GRID_GAP = 3;

/**
 * Three columns, each post at its first slide's stored aspect ratio (never
 * cropped), placed in whichever column is shortest so far.
 */
/**
 * Three-column masonry grid of posts, each tile at its first slide's shape
 * (never cropped to a square). Used by profiles, park pages and obstacle feeds.
 */
export function MasonryGrid({ posts, width }: { posts: GridPost[]; width: number }) {
  const columnWidth = (width - GRID_GAP * 2) / 3;
  const columns = useMemo(() => {
    const cols: { post: GridPost; height: number }[][] = [[], [], []];
    const heights = [0, 0, 0];
    for (const post of posts) {
      const ratio = post.cover && post.cover.width > 0 ? post.cover.height / post.cover.width : 1;
      const height = columnWidth * ratio;
      const i = heights.indexOf(Math.min(...heights));
      cols[i].push({ post, height });
      heights[i] += height + GRID_GAP;
    }
    return cols;
  }, [posts, columnWidth]);

  return (
    <View style={styles.grid}>
      {columns.map((col, i) => (
        <View key={i} style={[styles.column, { width: columnWidth }]}>
          {col.map(({ post, height }) => (
            <GridTile key={post.id} post={post} width={columnWidth} height={height} />
          ))}
        </View>
      ))}
    </View>
  );
}

function GridTile({ post, width, height }: { post: GridPost; width: number; height: number }) {
  const { t, i18n } = useTranslation();
  const c = useColors();
  const cover = post.cover;
  const uri =
    cover?.kind === 'photo'
      ? cover.photoUrl
      : cover?.videoKey
        ? (videoThumbnailUrl(cover.videoKey, 480) ?? undefined)
        : undefined;
  const date = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(new Date(post.publishedAt));
  const tag =
    cover?.kind === 'video' && cover.durationS
      ? formatDuration(cover.durationS)
      : post.slideCount > 1
        ? `1 / ${post.slideCount}`
        : null;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t(cover?.kind === 'video' ? 'profile.clipLabel' : 'profile.postLabel', { date })}
      onPress={() => router.push({ pathname: '/post/[id]', params: { id: post.id } })}
      style={({ pressed }) => [{ width, height, backgroundColor: c.surfaceSunk }, pressed && styles.pressed]}
    >
      {uri ? (
        <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" accessibilityIgnoresInvertColors />
      ) : (
        <View style={styles.tileEmpty}>
          <Icon name={cover?.kind === 'video' ? 'video' : 'photo'} color={c.textSecondary} size={20} />
        </View>
      )}
      {tag ? <MediaTag label={tag} style={styles.tileTag} /> : null}
      {post.byline ? <MediaTag label={post.byline} style={styles.tileByline} /> : null}
    </Pressable>
  );
}

/* Saved parks -------------------------------------------------------------------------------- */

/** Your "want to skate" parks, A to Z, with the same rows and bookmarks as Search. */
function SavedParks({ userId }: { userId: string }) {
  const { t } = useTranslation();
  const c = useColors();
  const parkLine = useParkLine();
  const { saved, toggle } = useSavedParks(userId);
  const ids = useMemo(() => [...saved], [saved]);
  const { data: parks, isPending, isError, refetch } = useParksByIds(ids);

  if (ids.length === 0) return <EmptyTab text={t('profile.emptySaved')} />;
  if (isError && !parks) {
    return (
      <View style={styles.empty}>
        <Text variant="body" color="statusClosed">
          {t('errors.network')}
        </Text>
        <Button label={t('common.retry')} variant="secondary" onPress={() => void refetch()} />
      </View>
    );
  }
  if (isPending) return <ActivityIndicator style={styles.loading} color={c.text} accessibilityLabel={t('common.loading')} />;

  return (
    <View style={styles.savedList}>
      <Text variant="caption" color="textSecondary">
        {t('profile.onlyYou')}
      </Text>
      {(parks ?? [])
        .filter((p) => saved.has(p.id))
        .map((p) => (
          <ParkRow
            key={p.id}
            name={p.display_name}
            line={parkLine(p, p.city)}
            status={p.status}
            saved
            onPress={() => router.push({ pathname: '/park/[slug]', params: { slug: p.slug } })}
            onSave={() => void toggle(p.id)}
          />
        ))}
    </View>
  );
}

/** A tab of posts in a masonry grid, with loading, error and empty states. */
function GridTab({
  query,
  posts,
  width,
  empty,
}: {
  query: { isPending: boolean; isError: boolean; isFetchingNextPage: boolean; refetch: () => unknown };
  posts: GridPost[];
  width: number;
  empty: string;
}) {
  const { t } = useTranslation();
  const c = useColors();
  if (query.isPending) {
    return <ActivityIndicator style={styles.loading} color={c.text} accessibilityLabel={t('common.loading')} />;
  }
  if (query.isError && posts.length === 0) {
    return (
      <View style={styles.empty}>
        <Text variant="body" color="statusClosed">
          {t('errors.network')}
        </Text>
        <Button label={t('common.retry')} variant="secondary" onPress={() => void query.refetch()} />
      </View>
    );
  }
  if (posts.length === 0) return <EmptyTab text={empty} />;
  return (
    <>
      <MasonryGrid posts={posts} width={width} />
      {query.isFetchingNextPage ? <ActivityIndicator style={styles.more} color={c.text} /> : null}
    </>
  );
}

function EmptyTab({ text, icon }: { text: string; icon?: 'lock' }) {
  const c = useColors();
  return (
    <View style={styles.empty}>
      {icon ? <Icon name={icon} color={c.text} size={28} /> : null}
      <Text variant="body" color="textSecondary" style={styles.center}>
        {text}
      </Text>
    </View>
  );
}

/* The whole screen ------------------------------------------------------------------------------ */

/**
 * A profile. Without a username it's your own (the You tab): a settings gear,
 * Edit profile and a private Saved tab. With one, it's that member's, unless
 * it turns out to be you.
 */
export function ProfileView({ username }: { username?: string }) {
  const { t } = useTranslation();
  const c = useColors();
  const { width } = useWindowDimensions();
  const { session } = useAuth();
  const myId = session?.user.id;

  const mine = useMyProfile(username ? undefined : myId);
  const theirs = useProfile(username, myId);
  const query = username ? theirs : mine;
  const profile = query.data;
  const isMe = Boolean(profile && profile.id === myId);

  const canSeePosts = Boolean(
    profile && (isMe || !profile.isPrivate || profile.followStatus === 'accepted'),
  );
  const [tab, setTab] = useState<Tab>('posts');
  const posts = useProfilePosts(profile?.id, canSeePosts);
  // Tagged and Filmed load when their tab is first opened.
  const [opened, setOpened] = useState<Set<Tab>>(() => new Set(['posts']));
  const tagged = useTaggedPosts(profile?.id, canSeePosts && opened.has('tagged'));
  const filmed = useFilmedPosts(profile?.id, canSeePosts && opened.has('filmed'));
  function openTab(next: Tab) {
    setTab(next);
    setOpened((prev) => (prev.has(next) ? prev : new Set([...prev, next])));
  }
  const tabs: Tab[] = isMe ? ['posts', 'tagged', 'filmed', 'saved'] : ['posts', 'tagged', 'filmed'];

  // Your own data is checked again whenever the screen comes back into view.
  const refetchProfile = query.refetch;
  const refetchPosts = posts.refetch;
  const focusedOnce = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (focusedOnce.current) {
        void refetchProfile();
        void refetchPosts();
      }
      focusedOnce.current = true;
    }, [refetchProfile, refetchPosts]),
  );

  const [refreshing, setRefreshing] = useState(false);
  async function refresh() {
    setRefreshing(true);
    await Promise.all([
      query.refetch(),
      canSeePosts ? posts.refetch() : null,
      canSeePosts && opened.has('tagged') ? tagged.refetch() : null,
      canSeePosts && opened.has('filmed') ? filmed.refetch() : null,
    ]);
    setRefreshing(false);
  }

  function onScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
    const nearEnd = layoutMeasurement.height + contentOffset.y >= contentSize.height - 600;
    if (!nearEnd) return;
    const active = tab === 'posts' ? posts : tab === 'tagged' ? tagged : tab === 'filmed' ? filmed : null;
    if (active?.hasNextPage && !active.isFetchingNextPage) void active.fetchNextPage();
  }

  const gridPosts = useMemo(() => posts.data?.pages.flat() ?? [], [posts.data]);
  const taggedPosts = useMemo(() => (tagged.data?.pages.flat() ?? []).map(toGridPost), [tagged.data]);
  // Filmed tiles name the poster, since the filmer isn't the one who posted.
  const filmedPosts = useMemo(
    () =>
      (filmed.data?.pages.flat() ?? []).map((p) => ({
        ...toGridPost(p),
        byline: p.author?.username ?? null,
      })),
    [filmed.data],
  );

  const { sheet, show } = useActionSheet();
  const block = useBlock(myId);
  function confirmBlock(person: Profile) {
    Alert.alert(t('block.title', { username: person.username }), t('block.body'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('block.block'),
        style: 'destructive',
        onPress: () =>
          block.mutate(
            { personId: person.id, block: true },
            {
              // They disappear for you, so there's nothing left to show here.
              onSuccess: () => (router.canGoBack() ? router.back() : router.replace('/home')),
              onError: () => Alert.alert(t('errors.generic'), t('errors.network')),
            },
          ),
      },
    ]);
  }

  const topBar = (
    <View style={[styles.topBar, { justifyContent: username ? 'space-between' : 'flex-end' }]}>
      {username ? <BackButton /> : null}
      {!username || isMe ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('settings.title')}
          onPress={() => router.push('/settings')}
          style={({ pressed }) => [styles.square, { backgroundColor: c.surfaceRaised }, pressed && styles.pressed]}
        >
          <Icon name="settings" color={c.text} />
        </Pressable>
      ) : profile ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('profile.more')}
          onPress={() =>
            show({
              title: profile.username,
              actions: [{ label: t('block.block'), destructive: true, onPress: () => confirmBlock(profile) }],
            })
          }
          style={({ pressed }) => [styles.square, { backgroundColor: c.surfaceRaised }, pressed && styles.pressed]}
        >
          <Icon name="more" color={c.text} />
        </Pressable>
      ) : null}
    </View>
  );

  let body: ReactNode;
  if (query.isPending && !profile) {
    body = <ActivityIndicator style={styles.loading} color={c.text} accessibilityLabel={t('common.loading')} />;
  } else if (query.isError && !profile) {
    body = (
      <View style={styles.empty}>
        <Text variant="body" color="statusClosed">
          {t('errors.network')}
        </Text>
        <Button label={t('common.retry')} variant="secondary" onPress={() => void query.refetch()} />
      </View>
    );
  } else if (!profile) {
    body = <EmptyTab text={t('profile.unavailable')} />;
  } else {
    const name = profile.username;
    body = (
      <>
        <ProfileHeader
          profile={profile}
          actions={
            isMe && myId ? <OwnActions userId={myId} /> : myId ? <FollowButton viewerId={myId} profile={profile} /> : null
          }
        />
        {!canSeePosts ? (
          <EmptyTab icon="lock" text={t('profile.privateBody')} />
        ) : (
          <>
            <ProfileTabs tabs={tabs} current={tab} onChange={openTab} />
            {tab === 'posts' ? (
              posts.isPending ? (
                <ActivityIndicator style={styles.loading} color={c.text} accessibilityLabel={t('common.loading')} />
              ) : posts.isError && gridPosts.length === 0 ? (
                <View style={styles.empty}>
                  <Text variant="body" color="statusClosed">
                    {t('errors.network')}
                  </Text>
                  <Button label={t('common.retry')} variant="secondary" onPress={() => void posts.refetch()} />
                </View>
              ) : gridPosts.length === 0 ? (
                <EmptyTab text={isMe ? t('profile.emptyPostsOwn') : t('profile.emptyPosts', { username: name })} />
              ) : (
                <>
                  <MasonryGrid posts={gridPosts} width={width} />
                  {posts.isFetchingNextPage ? <ActivityIndicator style={styles.more} color={c.text} /> : null}
                </>
              )
            ) : tab === 'tagged' ? (
              <GridTab
                query={tagged}
                posts={taggedPosts}
                width={width}
                empty={isMe ? t('profile.emptyTaggedOwn') : t('profile.emptyTagged', { username: name })}
              />
            ) : tab === 'filmed' ? (
              <GridTab
                query={filmed}
                posts={filmedPosts}
                width={width}
                empty={isMe ? t('profile.emptyFilmedOwn') : t('profile.emptyFilmed', { username: name })}
              />
            ) : myId ? (
              <SavedParks userId={myId} />
            ) : null}
          </>
        )}
      </>
    );
  }

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.screen, { backgroundColor: c.surface }]}>
      {topBar}
      <ScrollView
        contentContainerStyle={styles.content}
        onScroll={onScroll}
        scrollEventThrottle={200}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={c.text} />}
      >
        {body}
      </ScrollView>
      {sheet}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingBottom: space[12] },
  pressed: { opacity: 0.75 },
  topBar: { flexDirection: 'row', paddingHorizontal: space[4], paddingTop: space[4] },
  square: { width: size.tapMin, height: size.tapMin, alignItems: 'center', justifyContent: 'center' },
  loading: { marginTop: space[12] },
  more: { marginVertical: space[4] },
  avatar: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  header: { paddingHorizontal: 20, paddingTop: space[1], gap: space[3] },
  identity: { flexDirection: 'row', alignItems: 'center', gap: space[4] },
  identityText: { flex: 1, minWidth: 0, gap: 6 },
  username: { fontSize: 26, lineHeight: 26 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' },
  chip: { paddingHorizontal: space[2], paddingVertical: 3 },
  details: { gap: space[1] },
  place: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  shrink: { flexShrink: 1 },
  meetup: { alignSelf: 'flex-start', borderWidth: stroke.rule, paddingHorizontal: 6, paddingVertical: 1 },
  editButton: { minHeight: size.tapMin },
  actionRow: { flexDirection: 'row', gap: space[2] },
  ownButton: { minHeight: size.tapMin, flex: 1 },
  tabs: {
    flexDirection: 'row',
    gap: space[2],
    marginTop: space[4],
    paddingHorizontal: space[3],
    borderBottomWidth: stroke.rule,
  },
  tab: { minHeight: size.tapMin, minWidth: size.tapMin, paddingHorizontal: space[2], justifyContent: 'flex-end' },
  tabLabel: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingBottom: space[2] },
  tabLine: { height: 3, marginBottom: -stroke.rule },
  grid: { flexDirection: 'row', gap: GRID_GAP, paddingTop: space[1], alignItems: 'flex-start' },
  column: { gap: GRID_GAP },
  tileEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  tileTag: { left: 6, bottom: 6 },
  tileByline: { left: 6, top: 6, maxWidth: '85%' },
  empty: { alignItems: 'center', gap: space[3], paddingHorizontal: space[6], paddingTop: space[8] },
  center: { textAlign: 'center' },
  savedList: { gap: 6, padding: space[4] },
});
