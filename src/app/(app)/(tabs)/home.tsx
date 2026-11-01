import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, FlatList, RefreshControl, StyleSheet, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FeedHeader } from '@/components/feed';
import { UploadCard } from '@/components/media';
import { PostCard } from '@/components/post-card';
import { Button, Icon } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { useMetro } from '@/lib/parks';
import { type Post, useFollowingFeed, useNearbyFeed } from '@/lib/posts';
import { keys } from '@/lib/query';
import { type PostJob, uploads, useUploads } from '@/lib/uploads';
import { fontFamily, space, stroke, Text, useColors } from '@/theme';

type Item =
  | { kind: 'upload'; job: PostJob }
  | { kind: 'label'; text: string }
  | { kind: 'post'; post: Post; section: 'following' | 'nearby' }
  | { kind: 'caughtUp' }
  | { kind: 'empty' };

const SIDE = space[4];

/**
 * Home (M4a, Feed-Home mockup): posts by people you follow (and yours),
 * newest first; once those run out, "You're caught up" and posts from your
 * home metro area by people you don't follow yet. Chronological, nothing
 * ranked. Uploads still in progress sit at the top.
 */
export default function Home() {
  const { t } = useTranslation();
  const c = useColors();
  const qc = useQueryClient();
  const { width } = useWindowDimensions();
  const { session, profile } = useAuth();
  const userId = session?.user.id;
  const metroId = profile?.home_metro_area_id ?? null;
  const metro = useMetro(metroId);
  const queued = useUploads();

  const following = useFollowingFeed(userId);
  const followingDone = following.isSuccess && !following.hasNextPage;
  const nearby = useNearbyFeed(userId, metroId, followingDone);
  const [refreshing, setRefreshing] = useState(false);

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
    if (mine.length) {
      out.push({ kind: 'label', text: t('home.followingLabel') });
      for (const post of mine) out.push({ kind: 'post', post, section: 'following' });
    }
    if (followingDone) {
      if (mine.length) out.push({ kind: 'caughtUp' });
      if (near.length) {
        out.push({ kind: 'label', text: t('home.nearLabel', { metro: metro.data?.name ?? '' }) });
        for (const post of near) out.push({ kind: 'post', post, section: 'nearby' });
      } else if (!mine.length && nearby.isSuccess && !nearby.hasNextPage) {
        out.push({ kind: 'empty' });
      }
    }
    return out;
  }, [queued, following.data, nearby.data, followingDone, nearby.isSuccess, nearby.hasNextPage, metro.data, t]);

  function loadMore() {
    if (following.hasNextPage) {
      if (!following.isFetchingNextPage) void following.fetchNextPage();
    } else if (followingDone && nearby.hasNextPage && !nearby.isFetchingNextPage) {
      void nearby.fetchNextPage();
    }
  }

  async function refresh() {
    setRefreshing(true);
    await Promise.all([following.refetch(), followingDone ? nearby.refetch() : null]);
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
  const failed = following.isError || nearby.isError;
  const cardWidth = width - SIDE * 2;

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.screen, { backgroundColor: c.surface }]}>
      {/* TODO(M4b): pass hasUnread once notifications exist. */}
      <FeedHeader title={t('home.title')} />
      <FlatList
        data={items}
        keyExtractor={(item, i) =>
          item.kind === 'post'
            ? `${item.section}-${item.post.id}`
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
            case 'caughtUp':
              return (
                <View style={[styles.caughtUp, { borderTopColor: c.text }]}>
                  <Icon name="check" color={c.text} size={18} />
                  <Text variant="bodySm" style={styles.caughtUpText}>
                    {t('home.caughtUp')}
                  </Text>
                </View>
              );
            case 'empty':
              return (
                <View style={[styles.empty, { borderColor: c.textSecondary }]}>
                  <Text variant="headline">{t('home.emptyTitle')}</Text>
                  <Text variant="bodySm" color="textSecondary">
                    {t('home.emptyBody')}
                  </Text>
                  <Button label={t('home.emptyPost')} onPress={() => router.push('/new-post')} />
                  <Button label={t('home.emptyFind')} variant="secondary" onPress={() => router.push('/search')} />
                </View>
              );
          }
        }}
        ListFooterComponent={
          failed ? (
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: SIDE, paddingTop: space[3], paddingBottom: space[12], gap: space[3] },
  label: { paddingTop: space[2] },
  caughtUp: { flexDirection: 'row', alignItems: 'center', gap: 6, borderTopWidth: stroke.rule, paddingTop: space[3], marginTop: space[3] },
  caughtUpText: { fontFamily: fontFamily.sansSemiBold },
  empty: { borderWidth: stroke.rule, borderStyle: 'dashed', padding: space[4], gap: space[3] },
  footer: { paddingVertical: space[6], gap: space[3] },
});
