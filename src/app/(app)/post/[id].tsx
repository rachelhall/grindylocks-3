import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Carousel, type ViewSlide } from '@/components/media';
import { BackButton, Button } from '@/components/ui';
import { photoUrls } from '@/lib/media';
import { fresh, keys } from '@/lib/query';
import { supabase } from '@/lib/supabase';
import { space, Text, useColors } from '@/theme';

type Loaded = {
  caption: string | null;
  createdAt: string;
  publishedAt: string | null;
  username: string | null;
  slides: ViewSlide[];
};

async function loadPost(id: string): Promise<Loaded | null> {
  const { data, error } = await supabase
    .from('posts')
    .select(
      'caption, created_at, published_at, profiles!posts_author_id_fkey(username), post_slides(id, position, kind, width, height, duration_s, upload_status, storage_path, stream_video_id)',
    )
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const rows = [...data.post_slides].sort((a, b) => a.position - b.position);
  const urls = await photoUrls(
    rows.filter((r) => r.kind === 'photo' && r.upload_status === 'ready' && r.storage_path).map((r) => r.storage_path!),
  );
  return {
    caption: data.caption,
    createdAt: data.created_at,
    publishedAt: data.published_at,
    username: data.profiles?.username ?? null,
    slides: rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      width: r.width,
      height: r.height,
      durationS: r.duration_s,
      status: r.upload_status,
      photoUrl: r.storage_path ? urls[r.storage_path] : undefined,
      videoId: r.stream_video_id,
    })),
  };
}

/**
 * Minimal post view for testing the upload path: the slides at their
 * original aspect ratio, caption and posted date. The full post detail
 * (tags, likes, comments) is M4.
 */
export default function PostScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, i18n } = useTranslation();
  const c = useColors();
  const { width } = useWindowDimensions();
  const { data, isError } = useQuery({
    queryKey: keys.post(id ?? ''),
    queryFn: () => loadPost(id!),
    enabled: Boolean(id),
    staleTime: fresh.posts,
    // While anything is still uploading, check back every few seconds.
    refetchInterval: (query) =>
      query.state.data?.slides.some((s) => s.status !== 'ready' && s.status !== 'failed') ? 5000 : false,
  });
  // undefined while loading; null when the post is gone or couldn't load.
  const post: Loaded | null | undefined = data ?? (isError ? null : undefined);

  const date = post
    ? new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(
        new Date(post.publishedAt ?? post.createdAt),
      )
    : '';

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: c.surface }]} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <BackButton />
        <Text variant="title">{t('viewer.title')}</Text>
      </View>
      {post === undefined ? (
        <ActivityIndicator style={styles.loading} color={c.text} />
      ) : post === null ? (
        <View style={styles.missing}>
          <Text variant="body" color="textSecondary">
            {t('viewer.missing')}
          </Text>
          <Button label={t('common.back')} variant="secondary" onPress={() => router.back()} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <Carousel slides={post.slides} width={width} />
          <View style={styles.text}>
            {post.username ? <Text variant="headline">@{post.username}</Text> : null}
            {post.caption ? <Text variant="body">{post.caption}</Text> : null}
            <Text variant="label" color="textSecondary">
              {post.publishedAt ? t('viewer.posted', { date }) : t('viewer.notPosted')}
            </Text>
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: space[3], padding: space[4] },
  loading: { marginTop: space[12] },
  missing: { padding: space[6], gap: space[4] },
  content: { paddingBottom: space[12] },
  text: { padding: space[4], gap: space[2] },
});
