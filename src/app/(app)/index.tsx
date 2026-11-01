import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { UploadCard } from '@/components/media';
import { Button } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { uploads, useUploads } from '@/lib/uploads';
import { space, stroke, Text, useColors } from '@/theme';

type MyPost = {
  id: string;
  caption: string | null;
  created_at: string;
  published_at: string | null;
  slide_count: number;
};

/**
 * Placeholder home until the M2 map and M4 feed. For now it's where the
 * upload path is tested: start a post, watch it upload, open your posts.
 */
export default function Home() {
  const { t, i18n } = useTranslation();
  const c = useColors();
  const { session, profile, signOut } = useAuth();
  const queued = useUploads();
  const [posts, setPosts] = useState<MyPost[]>([]);

  const userId = session?.user.id;
  const load = useCallback(() => {
    if (!userId) return;
    supabase
      .from('posts')
      .select('id, caption, created_at, published_at, slide_count')
      .eq('author_id', userId)
      .neq('status', 'deleted')
      .order('created_at', { ascending: false })
      .limit(20)
      .then(({ data }) => setPosts(data ?? []));
  }, [userId]);

  useFocusEffect(load);

  // Refresh the list when a post joins or leaves the upload queue.
  const queuedIds = queued.map((q) => q.postId).join(',');
  useEffect(() => {
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
        <Text variant="displayXl" numberOfLines={1} adjustsFontSizeToFit>
          {t('common.appName')}
        </Text>

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

        <View style={styles.account}>
          <Text variant="body" color="textSecondary">
            {t('home.signedInAs', { username: profile?.username ?? '' })}
          </Text>
          <Button label={t('common.signOut')} variant="secondary" onPress={signOut} />
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
  account: { gap: space[3], marginTop: space[6] },
});
