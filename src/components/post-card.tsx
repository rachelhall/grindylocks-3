/**
 * A post in a feed (Feed-Home mockup), and the pieces post detail shares
 * with it: the obstacle tag on a slide, the credits line, "3 h" times and
 * the post's More menu, and the like and comment row (M4b).
 */
import { router } from 'expo-router';
import { type TFunction } from 'i18next';
import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { Carousel } from '@/components/media';
import { Avatar } from '@/components/profile';
import { Icon, type SheetAction, useActionSheet } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { credits, isOnPost, type PersonRef, type Post, type PostSlide, useDeletePost, useRemoveMeFromPost } from '@/lib/posts';
import { useToggleLike } from '@/lib/engagement';
import { Sentry } from '@/lib/sentry';
import { brand, fontFamily, size, space, Text, useColors } from '@/theme';

/* Time ------------------------------------------------------------------------------ */

/** "40 min", "3 h", "yesterday", "2 d", then the date. */
export function timeAgo(iso: string, t: TFunction, language: string): string {
  const then = new Date(iso);
  const minutes = Math.max(0, Math.round((Date.now() - then.getTime()) / 60_000));
  if (minutes < 1) return t('time.now');
  if (minutes < 60) return t('time.minutes', { count: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 24) return t('time.hours', { count: hours });
  const days = Math.round(hours / 24);
  if (days === 1) return t('time.yesterday');
  if (days < 7) return t('time.days', { count: days });
  return new Intl.DateTimeFormat(language, { dateStyle: 'medium' }).format(then);
}

/* Slide tags ---------------------------------------------------------------------------- */

/**
 * The obstacle on a slide: a specific obstacle opens its feed; a general
 * type is just a label. `accent` is the pink version used on post detail.
 */
export function ObstacleChip({ slide, parkSlug, accent = false }: { slide: PostSlide; parkSlug?: string; accent?: boolean }) {
  const { t } = useTranslation();
  const c = useColors();
  const label = slide.obstacle?.name ?? (slide.obstacleType ? t(`obstacleTypes.${slide.obstacleType}`) : null);
  if (!label) return null;
  const fill = accent ? c.accent : brand.ink;
  const fg = accent ? c.onAccent : brand.paper;
  const body = (
    <>
      <Icon name="pin" color={fg} size={14} />
      <Text variant="label" style={{ color: fg }}>
        {label}
      </Text>
    </>
  );
  if (slide.obstacle && parkSlug) {
    const obstacleId = slide.obstacle.id;
    return (
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={t('postCard.obstacleLink', { obstacle: label })}
        onPress={() => router.push({ pathname: '/park/[slug]/obstacle/[id]', params: { slug: parkSlug, id: obstacleId } })}
        style={({ pressed }) => [styles.obstacleChip, { backgroundColor: fill }, pressed && styles.pressed]}
      >
        {body}
      </Pressable>
    );
  }
  return <View style={[styles.obstacleChip, { backgroundColor: fill }]}>{body}</View>;
}

function PersonLink({ person }: { person: PersonRef }) {
  const { t } = useTranslation();
  const c = useColors();
  if (!person.username) {
    return (
      <Text variant="bodySm" color="textSecondary">
        {t('common.deletedUser')}
      </Text>
    );
  }
  const username = person.username;
  return (
    <Text
      variant="bodySm"
      accessibilityRole="link"
      onPress={() => router.push({ pathname: '/profile/[username]', params: { username } })}
      style={{ color: c.accentText, fontFamily: fontFamily.sansSemiBold }}
    >
      {username}
    </Text>
  );
}

/** "Filmed by kaito.rolls · with dee.makio", across the given slides. */
export function CreditsLine({ slides }: { slides: PostSlide[] }) {
  const { t } = useTranslation();
  const c = useColors();
  const { filmers, people } = credits(slides);
  if (filmers.length === 0 && people.length === 0) return null;
  const list = (items: PersonRef[]) =>
    items.map((p, i) => (
      <Fragment key={p.id}>
        {i > 0 ? <Text variant="bodySm" color="textSecondary">, </Text> : null}
        <PersonLink person={p} />
      </Fragment>
    ));
  return (
    <View style={styles.credits}>
      <Icon name={filmers.length ? 'video' : 'person'} color={c.textSecondary} size={15} />
      <Text variant="bodySm" color="textSecondary" style={styles.creditsText}>
        {filmers.length ? (
          <>
            {t('postCard.filmedBy')} {list(filmers)}
          </>
        ) : null}
        {filmers.length && people.length ? ' · ' : null}
        {people.length ? (
          <>
            {t('postCard.with')} {list(people)}
          </>
        ) : null}
      </Text>
    </View>
  );
}

/* More menu ------------------------------------------------------------------------------ */

/**
 * The post's More menu: Edit and Delete for its author; "Take me off this
 * post" for someone tagged or credited. Reporting comes with M5.
 */
export function usePostMenu(post: Post | null | undefined, { afterDelete }: { afterDelete?: () => void } = {}) {
  const { t } = useTranslation();
  const { session } = useAuth();
  const userId = session?.user.id;
  const { sheet, show } = useActionSheet();
  const del = useDeletePost();
  const removeMe = useRemoveMeFromPost(userId);

  const isAuthor = Boolean(post && userId && post.authorId === userId);
  const onPost = Boolean(post && isOnPost(post, userId));
  const available = isAuthor || onPost;

  function open() {
    if (!post) return;
    const actions: SheetAction[] = [];
    if (isAuthor) {
      actions.push({
        label: t('postCard.edit'),
        onPress: () => router.push({ pathname: '/post/[id]/edit', params: { id: post.id } }),
      });
      actions.push({
        label: t('postCard.delete'),
        destructive: true,
        onPress: () =>
          Alert.alert(t('postCard.deleteTitle'), t('postCard.deleteBody'), [
            { text: t('common.cancel'), style: 'cancel' },
            {
              text: t('postCard.delete'),
              style: 'destructive',
              onPress: () =>
                del.mutate(post.id, {
                  onSuccess: () => afterDelete?.(),
                  onError: (err) => {
                    Sentry.captureException(err);
                    Alert.alert(t('errors.generic'));
                  },
                }),
            },
          ]),
      });
    } else if (onPost) {
      actions.push({
        label: t('postCard.removeMe'),
        destructive: true,
        onPress: () =>
          Alert.alert(t('postCard.removeMeTitle'), t('postCard.removeMeBody'), [
            { text: t('common.cancel'), style: 'cancel' },
            {
              text: t('postCard.removeMeConfirm'),
              style: 'destructive',
              onPress: () =>
                removeMe.mutate(post, {
                  onError: (err) => {
                    Sentry.captureException(err);
                    Alert.alert(t('errors.generic'));
                  },
                }),
            },
          ]),
      });
    }
    show({ actions });
  }

  return { sheet, open, available };
}

export function MoreButton({ onPress, label }: { onPress: () => void; label: string }) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.more, pressed && styles.pressed]}
    >
      <Icon name="more" color={c.text} size={20} />
    </Pressable>
  );
}

/* Like and comment ----------------------------------------------------------------------- */

/**
 * The row under a post's slides: Like (a heart, never a count, since like
 * counts are hidden from everyone) and Comment with the comment count.
 * `onComment` opens the comments (post detail) or focuses the box there.
 */
export function PostActions({ post, onComment }: { post: Post; onComment: () => void }) {
  const { t } = useTranslation();
  const c = useColors();
  const { session } = useAuth();
  const like = useToggleLike(session?.user.id);
  const liked = post.likedByMe;
  const published = Boolean(post.publishedAt);

  return (
    <View style={styles.actions}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('postCard.like')}
        accessibilityState={{ selected: liked, disabled: !published }}
        disabled={!published}
        onPress={() =>
          like.mutate(
            { postId: post.id, like: !liked },
            {
              onError: (err: unknown) => Sentry.captureException(err),
            },
          )
        }
        style={({ pressed }) => [styles.action, pressed && styles.pressed]}
      >
        <Icon name={liked ? 'heartFill' : 'heart'} color={liked ? c.accentText : c.text} size={24} />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('postCard.comments', { count: post.commentCount })}
        disabled={!published}
        onPress={onComment}
        style={({ pressed }) => [styles.action, pressed && styles.pressed]}
      >
        <Icon name="chat" color={c.text} size={24} />
        {post.commentCount > 0 ? (
          <Text variant="bodySm" style={{ fontFamily: fontFamily.sansSemiBold }}>
            {post.commentCount}
          </Text>
        ) : null}
      </Pressable>
    </View>
  );
}

/* The card ------------------------------------------------------------------------------- */

/** Where a post was: its park (a link), or "No park · San Diego". */
export function PlaceLine({ post }: { post: Post }) {
  const { t } = useTranslation();
  const c = useColors();
  if (post.park) {
    const slug = post.park.slug;
    return (
      <Text
        variant="caption"
        accessibilityRole="link"
        numberOfLines={1}
        onPress={() => router.push({ pathname: '/park/[slug]', params: { slug } })}
        style={{ color: c.accentText, fontFamily: fontFamily.sansSemiBold }}
      >
        {post.park.name}
      </Text>
    );
  }
  return (
    <Text variant="caption" color="textSecondary" numberOfLines={1}>
      {post.metro ? t('postCard.noParkIn', { metro: post.metro.name }) : t('postCard.noPark')}
    </Text>
  );
}

export function AuthorName({ post, variant = 'bodySm' }: { post: Post; variant?: 'bodySm' | 'body' }) {
  const { t } = useTranslation();
  const username = post.author?.username;
  if (!username) {
    return (
      <Text variant={variant} color="textSecondary" style={{ fontFamily: fontFamily.sansSemiBold }}>
        {t('common.deletedUser')}
      </Text>
    );
  }
  return (
    <Text
      variant={variant}
      accessibilityRole="link"
      numberOfLines={1}
      onPress={() => router.push({ pathname: '/profile/[username]', params: { username } })}
      style={{ fontFamily: fontFamily.sansSemiBold }}
    >
      {username}
    </Text>
  );
}

export function PostCard({ post, width }: { post: Post; width: number }) {
  const { t, i18n } = useTranslation();
  const c = useColors();
  const menu = usePostMenu(post);
  const username = post.author?.username ?? t('common.deletedUser');
  const openPost = () => router.push({ pathname: '/post/[id]', params: { id: post.id } });

  return (
    <View style={{ backgroundColor: c.surfaceRaised }}>
      <View style={styles.head}>
        <Avatar path={post.author?.avatarPath ?? null} username={username} size={36} />
        <View style={styles.headText}>
          <AuthorName post={post} />
          <PlaceLine post={post} />
        </View>
        <Text variant="caption" color="textSecondary">
          {timeAgo(post.publishedAt ?? post.createdAt, t, i18n.language)}
        </Text>
        {menu.available ? <MoreButton onPress={menu.open} label={t('postCard.more')} /> : null}
      </View>

      <Pressable accessibilityRole="button" accessibilityLabel={t('postCard.open', { username })} onPress={openPost}>
        <Carousel
          slides={post.slides}
          width={width}
          overlay={(i) =>
            post.slides[i] ? (
              <View style={styles.overlayBottomLeft} pointerEvents="box-none">
                <ObstacleChip slide={post.slides[i]} parkSlug={post.park?.slug} />
              </View>
            ) : null
          }
        />
      </Pressable>

      <PostActions
        post={post}
        onComment={() => router.push({ pathname: '/post/[id]', params: { id: post.id, comments: '1' } })}
      />

      <View style={styles.body}>
        {post.caption ? (
          <Text variant="body" onPress={openPost}>
            <Text variant="body" style={{ fontFamily: fontFamily.sansSemiBold }}>
              {username}
            </Text>{' '}
            {post.caption}
          </Text>
        ) : null}
        <CreditsLine slides={post.slides} />
      </View>
      {menu.sheet}
    </View>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.75 },
  head: { flexDirection: 'row', alignItems: 'center', gap: space[2], paddingHorizontal: space[3], paddingVertical: space[2] },
  headText: { flex: 1, minWidth: 0, marginLeft: 2 },
  more: { width: 40, height: size.tapMin, alignItems: 'center', justifyContent: 'center' },
  body: { paddingHorizontal: space[3], paddingBottom: space[3], gap: space[2] },
  actions: { flexDirection: 'row', alignItems: 'center', gap: space[1], paddingHorizontal: space[1], paddingTop: space[1] },
  action: { minWidth: size.tapMin, height: size.tapMin, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingHorizontal: space[2] },
  obstacleChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, alignSelf: 'flex-start' },
  overlayBottomLeft: { position: 'absolute', left: 10, bottom: 10 },
  credits: { flexDirection: 'row', alignItems: 'flex-start', gap: space[1] },
  creditsText: { flex: 1 },
});
