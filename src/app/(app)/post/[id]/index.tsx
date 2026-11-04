import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  type TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { MentionedText } from '@/components/mentions';
import { SafeAreaView } from '@/components/safe-area';

import { CommentComposer, CommentList } from '@/components/comments';
import { Carousel } from '@/components/media';
import {
  AuthorName,
  CreditsLine,
  MoreButton,
  ObstacleChip,
  PlaceLine,
  PostActions,
  PosterAvatar,
  posterName,
  usePostMenu,
} from '@/components/post-card';
import { BackButton, Button, Icon, useActionSheet } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import type { ReplyTarget } from '@/lib/engagement';
import { usePost } from '@/lib/posts';
import { brand, fontFamily, space, stroke, Text, useColors } from '@/theme';

/**
 * Post detail (Post-Detail mockup): the author and park, the slides with
 * each one's obstacle and people, like and comment, the caption, credits and
 * date, then the comments, with the comment box at the bottom (M4b). The More
 * menu has Edit and Delete for the author, "take me off this post" for
 * people on it, and Report and Block for everyone else (M5). Opened with `comments=1` (the comment button, a comment
 * notification), it scrolls to the comments.
 */
export default function PostScreen() {
  const { id, comments: toComments } = useLocalSearchParams<{ id: string; comments?: string }>();
  const { session } = useAuth();
  const userId = session?.user.id;
  const scroll = useRef<ScrollView>(null);
  const input = useRef<TextInput>(null);
  const [commentsY, setCommentsY] = useState<number | null>(null);
  const [replyTo, setReplyTo] = useState<ReplyTarget | null>(null);
  const [openThread, setOpenThread] = useState<string | null>(null);
  const { t, i18n } = useTranslation();
  const c = useColors();
  const { width } = useWindowDimensions();
  const { data, isError } = usePost(id);
  // undefined while loading; null when the post is gone or couldn't load.
  const post = data ?? (isError ? null : undefined);
  const menu = usePostMenu(post, { afterDelete: () => router.back(), afterBlock: () => router.back() });
  const people = useActionSheet();
  const [index, setIndex] = useState(0);

  // Opened for its comments: jump there once they're laid out.
  const jumped = useRef(false);
  useEffect(() => {
    if (toComments !== '1' || jumped.current || commentsY === null) return;
    jumped.current = true;
    scroll.current?.scrollTo({ y: Math.max(0, commentsY - 8), animated: false });
  }, [toComments, commentsY]);

  function reply(target: ReplyTarget) {
    setReplyTo(target);
    input.current?.focus();
  }

  const date = post
    ? new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(new Date(post.publishedAt ?? post.createdAt))
    : '';
  const username = post ? posterName(post, t) : t('common.deletedUser');

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
    <SafeAreaView style={[styles.screen, { backgroundColor: c.surface }]} edges={['top', 'left', 'right', 'bottom']}>
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
        <KeyboardAvoidingView
          style={styles.flexFill}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
        <ScrollView ref={scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.author}>
            <PosterAvatar post={post} size={40} />
            <View style={styles.flex}>
              <AuthorName post={post} variant="body" />
              <PlaceLine post={post} />
            </View>
          </View>

          <Carousel
            slides={post.slides}
            width={width}
            onIndexChange={setIndex}
            onExpand={(i) => router.push({ pathname: '/post/[id]/view', params: { id: post.id, slide: String(i) } })}
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

          <PostActions
            post={post}
            onComment={() => {
              if (commentsY !== null) scroll.current?.scrollTo({ y: Math.max(0, commentsY - 8), animated: true });
              input.current?.focus();
            }}
          />

          <View style={styles.text}>
            {post.caption ? (
              <Text variant="body">
                <Text variant="body" style={{ fontFamily: fontFamily.sansSemiBold }}>
                  {username}
                </Text>{' '}
                <MentionedText text={post.caption} variant="body" />
              </Text>
            ) : null}
            <CreditsLine slides={post.slides} />
            <Text variant="caption" color="textMuted">
              {post.publishedAt ? t('viewer.posted', { date }) : t('viewer.notPosted')}
              {post.editedAt && post.publishedAt ? ` · ${t('postDetail.edited')}` : ''}
            </Text>
          </View>

          {post.publishedAt ? (
            <View onLayout={(e) => setCommentsY(e.nativeEvent.layout.y)}>
              <CommentList
                postId={post.id}
                postAuthorId={post.authorId}
                userId={userId}
                onReply={reply}
                expandThread={openThread}
              />
            </View>
          ) : null}
        </ScrollView>
        {post.publishedAt ? (
          <CommentComposer
            postId={post.id}
            userId={userId}
            replyTo={replyTo}
            onClearReply={() => setReplyTo(null)}
            onPosted={(threadId) => {
              if (threadId) setOpenThread(threadId);
            }}
            inputRef={input}
          />
        ) : null}
        </KeyboardAvoidingView>
      )}
      {menu.sheet}
      {people.sheet}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1, minWidth: 0 },
  flexFill: { flex: 1 },
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
  text: { paddingHorizontal: space[4], paddingBottom: space[4], gap: space[2] },
});
