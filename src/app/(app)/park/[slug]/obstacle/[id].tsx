import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from '@/components/safe-area';

import { MasonryGrid } from '@/components/profile';
import { BackButton, Button } from '@/components/ui';
import { type ObstacleType, usePark } from '@/lib/parks';
import { toGridPost, useObstaclePosts } from '@/lib/posts';
import { fresh, keys } from '@/lib/query';
import { supabase } from '@/lib/supabase';
import { fontFamily, space, Text, useColors } from '@/theme';

type ObstacleInfo = { id: string; name: string; general_type: ObstacleType; notes: string | null };

/**
 * An obstacle's feed (Park-Obstacle mockup): every post with a slide tagged
 * to it, any trick, newest first, in the same masonry grid as profiles.
 * Tiles name the poster. Archived obstacles keep their feed.
 */
export default function ObstacleScreen() {
  const { slug, id } = useLocalSearchParams<{ slug: string; id: string }>();
  const { t } = useTranslation();
  const c = useColors();
  const { width } = useWindowDimensions();
  const { data: park } = usePark(slug);

  // Usually already in the park's cached detail; archived ones aren't, so
  // they're read on their own.
  const fromPark = park?.obstacles.find((o) => o.id === id);
  const single = useQuery({
    queryKey: keys.obstacle(id ?? ''),
    queryFn: async (): Promise<ObstacleInfo | null> => {
      const { data, error } = await supabase
        .from('obstacles')
        .select('id, name, general_type, notes')
        .eq('id', id!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: Boolean(id) && park !== undefined && !fromPark,
    staleTime: fresh.parks,
  });
  const obstacle: ObstacleInfo | null | undefined = fromPark ?? single.data;

  const posts = useObstaclePosts(id);
  const grid = useMemo(
    () => (posts.data?.pages.flat() ?? []).map((p) => ({ ...toGridPost(p), byline: p.author?.username ?? null })),
    [posts.data],
  );
  const [refreshing, setRefreshing] = useState(false);

  async function refresh() {
    setRefreshing(true);
    await posts.refetch();
    setRefreshing(false);
  }

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.screen, { backgroundColor: c.surface }]}>
      <View style={styles.topBar}>
        <BackButton />
        {park ? (
          <Text
            variant="bodySm"
            accessibilityRole="link"
            onPress={() => router.back()}
            style={{ color: c.accentText, fontFamily: fontFamily.sansSemiBold }}
          >
            {park.display_name}
          </Text>
        ) : null}
      </View>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={c.text} />}
        onScroll={(e) => {
          const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
          if (layoutMeasurement.height + contentOffset.y >= contentSize.height - 600 && posts.hasNextPage && !posts.isFetchingNextPage) {
            void posts.fetchNextPage();
          }
        }}
        scrollEventThrottle={200}
      >
        <View style={styles.head}>
          {obstacle ? (
            <>
              <Text variant="label" color="textSecondary">
                {t('obstacle.kicker', { type: t(`obstacleTypes.${obstacle.general_type}`) })}
              </Text>
              <Text variant="display" accessibilityRole="header">
                {obstacle.name}
              </Text>
              {obstacle.notes ? (
                <Text variant="body" color="textSecondary">
                  {obstacle.notes}
                </Text>
              ) : null}
            </>
          ) : obstacle === null ? (
            <Text variant="body" color="textSecondary">
              {t('obstacle.missing')}
            </Text>
          ) : null}
        </View>

        {posts.isPending ? (
          <ActivityIndicator color={c.text} style={styles.loading} />
        ) : posts.isError && grid.length === 0 ? (
          <View style={styles.head}>
            <Text variant="body" color="statusClosed">
              {t('errors.network')}
            </Text>
            <Button label={t('common.retry')} variant="secondary" onPress={() => void posts.refetch()} />
          </View>
        ) : grid.length === 0 ? (
          <View style={styles.head}>
            <Text variant="body" color="textSecondary">
              {t('obstacle.empty')}
            </Text>
          </View>
        ) : (
          <>
            <MasonryGrid posts={grid} width={width} />
            {posts.isFetchingNextPage ? <ActivityIndicator color={c.text} style={styles.loading} /> : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: space[2], paddingHorizontal: space[4], paddingVertical: space[2] },
  content: { paddingBottom: space[12], gap: space[4] },
  head: { paddingHorizontal: space[4], gap: space[2] },
  loading: { marginVertical: space[6] },
});
