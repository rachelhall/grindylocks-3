/**
 * The park page's people and posts (M4a): its regulars, most recently
 * active first, and its latest posts in the masonry grid, with the empty
 * states from the Park-NoPhoto mockup.
 */
import { router } from 'expo-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import { Avatar, MasonryGrid } from '@/components/profile';
import { Button } from '@/components/ui';
import { toGridPost, useParkPosts, useParkRegulars } from '@/lib/posts';
import { fontFamily, space, stroke, Text, useColors } from '@/theme';

const REGULAR_SIZE = 56;

export function ParkRegulars({ parkId }: { parkId: string }) {
  const { t } = useTranslation();
  const c = useColors();
  const { data, isPending, isError } = useParkRegulars(parkId);
  const regulars = data ?? [];

  return (
    <View style={styles.block}>
      <Text variant="title" accessibilityRole="header">
        {t('park.regulars')}
        {regulars.length ? (
          <Text variant="title" color="textSecondary">
            {' '}
            {regulars.length}
          </Text>
        ) : null}
      </Text>
      {isPending ? (
        <ActivityIndicator color={c.text} style={styles.loading} />
      ) : isError ? (
        <Text variant="bodySm" color="statusClosed">
          {t('errors.network')}
        </Text>
      ) : regulars.length === 0 ? (
        <View style={[styles.dashed, { borderColor: c.textSecondary }]}>
          <Text variant="bodySm" color="textSecondary">
            {t('park.noRegulars')}
          </Text>
        </View>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.regulars}>
          {regulars.map((r) => (
            <Pressable
              key={r.id}
              accessibilityRole="button"
              accessibilityLabel={r.username}
              onPress={() => router.push({ pathname: '/profile/[username]', params: { username: r.username } })}
              style={({ pressed }) => [styles.regular, pressed && styles.pressed]}
            >
              <Avatar path={r.avatar_path} username={r.username} size={REGULAR_SIZE} />
              <Text variant="caption" numberOfLines={1} style={styles.regularName}>
                {r.username}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

export function ParkPosts({ park }: { park: { id: string; display_name: string } }) {
  const { t } = useTranslation();
  const c = useColors();
  const { width } = useWindowDimensions();
  const posts = useParkPosts(park.id);
  const grid = useMemo(() => (posts.data?.pages.flat() ?? []).map(toGridPost), [posts.data]);

  const postHere = () =>
    router.push({ pathname: '/new-post', params: { park: park.id, parkName: park.display_name } });

  return (
    <View style={styles.posts}>
      <Text variant="title" accessibilityRole="header" style={styles.postsTitle}>
        {t('park.latestPosts')}
      </Text>
      {posts.isPending ? (
        <ActivityIndicator color={c.text} style={styles.loading} />
      ) : posts.isError && grid.length === 0 ? (
        <View style={styles.block}>
          <Text variant="bodySm" color="statusClosed">
            {t('errors.network')}
          </Text>
          <Button label={t('common.retry')} variant="secondary" onPress={() => void posts.refetch()} />
        </View>
      ) : grid.length === 0 ? (
        <View style={styles.block}>
          <View style={[styles.nothing, { backgroundColor: c.surfaceRaised }]}>
            <Text variant="headline">{t('park.nothingPosted')}</Text>
            <Text variant="bodySm" color="textSecondary">
              {t('park.nothingPostedBody', { park: park.display_name })}
            </Text>
            <Button
              label={t('park.postHere')}
              onPress={postHere}
              palette={{ fill: c.accent, text: c.onAccent, border: c.onAccent }}
            />
          </View>
        </View>
      ) : (
        <>
          <MasonryGrid posts={grid} width={width} />
          {posts.hasNextPage ? (
            <View style={styles.block}>
              <Button
                label={t('park.morePosts')}
                variant="secondary"
                loading={posts.isFetchingNextPage}
                onPress={() => void posts.fetchNextPage()}
              />
            </View>
          ) : null}
          <View style={styles.block}>
            <Pressable accessibilityRole="button" onPress={postHere} hitSlop={8}>
              <Text variant="bodySm" color="accentText" style={{ fontFamily: fontFamily.sansSemiBold }}>
                {t('park.postHereToo')}
              </Text>
            </Pressable>
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.75 },
  block: { paddingHorizontal: space[4], gap: space[2] },
  loading: { marginVertical: space[4] },
  dashed: { borderWidth: stroke.rule, borderStyle: 'dashed', padding: space[4] },
  regulars: { gap: space[3], paddingVertical: space[1] },
  regular: { width: REGULAR_SIZE + 8, alignItems: 'center', gap: 4 },
  regularName: { maxWidth: REGULAR_SIZE + 8 },
  posts: { gap: space[2] },
  postsTitle: { paddingHorizontal: space[4] },
  nothing: { padding: space[4], gap: space[3] },
});
