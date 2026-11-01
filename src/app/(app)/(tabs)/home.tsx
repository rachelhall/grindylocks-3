import { useQuery } from '@tanstack/react-query';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { UploadCard } from '@/components/media';
import { Button } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { fresh, keys } from '@/lib/query';
import { supabase } from '@/lib/supabase';
import { uploads, useUploads } from '@/lib/uploads';
import { space, stroke, Text, useColors } from '@/theme';

async function fetchMyPosts(userId: string) {
  const { data, error } = await supabase
    .from('posts')
    .select('id, caption, created_at, published_at, slide_count')
    .eq('author_id', userId)
    .neq('status', 'deleted')
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) throw error;
  return data ?? [];
}

type MyPost = {
  id: string;
  caption: string | null;
  created_at: string;
  published_at: string | null;
  slide_count: number;
};

/**
 * Home tab. The feed is M4; until then this is where the upload path is
 * tested: start a post, watch it upload, open your own posts.
 */
export default function Home() {
  const { t, i18n } = useTranslation();
  const c = useColors();
  const { session } = useAuth();
  const queued = useUploads();
  const userId = session?.user.id;

  const { data, refetch } = useQuery({
    queryKey: keys.myPosts(userId ?? ''),
    queryFn: () => fetchMyPosts(userId!),
    enabled: Boolean(userId),
    staleTime: fresh.mine,
  });
  const posts: MyPost[] = data ?? [];
  const load = useCallback(() => void refetch(), [refetch]);

  // Shows the cached list straight away, then checks for changes, whenever
  // the tab comes back into view (skipping the first time, which the query
  // already loads).
  const focusedOnce = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (focusedOnce.current) load();
      focusedOnce.current = true;
    }, [load]),
  );

  // Refresh the list when a post joins or leaves the upload queue.
  const queuedIds = queued.map((q) => q.postId).join(',');
  const lastQueued = useRef(queuedIds);
  useEffect(() => {
    if (lastQueued.current === queuedIds) return;
    lastQueued.current = queuedIds;
    load();
  }, [queuedIds, load]);

  function confirmDiscard(postId: string) {
    Alert.alert(t('uploads.discardTitle'), t('uploads.discardBody'), [
      { text: t('post.cancel'), style: 'cancel' },
      {
        text: t('uploads.discard'),
        style: 'destructive',
        onPress: () => void uploads.discard(postId).then(load),
      },
    ]);
  }

  const dateFormat = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' });

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: c.surface }]}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.section}>
          <Text variant="display">{t('home.title')}</Text>
          <Text variant="body" color="textSecondary">
            {t('home.feedSoon')}
          </Text>
        </View>

        <Button
          label={t('post.newTitle')}
          onPress={() => router.push('/new-post')}
          palette={{ fill: c.accent, text: c.onAccent, border: c.accent }}
        />

        {queued.map((job) => (
          <UploadCard key={job.postId} job={job} onDiscard={() => confirmDiscard(job.postId)} />
        ))}

        <View style={styles.section}>
          <Text variant="title">{t('myPosts.title')}</Text>
          {posts.length === 0 ? (
            <Text variant="body" color="textSecondary">
              {t('myPosts.empty')}
            </Text>
          ) : (
            posts.map((p) => (
              <Pressable
                key={p.id}
                accessibilityRole="button"
                onPress={() => router.push({ pathname: '/post/[id]', params: { id: p.id } })}
                style={({ pressed }) => [
                  styles.row,
                  { backgroundColor: c.surfaceRaised, borderColor: c.borderSubtle },
                  pressed && { opacity: 0.75 },
                ]}
              >
                <Text variant="headline" numberOfLines={1}>
                  {p.caption || t('myPosts.noCaption')}
                </Text>
                <Text variant="label" color={p.published_at ? 'textSecondary' : 'statusSeasonal'}>
                  {p.published_at
                    ? t('myPosts.posted', {
                        date: dateFormat.format(new Date(p.published_at)),
                        count: p.slide_count,
                      })
                    : t('myPosts.notPosted')}
                </Text>
              </Pressable>
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: space[4], gap: space[6] },
  section: { gap: space[3] },
  row: { borderWidth: stroke.hairline, padding: space[3], gap: space[1] },
});
