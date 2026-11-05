import { useQueryClient } from '@tanstack/react-query';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  RefreshControl,
  StyleSheet,
  useWindowDimensions,
  View,
  type ViewToken,
} from 'react-native';
import { SafeAreaView } from '@/components/safe-area';

import { EmptyState } from '@/components/empty-state';
import { FeedHeader } from '@/components/feed';
import { UploadCard } from '@/components/media';
import { MeetupFeedCard } from '@/components/meetup-card';
import { PostCard } from '@/components/post-card';
import { SkaterStrip } from '@/components/suggestions';
import { Button, Icon } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { useNotificationsUnread } from '@/lib/engagement';
import { type MeetupCard, useHomeMeetups } from '@/lib/meetups';
import { useMetro, useSavedParks } from '@/lib/parks';
import { ActivePostContext } from '@/lib/playback';
import { type Post, useFollowingFeed, useNearbyFeed } from '@/lib/posts';
import { useAskForPushOnce } from '@/lib/push';
import { keys } from '@/lib/query';
import { useFollowing } from '@/lib/social';
import { useSkatersAtYourParks, useSkatersInMetro } from '@/lib/suggestions';
import { type PostJob, uploads, useUploads } from '@/lib/uploads';
import { fontFamily, space, stroke, Text, useColors } from '@/theme';

type Item =
  | { kind: 'upload'; job: PostJob }
  | { kind: 'label'; text: string }
  | { kind: 'post'; post: Post; section: 'following' | 'nearby' }
  | { kind: 'meetup'; meetup: MeetupCard }
  | { kind: 'caughtUp' }
  | { kind: 'noFollows' }
  | { kind: 'nothingNear' }
  | { kind: 'empty' };

const SIDE = space[4];

/**
 * Home (M4a, Feed-Home mockup): posts by people you follow (and yours),
 * newest first; once those run out, "You're caught up" and posts from your
 * home metro area by people you don't follow yet. Chronological, nothing
 * ranked. Uploads still in progress sit at the top.
 *
 * Meetups (v2): meetup cards from people you follow (and meetups you follow
 * or host) sit among those posts by when they were posted; a repeating
 * meetup's next date takes its place when the date before it ends. They
 * never appear in the Near you part.
 */
export default function Home() {
  const { t } = useTranslation();
  const c = useColors();
  const qc = useQueryClient();
  const { width } = useWindowDimensions();
  const { session, profile } = useAuth();
  // The first Home visit after onboarding asks for notifications, once.
  useAskForPushOnce(Boolean(session));
  const userId = session?.user.id;
  const metroId = profile?.home_metro_area_id ?? null;
  const metro = useMetro(metroId);
  const queued = useUploads();

  const following = useFollowingFeed(userId);
  const followingDone = following.isSuccess && !following.hasNextPage;
  const nearby = useNearbyFeed(userId, metroId, followingDone);
  // Cards newer than the oldest post loaded so far; all of them once the
  // posts from people you follow have run out.
  const followingPosts = following.data?.pages.flat();
  const oldestLoaded = followingDone ? null : (followingPosts?.[followingPosts.length - 1]?.publishedAt ?? null);
  const meetups = useHomeMeetups(userId, oldestLoaded, following.isSuccess);
  // When the cards were fetched: enough to tell which dates have passed.
  const [now, setNow] = useState(() => Date.now());
  const [refreshing, setRefreshing] = useState(false);

  // Following nobody yet (Empty states · Home feed): a plain card and a strip
  // of skaters near you above the Near you posts. Skaters come from your
  // parks' regulars lists, then your home city's.
  const followingPeople = useFollowing(userId);
  const followsNobody = followingPeople.isSuccess && followingPeople.data.length === 0;
  const { saved } = useSavedParks(userId);
  const savedIds = useMemo(() => [...saved], [saved]);
  const atParks = useSkatersAtYourParks(followsNobody ? userId : undefined, profile?.home_park_id, savedIds, 8);
  const inCity = useSkatersInMetro(followsNobody ? userId : undefined, metroId, null, 8);
  const skatersNear = atParks.people?.length ? atParks.people : (inCity.people ?? []);

  // The bell's dot: checked whenever Home comes back into view.
  const unread = useNotificationsUnread(userId);
  const refetchUnread = unread.refetch;
  useFocusEffect(
    useCallback(() => {
      void refetchUnread();
    }, [refetchUnread]),
  );

  // The post mostly on screen (60%) is the one whose clip plays; the first
  // one wins when two are.
  const [activePost, setActivePost] = useState<string | null>(null);
  const [viewability] = useState({ itemVisiblePercentThreshold: 60 });
  const onViewable = useCallback(({ viewableItems }: { viewableItems: ViewToken<Item>[] }) => {
    const first = viewableItems.find((v) => v.isViewable && v.item?.kind === 'post');
    setActivePost(first?.item?.kind === 'post' ? first.item.post.id : null);
  }, []);

  // A post that finished uploading shows up in the feed.
  const queuedIds = queued.map((q) => q.postId).join(',');
  const lastQueued = useRef(queuedIds);
  useEffect(() => {
    if (lastQueued.current === queuedIds) return;
    lastQueued.current = queuedIds;
    if (userId) void qc.invalidateQueries({ queryKey: keys.feedFollowing(userId) });
  }, [queuedIds, qc, userId]);

  const items = useMemo<Item[]>(() => {
    const out: Item[] = queued.map((job) => ({ kind: 'upload', job }));
    const mine = following.data?.pages.flat() ?? [];
    const near = nearby.data?.pages.flat() ?? [];
    const cards = meetups.data ?? [];
    const nearDone = nearby.isSuccess && !nearby.hasNextPage;
    if (followsNobody && !cards.length) out.push({ kind: 'noFollows' });
    if (mine.length || cards.length) {
      out.push({ kind: 'label', text: t('home.followingLabel') });
      // Both lists are newest first; merge them by time.
      let i = 0;
      for (const post of mine) {
        const at = post.publishedAt ?? post.createdAt;
        while (i < cards.length && cards[i].feed_at > at) out.push({ kind: 'meetup', meetup: cards[i++] });
        out.push({ kind: 'post', post, section: 'following' });
      }
      // Older cards wait until the posts around them load.
      if (followingDone) while (i < cards.length) out.push({ kind: 'meetup', meetup: cards[i++] });
    }
    if (followingDone) {
      if (mine.length || cards.length) out.push({ kind: 'caughtUp' });
      if (near.length) {
        out.push({ kind: 'label', text: t('home.nearLabel', { metro: metro.data?.name ?? '' }) });
        for (const post of near) out.push({ kind: 'post', post, section: 'nearby' });
      } else if (nearDone) {
        // Near you stays strictly local (Rachel, Nov 5): an empty metro area
        // says so rather than borrowing a neighbouring one's posts.
        out.push({ kind: mine.length || cards.length ? 'nothingNear' : 'empty' });
      }
    }
    return out;
  }, [queued, following.data, nearby.data, meetups.data, followingDone, nearby.isSuccess, nearby.hasNextPage, metro.data, followsNobody, t]);

  function loadMore() {
    if (following.hasNextPage) {
      if (!following.isFetchingNextPage) void following.fetchNextPage();
    } else if (followingDone && nearby.hasNextPage && !nearby.isFetchingNextPage) {
      void nearby.fetchNextPage();
    }
  }

  async function refresh() {
    setRefreshing(true);
    setNow(Date.now());
    await Promise.all([following.refetch(), meetups.refetch(), followingDone ? nearby.refetch() : null]);
    setRefreshing(false);
  }

  function confirmDiscard(postId: string) {
    Alert.alert(t('uploads.discardTitle'), t('uploads.discardBody'), [
      { text: t('post.cancel'), style: 'cancel' },
      { text: t('uploads.discard'), style: 'destructive', onPress: () => void uploads.discard(postId) },
    ]);
  }

  const loading =
    following.isLoading || (followingDone && nearby.isLoading) || following.isFetchingNextPage || nearby.isFetchingNextPage;
  const failed = following.isError || nearby.isError || meetups.isError;
  const cardWidth = width - SIDE * 2;
  const cityName = metro.data?.name ?? '';
  const seeParks = {
    label: cityName ? t('empty.seeParksIn', { city: cityName }) : t('empty.seeMap'),
    icon: 'map' as const,
    onPress: () => router.navigate(metroId ? { pathname: '/', params: { metro: metroId } } : '/'),
  };
  // Couldn't load anything at all: one plain message and Try again.
  const nothingLoaded = failed && !items.some((i) => i.kind === 'post' || i.kind === 'meetup');

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.screen, { backgroundColor: c.surface }]}>
      <FeedHeader title={t('home.title')} hasUnread={Boolean(unread.data)} />
      <ActivePostContext.Provider value={activePost}>
      <FlatList
        data={items}
        viewabilityConfig={viewability}
        onViewableItemsChanged={onViewable}
        keyExtractor={(item, i) =>
          item.kind === 'post'
            ? `${item.section}-${item.post.id}`
            : item.kind === 'meetup'
              ? `meetup-${item.meetup.id}`
              : item.kind === 'upload'
              ? `upload-${item.job.postId}`
              : `${item.kind}-${i}`
        }
        contentContainerStyle={styles.content}
        onEndReached={loadMore}
        onEndReachedThreshold={0.6}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={c.text} />}
        renderItem={({ item }) => {
          switch (item.kind) {
            case 'upload':
              return <UploadCard job={item.job} onDiscard={() => confirmDiscard(item.job.postId)} />;
            case 'label':
              return (
                <Text variant="label" color="textSecondary" accessibilityRole="header" style={styles.label}>
                  {item.text}
                </Text>
              );
            case 'post':
              return <PostCard post={item.post} width={cardWidth} />;
            case 'meetup':
              return <MeetupFeedCard m={item.meetup} now={now} viewerId={userId} />;
            case 'caughtUp':
              return (
                <View style={[styles.caughtUp, { borderTopColor: c.text }]}>
                  <Icon name="check" color={c.text} size={18} />
                  <Text variant="bodySm" style={styles.caughtUpText}>
                    {t('home.caughtUp')}
                  </Text>
                </View>
              );
            case 'noFollows':
              return (
                <View style={styles.noFollows}>
                  <View style={[styles.plainCard, { backgroundColor: c.surfaceRaised }]}>
                    <Text variant="headline" accessibilityRole="header">
                      {t('empty.notFollowingTitle')}
                    </Text>
                    <Text variant="bodySm" color="textSecondary">
                      {t('empty.notFollowingBody')}
                    </Text>
                  </View>
                  {skatersNear.length ? <SkaterStrip people={skatersNear} title={t('empty.skatersNearYou')} /> : null}
                </View>
              );
            case 'nothingNear':
              return (
                <EmptyState
                  variant="brand"
                  title={t('empty.nothingNearTitle')}
                  body={t('empty.nothingNearBody', { city: cityName })}
                  action={seeParks}
                />
              );
            case 'empty':
              return (
                <EmptyState
                  variant="brand"
                  title={t('empty.noPostsTitle')}
                  body={t('empty.noPostsBody', { city: cityName })}
                  action={seeParks}
                >
                  <Button
                    label={t('home.emptyFind')}
                    icon="findPeople"
                    variant="secondary"
                    palette={{ fill: c.surfaceRaised, text: c.text, border: c.border }}
                    onPress={() => router.navigate({ pathname: '/search', params: { filter: 'people' } })}
                    style={styles.secondAction}
                  />
                </EmptyState>
              );
          }
        }}
        ListEmptyComponent={
          nothingLoaded ? (
            <EmptyState
              icon="cloudOff"
              title={t('empty.cantLoadTitle')}
              body={t('empty.cantLoadBody')}
              action={{ label: t('empty.tryAgain'), onPress: () => void refresh() }}
            />
          ) : null
        }
        ListFooterComponent={
          failed && items.length > 0 ? (
            <View style={styles.footer}>
              <Text variant="bodySm" color="statusClosed">
                {t('home.loadError')}
              </Text>
              <Button label={t('common.retry')} variant="secondary" onPress={refresh} />
            </View>
          ) : loading ? (
            <ActivityIndicator style={styles.footer} color={c.text} />
          ) : null
        }
      />
      </ActivePostContext.Provider>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: SIDE, paddingTop: space[3], paddingBottom: space[12], gap: space[3] },
  label: { paddingTop: space[2] },
  caughtUp: { flexDirection: 'row', alignItems: 'center', gap: 6, borderTopWidth: stroke.rule, paddingTop: space[3], marginTop: space[3] },
  caughtUpText: { fontFamily: fontFamily.sansSemiBold },
  noFollows: { gap: space[4] },
  plainCard: { padding: space[4], gap: space[1] },
  secondAction: { minHeight: 48, alignSelf: 'stretch' },
  footer: { paddingVertical: space[6], gap: space[3] },
});
