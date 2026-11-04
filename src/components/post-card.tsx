/**
 * A post in a feed (Feed-Home mockup), and the pieces post detail shares
 * with it: the obstacle tag on a slide, the credits line, "3 h" times and
 * the post's More menu, and the like and comment row (M4b). Only the post
 * mostly on screen plays its clip (see `@/lib/playback`).
 */
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { type TFunction } from 'i18next';
import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { MentionedText } from '@/components/mentions';
import { PageTile, StampTape, usePageMenu } from '@/components/pages';
import { Carousel } from '@/components/media';
import { Avatar } from '@/components/profile';
import { useConfirmBlock, useExplainRestriction, useReportSheet } from '@/components/safety';
import { Icon, type SheetAction, useActionSheet } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { useMyPages } from '@/lib/claims';
import { fetchViewerState, isOfficial, pageKind, stampFor, usePageRelation } from '@/lib/pages';
import { keys } from '@/lib/query';
import { fetchReportSummary, type ReportSummary, useModeratePost } from '@/lib/moderation';
import {
  credits,
  fetchMadePost,
  isOnPost,
  type PersonRef,
  type Post,
  type PostSlide,
  useDeletePost,
  useRemoveMeFromPost,
} from '@/lib/posts';
import { useToggleLike } from '@/lib/engagement';
import { useIsActivePost } from '@/lib/playback';
import { Sentry } from '@/lib/sentry';
import { brand, fontFamily, size, space, stroke, Text, useColors } from '@/theme';

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

/** "Reported 3 times for spam · Auto-hidden", for a role holder's post menu. */
function useReportSummaryTitle() {
  const { t } = useTranslation();
  return (summary: ReportSummary) => {
    const reported = t(`moderation.reported.${summary.reason}`, { count: summary.count });
    const status =
      summary.status === 'auto_hidden'
        ? t('moderation.autoHidden')
        : summary.status === 'hidden'
          ? t('moderation.hidden')
          : null;
    return status ? `${reported} · ${status}` : reported;
  };
}

/**
 * The post's More menu: Edit and Delete for its author; "Take me off this
 * post" for someone tagged or credited; Report and Block for everyone else
 * (M5). For a role holder, a post with open reports they can act on also
 * gets the summary as the sheet's title, plus Keep hidden and Dismiss
 * reports (Post-Menu-Role mockup). The native sheet can't show the mockup's
 * card, so the summary goes in its title and message. The reports are
 * fetched when the menu opens, never per card.
 */
export function usePostMenu(
  post: Post | null | undefined,
  { afterDelete, afterBlock }: { afterDelete?: () => void; afterBlock?: () => void } = {},
) {
  const { t } = useTranslation();
  const { session } = useAuth();
  const userId = session?.user.id;
  const { sheet, show } = useActionSheet();
  const report = useReportSheet({ onBlocked: afterBlock });
  const confirmBlock = useConfirmBlock();
  const del = useDeletePost();
  const removeMe = useRemoveMeFromPost(userId);
  const moderate = useModeratePost(userId);
  const summaryTitle = useReportSummaryTitle();
  const qc = useQueryClient();
  const page = post?.page ?? null;
  const myPages = useMyPages(page ? userId : undefined);
  const teamRole = page ? (myPages.data?.find((p) => p.pageId === page.id)?.role ?? null) : null;
  const pageRelation = usePageRelation(userId, page?.id);
  const pageMenu = usePageMenu();

  const isAuthor = Boolean(post && userId && post.authorId && post.authorId === userId);
  const onPost = Boolean(post && isOnPost(post, userId));
  const available = Boolean(post && userId);

  function decide(postId: string, decision: 'keep_hidden' | 'dismiss', username: string) {
    const [title, confirm] =
      decision === 'keep_hidden'
        ? [t('moderation.keepHiddenTitle', { username }), t('moderation.keepHidden')]
        : [t('moderation.dismissTitle'), t('moderation.dismiss')];
    Alert.alert(title, undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: confirm,
        style: decision === 'keep_hidden' ? 'destructive' : 'default',
        onPress: () =>
          moderate.mutate(
            { postId, decision },
            {
              onError: (err) => {
                Sentry.captureException(err);
                Alert.alert(t('errors.generic'), t('errors.network'));
              },
            },
          ),
      },
    ]);
  }

  function deleteAction(postId: string): SheetAction {
    return {
      label: t('postCard.delete'),
      destructive: true,
      onPress: () =>
        Alert.alert(t('postCard.deleteTitle'), t('postCard.deleteBody'), [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('postCard.delete'),
            style: 'destructive',
            onPress: () =>
              del.mutate(postId, {
                onSuccess: () => afterDelete?.(),
                onError: (err) => {
                  Sentry.captureException(err);
                  Alert.alert(t('errors.generic'));
                },
              }),
          },
        ]),
    };
  }

  /**
   * A page post (PR 8a). The team: Edit for the member who made it, Delete
   * for them or a manager or owner. Everyone else: the page's Mute, Report
   * this post and Block, each with its line (Feed-PageCard's ⋯).
   */
  async function openPagePost(p: Post, pg: NonNullable<Post['page']>) {
    if (!userId) return;
    if (teamRole) {
      const made = await fetchMadePost(p.id).catch((err: unknown) => {
        Sentry.captureException(err);
        return false;
      });
      const actions: SheetAction[] = [];
      if (made) {
        actions.push({ label: t('postCard.edit'), onPress: () => router.push({ pathname: '/post/[id]/edit', params: { id: p.id } }) });
      }
      if (made || teamRole === 'manager' || teamRole === 'owner') actions.push(deleteAction(p.id));
      if (actions.length > 0) show({ title: t('postingAs.menuTitle', { name: pg.displayName }), actions });
      return;
    }
    const state = await qc
      .fetchQuery({ queryKey: keys.pageState(userId, pg.id), queryFn: () => fetchViewerState(pg.id) })
      .catch(() => null);
    const name = pg.displayName;
    const toggle = (what: 'mute' | 'block', on: boolean) =>
      pageRelation.mutate(
        { what, on },
        {
          onSuccess: () => {
            void qc.invalidateQueries({ queryKey: ['feed'] });
            void qc.invalidateQueries({ queryKey: ['posts'] });
            if (what === 'block' && on) afterBlock?.();
          },
          onError: () => Alert.alert(t('errors.generic'), t('errors.network')),
        },
      );
    const confirmPageBlock = () =>
      Alert.alert(t('page.menu.blockConfirm', { name }), t('page.menu.blockBody'), [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('block.block'), style: 'destructive', onPress: () => toggle('block', true) },
      ]);
    pageMenu.open({ name, handle: pg.handle, stamp: stampFor(pg) }, [
      state?.muted
        ? { icon: 'soundOn', title: t('page.menu.unmute'), body: t('page.menu.unmuteBody'), onPress: () => toggle('mute', false) }
        : { icon: 'soundOff', title: t('page.menu.mute'), body: t('page.menu.muteBody'), onPress: () => toggle('mute', true) },
      {
        icon: 'flag',
        title: t('report.reportPost'),
        body: t('postingAs.reportBody'),
        onPress: () =>
          report.open({
            kind: 'post',
            id: p.id,
            personId: null,
            username: name,
            parkName: p.park?.name ?? null,
            page: { onBlock: confirmPageBlock },
          }),
      },
      { icon: 'block', title: t('page.menu.block', { name }), body: t('page.menu.blockBody'), destructive: true, onPress: confirmPageBlock },
    ]);
  }

  async function open() {
    if (!post || !userId) return;
    if (post.page) return openPagePost(post, post.page);
    const actions: SheetAction[] = [];
    let title: string | undefined;
    let message: string | undefined;
    const username = post.author?.username ?? null;

    if (!isAuthor) {
      // Only role holders get anything back; a failed check just leaves the actions out.
      const summary = await fetchReportSummary(userId, post.id).catch((err: unknown) => {
        Sentry.captureException(err);
        return null;
      });
      if (summary) {
        title = summaryTitle(summary);
        message = [
          summary.status === 'auto_hidden' || summary.status === 'hidden' ? t('moderation.hiddenBody') : null,
          t('moderation.webAdmin'),
        ]
          .filter(Boolean)
          .join(' ');
        const name = username ?? t('common.deletedUser');
        actions.push(
          { label: t('moderation.keepHidden'), destructive: true, onPress: () => decide(post.id, 'keep_hidden', name) },
          { label: t('moderation.dismiss'), onPress: () => decide(post.id, 'dismiss', name) },
        );
      }
    }

    if (isAuthor) {
      actions.push({
        label: t('postCard.edit'),
        onPress: () => router.push({ pathname: '/post/[id]/edit', params: { id: post.id } }),
      });
      actions.push(deleteAction(post.id));
    } else {
      if (onPost) {
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
      // A deleted account or an anonymized post has nobody to report or block.
      if (username && post.authorId) {
        const authorId = post.authorId;
        actions.push({
          label: t('report.reportPost'),
          onPress: () =>
            report.open({ kind: 'post', id: post.id, personId: authorId, username, parkName: post.park?.name ?? null }),
        });
        actions.push({
          label: t('report.blockPerson', { username }),
          destructive: true,
          onPress: () => confirmBlock({ id: authorId, username }, afterBlock),
        });
      }
    }
    show({ title, message, actions });
  }

  return {
    sheet: (
      <>
        {sheet}
        {report.sheet}
        {pageMenu.sheet}
      </>
    ),
    open: () => void open(),
    available,
  };
}

export function MoreButton({ onPress, label, color }: { onPress: () => void; label: string; color?: string }) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.more, pressed && styles.pressed]}
    >
      <Icon name="more" color={color ?? c.text} size={20} />
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
  const explainRestriction = useExplainRestriction();
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
              onError: (err: unknown) => {
                void explainRestriction(err).then((explained) => {
                  if (!explained) Sentry.captureException(err);
                });
              },
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

/** Who a post shows as: the page for a page post, else the author (or "deleted user"). */
export function posterName(post: Post, t: TFunction): string {
  return post.page?.displayName ?? post.author?.username ?? t('common.deletedUser');
}

/** The page's logo tile for a page post, else the author's avatar. */
export function PosterAvatar({ post, size: side }: { post: Post; size: number }) {
  const { t } = useTranslation();
  if (post.page) return <PageTile page={post.page} size={side} />;
  return <Avatar path={post.author?.avatarPath ?? null} username={posterName(post, t)} size={side} />;
}

export function AuthorName({ post, variant = 'bodySm' }: { post: Post; variant?: 'bodySm' | 'body' }) {
  const { t } = useTranslation();
  if (post.page) {
    const handle = post.page.handle;
    return (
      <View style={styles.pageName}>
        <Text
          variant={variant}
          accessibilityRole="link"
          numberOfLines={1}
          onPress={() => router.push({ pathname: '/page/[handle]', params: { handle } })}
          style={[styles.shrink, { fontFamily: fontFamily.sansSemiBold }]}
        >
          {post.page.displayName}
        </Text>
        {isOfficial(post.page) ? <StampTape stamp="official" small /> : null}
      </View>
    );
  }
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
  const active = useIsActivePost(post.id);
  const username = posterName(post, t);
  const openPost = () => router.push({ pathname: '/post/[id]', params: { id: post.id } });

  return (
    <View
      style={[{ backgroundColor: c.surfaceRaised }, post.page && { borderWidth: stroke.rule, borderColor: brand.ink }]}
      accessibilityLabel={post.page ? t('postingAs.cardLabel', { name: username }) : undefined}
    >
      {post.page ? (
        <PageCardHead post={post} page={post.page} onMore={menu.available ? menu.open : undefined} />
      ) : (
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
      )}

      <Pressable accessibilityRole="button" accessibilityLabel={t('postCard.open', { username })} onPress={openPost}>
        <Carousel
          slides={post.slides}
          width={width}
          active={active}
          onExpand={(i) => router.push({ pathname: '/post/[id]/view', params: { id: post.id, slide: String(i) } })}
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
            <MentionedText text={post.caption} variant="body" />
          </Text>
        ) : null}
        <CreditsLine slides={post.slides} />
      </View>
      {menu.sheet}
    </View>
  );
}

/**
 * A page post's header in Home (Feed-PageCard): an inverted ink strip with
 * the logo, the name, OFFICIAL and SHOP or BRAND, the park in pink for ink,
 * the time and ⋯. No "Sponsored": nobody pays to reach the feed.
 */
function PageCardHead({ post, page, onMore }: { post: Post; page: NonNullable<Post['page']>; onMore?: () => void }) {
  const { t, i18n } = useTranslation();
  const c = useColors();
  const handle = page.handle;
  const park = post.park;
  return (
    <View style={[styles.head, { backgroundColor: brand.ink }]}>
      <View style={[styles.logoRing, { borderColor: brand.paper }]}>
        <PageTile page={page} size={32} />
      </View>
      <View style={styles.headText}>
        <View style={styles.pageName}>
          <Text
            variant="bodySm"
            accessibilityRole="link"
            numberOfLines={1}
            onPress={() => router.push({ pathname: '/page/[handle]', params: { handle } })}
            style={[styles.shrink, { color: brand.paper, fontFamily: fontFamily.sansSemiBold }]}
          >
            {page.displayName}
          </Text>
          {isOfficial(page) ? <StampTape stamp="official" small /> : null}
          <Text variant="label" style={{ color: brand.paper, opacity: 0.75 }}>
            {t(`page.${pageKind(page)}`).toUpperCase()}
          </Text>
        </View>
        {park ? (
          <Text
            variant="caption"
            accessibilityRole="link"
            numberOfLines={1}
            onPress={() => router.push({ pathname: '/park/[slug]', params: { slug: park.slug } })}
            style={{ color: c.accentOnInk, fontFamily: fontFamily.sansSemiBold }}
          >
            {park.name}
          </Text>
        ) : null}
      </View>
      <Text variant="caption" style={{ color: brand.paper, opacity: 0.75 }}>
        {timeAgo(post.publishedAt ?? post.createdAt, t, i18n.language)}
      </Text>
      {onMore ? <MoreButton onPress={onMore} label={t('postingAs.more', { name: page.displayName })} color={brand.paper} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.75 },
  pageName: { flexDirection: 'row', alignItems: 'center', gap: space[1], minWidth: 0 },
  shrink: { flexShrink: 1 },
  logoRing: { borderWidth: 2 },
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
