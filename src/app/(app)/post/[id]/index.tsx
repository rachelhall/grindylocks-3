import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from '@/components/safe-area';

import { Carousel } from '@/components/media';
import { AuthorName, CreditsLine, MoreButton, ObstacleChip, PlaceLine, usePostMenu } from '@/components/post-card';
import { Avatar } from '@/components/profile';
import { BackButton, Button, Icon, useActionSheet } from '@/components/ui';
import { usePost } from '@/lib/posts';
import { brand, fontFamily, space, stroke, Text, useColors } from '@/theme';

/**
 * Post detail (Post-Detail mockup, without likes and comments, which come
 * with M4b): the author and park, the slides with each one's obstacle and
 * people, the caption, credits and date. The More menu has Edit and Delete
 * for the author, and "take me off this post" for people on it.
 */
export default function PostScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, i18n } = useTranslation();
  const c = useColors();
  const { width } = useWindowDimensions();
  const { data, isError } = usePost(id);
  // undefined while loading; null when the post is gone or couldn't load.
  const post = data ?? (isError ? null : undefined);
  const menu = usePostMenu(post, { afterDelete: () => router.back() });
  const people = useActionSheet();
  const [index, setIndex] = useState(0);

  const date = post
    ? new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(new Date(post.publishedAt ?? post.createdAt))
    : '';
  const username = post?.author?.username ?? t('common.deletedUser');

  function showPeople(i: number) {
    const slide = post?.slides[i];
    if (!slide) return;
    const everyone = [...(slide.filmer ? [{ ...slide.filmer, filmer: true }] : []), ...slide.people.map((p) => ({ ...p, filmer: false }))];
    people.show({
      title: t('postDetail.peopleTitle', { number: i + 1 }),
      actions: everyone
        .filter((p) => p.username)
        .map((p) => ({
          label: p.filmer ? t('postDetail.filmerRow', { username: p.username }) : p.username!,
          onPress: () => router.push({ pathname: '/profile/[username]', params: { username: p.username! } }),
        })),
    });
  }

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: c.surface }]} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <BackButton />
        <Text variant="title" accessibilityRole="header" style={styles.flex}>
          {t('viewer.title')}
        </Text>
        {menu.available ? <MoreButton onPress={menu.open} label={t('postCard.more')} /> : null}
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
          <View style={styles.author}>
            <Avatar path={post.author?.avatarPath ?? null} username={username} size={40} />
            <View style={styles.flex}>
              <AuthorName post={post} variant="body" />
              <PlaceLine post={post} />
            </View>
          </View>

          <Carousel
            slides={post.slides}
            width={width}
            onIndexChange={setIndex}
            overlay={(i) => {
              const slide = post.slides[i];
              if (!slide) return null;
              const count = (slide.filmer ? 1 : 0) + slide.people.length;
              return (
                <>
                  <View style={styles.bottomLeft} pointerEvents="box-none">
                    <ObstacleChip slide={slide} parkSlug={post.park?.slug} accent />
                  </View>
                  {count > 0 ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t('postDetail.peopleButton', { count })}
                      onPress={() => showPeople(i)}
                      style={({ pressed }) => [styles.peopleButton, pressed && styles.pressed]}
                    >
                      <Icon name="person" color={brand.paper} size={16} />
                      <Text variant="label" style={{ color: brand.paper }}>
                        {count}
                      </Text>
                    </Pressable>
                  ) : null}
                </>
              );
            }}
          />

          {post.slides.length > 1 ? (
            <View
              style={styles.dots}
              accessible
              accessibilityLabel={t('postDetail.slideOf', { number: index + 1, total: post.slides.length })}
            >
              {post.slides.map((s, i) => (
                <View
                  key={s.id}
                  style={[
                    styles.dot,
                    i === index ? { backgroundColor: c.text } : { borderColor: c.text, borderWidth: stroke.rule },
                  ]}
                />
              ))}
            </View>
          ) : null}

          <View style={styles.text}>
            {post.caption ? (
              <Text variant="body">
                <Text variant="body" style={{ fontFamily: fontFamily.sansSemiBold }}>
                  {username}
                </Text>{' '}
                {post.caption}
              </Text>
            ) : null}
            <CreditsLine slides={post.slides} />
            <Text variant="caption" color="textMuted">
              {post.publishedAt ? t('viewer.posted', { date }) : t('viewer.notPosted')}
              {post.editedAt && post.publishedAt ? ` · ${t('postDetail.edited')}` : ''}
            </Text>
          </View>
        </ScrollView>
      )}
      {menu.sheet}
      {people.sheet}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1, minWidth: 0 },
  pressed: { opacity: 0.75 },
  header: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingHorizontal: space[4], paddingVertical: space[2] },
  loading: { marginTop: space[12] },
  missing: { padding: space[6], gap: space[4] },
  content: { paddingBottom: space[12] },
  author: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingHorizontal: space[4], paddingBottom: space[3] },
  bottomLeft: { position: 'absolute', left: 10, bottom: 10 },
  peopleButton: {
    position: 'absolute',
    left: 8,
    top: 8,
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    backgroundColor: brand.ink,
  },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6, paddingTop: space[3] },
  dot: { width: 8, height: 8 },
  text: { padding: space[4], gap: space[2] },
});
