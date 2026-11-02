/**
 * Comments under a post (Post-Detail mockup, M4b): one level of replies,
 * oldest first, the POSTER label on the author's own comments, and threads
 * longer than two replies collapsed to "View N replies". Replying to a reply
 * stays in the same thread with an @mention of the person you're answering.
 * Comments can be deleted (your own, or any on your post), never edited.
 */
import { router } from 'expo-router';
import { Fragment, type RefObject, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { timeAgo } from '@/components/post-card';
import { Avatar } from '@/components/profile';
import { Icon } from '@/components/ui';
import {
  type Comment,
  MAX_COMMENT,
  type ReplyTarget,
  type Thread,
  useAddComment,
  useComments,
  useDeleteComment,
} from '@/lib/engagement';
import { Sentry } from '@/lib/sentry';
import { fontFamily, size, space, stroke, Text, useColors } from '@/theme';

const COLLAPSE_AFTER = 2;
const MENTION = /(@[A-Za-z0-9._]{2,30})/g;

const openProfile = (username: string) => router.push({ pathname: '/profile/[username]', params: { username } });

/** Comment text, with @mentions as links to profiles. */
function Body({ comment }: { comment: Comment }) {
  const c = useColors();
  const link = { color: c.accentText, fontFamily: fontFamily.sansSemiBold };
  const parts = (comment.body ?? '').split(MENTION);
  return (
    <Text variant="bodySm">
      {comment.replyToUsername ? (
        <>
          <Text variant="bodySm" accessibilityRole="link" onPress={() => openProfile(comment.replyToUsername!)} style={link}>
            @{comment.replyToUsername}
          </Text>{' '}
        </>
      ) : null}
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <Text key={i} variant="bodySm" accessibilityRole="link" onPress={() => openProfile(part.slice(1))} style={link}>
            {part}
          </Text>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </Text>
  );
}

function CommentRow({
  comment,
  reply,
  canDelete,
  onReply,
  onDelete,
}: {
  comment: Comment;
  reply: boolean;
  canDelete: boolean;
  onReply: () => void;
  onDelete: () => void;
}) {
  const { t, i18n } = useTranslation();
  const c = useColors();

  if (comment.deleted) {
    return (
      <View style={[styles.row, reply && styles.reply]}>
        <View style={[styles.deletedAvatar, { borderColor: c.borderSubtle }]} />
        <Text variant="bodySm" color="textMuted" style={styles.flex}>
          {t('comments.deleted')}
        </Text>
      </View>
    );
  }

  const username = comment.username;
  return (
    <View style={[styles.row, reply && styles.reply]}>
      <Pressable
        accessibilityRole={username ? 'link' : undefined}
        accessibilityLabel={username ?? t('common.deletedUser')}
        disabled={!username}
        onPress={() => username && openProfile(username)}
      >
        <Avatar path={comment.avatarPath} username={username ?? '?'} size={reply ? 28 : 32} />
      </Pressable>
      <View style={styles.flex}>
        <View style={styles.nameLine}>
          <Text
            variant="bodySm"
            color={username ? 'text' : 'textSecondary'}
            style={{ fontFamily: fontFamily.sansSemiBold }}
            onPress={username ? () => openProfile(username) : undefined}
          >
            {username ?? t('common.deletedUser')}
          </Text>
          {comment.isPoster ? (
            <View style={[styles.poster, { borderColor: c.text }]}>
              <Text variant="label" style={styles.posterText}>
                {t('comments.poster')}
              </Text>
            </View>
          ) : null}
        </View>
        <Body comment={comment} />
        <View style={styles.meta}>
          <Text variant="caption" color="textMuted">
            {timeAgo(comment.createdAt, t, i18n.language)}
          </Text>
          <Text
            variant="caption"
            color="textSecondary"
            accessibilityRole="button"
            accessibilityLabel={t('comments.replyTo', { username: username ?? t('common.deletedUser') })}
            onPress={onReply}
            style={styles.metaAction}
          >
            {t('comments.reply')}
          </Text>
          {canDelete ? (
            <Text
              variant="caption"
              color="textSecondary"
              accessibilityRole="button"
              accessibilityLabel={t('comments.deleteLabel')}
              onPress={onDelete}
              style={styles.metaAction}
            >
              {t('comments.delete')}
            </Text>
          ) : null}
        </View>
      </View>
    </View>
  );
}

function ThreadView({
  thread,
  expanded,
  onExpand,
  canDelete,
  onReply,
  onDelete,
}: {
  thread: Thread;
  expanded: boolean;
  onExpand: () => void;
  canDelete: (comment: Comment) => boolean;
  onReply: (target: ReplyTarget) => void;
  onDelete: (comment: Comment) => void;
}) {
  const { t } = useTranslation();
  const c = useColors();
  const collapsed = !expanded && thread.replies.length > COLLAPSE_AFTER;
  const target = (comment: Comment): ReplyTarget => ({
    threadId: thread.comment.id,
    // Replying to the thread's own first comment needs no @mention.
    username: comment.id === thread.comment.id ? null : comment.username,
    userId: comment.id === thread.comment.id ? null : comment.authorId,
  });
  return (
    <View>
      <CommentRow
        comment={thread.comment}
        reply={false}
        canDelete={canDelete(thread.comment)}
        onReply={() =>
          thread.comment.deleted
            ? undefined
            : onReply({ threadId: thread.comment.id, username: thread.comment.username, userId: null })
        }
        onDelete={() => onDelete(thread.comment)}
      />
      {collapsed ? (
        <Pressable
          accessibilityRole="button"
          onPress={onExpand}
          style={({ pressed }) => [styles.viewReplies, pressed && styles.pressed]}
        >
          <View style={[styles.viewRepliesRule, { backgroundColor: c.textMuted }]} />
          <Text variant="caption" color="textSecondary" style={{ fontFamily: fontFamily.sansSemiBold }}>
            {t('comments.viewReplies', { count: thread.replies.length })}
          </Text>
        </Pressable>
      ) : (
        thread.replies.map((r) => (
          <CommentRow
            key={r.id}
            comment={r}
            reply
            canDelete={canDelete(r)}
            onReply={() => !thread.comment.deleted && onReply(target(r))}
            onDelete={() => onDelete(r)}
          />
        ))
      )}
    </View>
  );
}

/**
 * The comment list for post detail. `onReply` sets the composer's "Replying
 * to" state; the composer itself sits at the bottom of the screen.
 */
export function CommentList({
  postId,
  postAuthorId,
  userId,
  onReply,
  expandThread,
}: {
  postId: string;
  postAuthorId: string;
  userId: string | undefined;
  onReply: (target: ReplyTarget) => void;
  /** A thread just replied to opens up, so the new reply shows. */
  expandThread: string | null;
}) {
  const { t } = useTranslation();
  const c = useColors();
  const comments = useComments(postId);
  const remove = useDeleteComment(postId);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const canDelete = (comment: Comment) =>
    !comment.deleted && Boolean(userId) && (comment.authorId === userId || postAuthorId === userId);

  function confirmDelete(comment: Comment) {
    Alert.alert(t('comments.deleteTitle'), t('comments.deleteBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('comments.delete'),
        style: 'destructive',
        onPress: () =>
          remove.mutate(comment.id, {
            onError: (err) => {
              Sentry.captureException(err);
              Alert.alert(t('errors.generic'), t('errors.network'));
            },
          }),
      },
    ]);
  }

  const threads = comments.data ?? [];
  return (
    <View style={[styles.list, { borderTopColor: c.borderSubtle }]}>
      <Text variant="label" color="textSecondary" accessibilityRole="header" style={styles.heading}>
        {threads.length ? t('comments.title') : t('comments.none')}
      </Text>
      {comments.isPending ? <ActivityIndicator color={c.text} style={styles.loading} /> : null}
      {comments.isError ? (
        <Text variant="bodySm" color="statusClosed">
          {t('errors.network')}
        </Text>
      ) : null}
      {threads.map((thread) => (
        <ThreadView
          key={thread.comment.id}
          thread={thread}
          expanded={expanded.has(thread.comment.id) || expandThread === thread.comment.id}
          onExpand={() => setExpanded((prev) => new Set(prev).add(thread.comment.id))}
          canDelete={canDelete}
          onReply={onReply}
          onDelete={confirmDelete}
        />
      ))}
    </View>
  );
}

/** The bar at the bottom of post detail: a text box, "Replying to", and Post. */
export function CommentComposer({
  postId,
  userId,
  replyTo,
  onClearReply,
  onPosted,
  inputRef,
}: {
  postId: string;
  userId: string | undefined;
  replyTo: ReplyTarget | null;
  onClearReply: () => void;
  onPosted: (threadId: string | null) => void;
  inputRef: RefObject<TextInput | null>;
}) {
  const { t } = useTranslation();
  const c = useColors();
  const add = useAddComment(postId, userId);
  const [text, setText] = useState('');
  const ready = text.trim().length > 0 && !add.isPending;

  function send() {
    if (!ready) return;
    const threadId = replyTo?.threadId ?? null;
    add.mutate(
      { body: text, replyTo },
      {
        onSuccess: () => {
          setText('');
          onClearReply();
          onPosted(threadId);
        },
        onError: (err) => {
          Sentry.captureException(err);
          Alert.alert(t('comments.failed'), t('errors.network'));
        },
      },
    );
  }

  return (
    <View style={[styles.composer, { backgroundColor: c.surfaceRaised, borderTopColor: c.border }]}>
      {replyTo ? (
        <View style={[styles.replying, { backgroundColor: c.accentSubtle }]}>
          <Text variant="caption" style={[styles.flex, { color: c.onAccentSubtle }]} numberOfLines={1}>
            {replyTo.username
              ? t('comments.replyingTo', { username: replyTo.username })
              : t('comments.replyingToThread')}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('comments.cancelReply')}
            onPress={onClearReply}
            hitSlop={10}
          >
            <Icon name="close" color={c.onAccentSubtle} size={16} />
          </Pressable>
        </View>
      ) : null}
      <View style={styles.inputRow}>
        <TextInput
          ref={inputRef}
          value={text}
          onChangeText={setText}
          placeholder={t('comments.placeholder')}
          placeholderTextColor={c.textMuted}
          accessibilityLabel={t('comments.placeholder')}
          selectionColor={c.accent}
          cursorColor={c.text}
          multiline
          maxLength={MAX_COMMENT}
          style={[styles.input, { color: c.text, borderColor: c.border, backgroundColor: c.surface }]}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('comments.post')}
          accessibilityState={{ disabled: !ready }}
          disabled={!ready}
          onPress={send}
          style={({ pressed }) => [
            styles.send,
            { backgroundColor: ready ? c.accent : c.surfaceSunk, borderColor: ready ? c.onAccent : c.borderSubtle },
            pressed && styles.pressed,
          ]}
        >
          {add.isPending ? (
            <ActivityIndicator color={c.onAccent} />
          ) : (
            <Text variant="label" style={{ color: ready ? c.onAccent : c.textMuted }}>
              {t('comments.post')}
            </Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  pressed: { opacity: 0.75 },
  list: { borderTopWidth: stroke.hairline, paddingHorizontal: space[4], paddingTop: space[4], gap: space[3] },
  heading: { paddingBottom: space[1] },
  loading: { alignSelf: 'flex-start' },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space[3], paddingVertical: space[1] },
  reply: { paddingLeft: 44 },
  deletedAvatar: { width: 32, height: 32, borderWidth: stroke.hairline, borderStyle: 'dashed' },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  poster: { borderWidth: stroke.rule, paddingHorizontal: 4, paddingVertical: 1 },
  posterText: { fontSize: 10, lineHeight: 12 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: space[4], paddingTop: 2 },
  metaAction: { fontFamily: fontFamily.sansSemiBold, paddingVertical: 6 },
  viewReplies: { flexDirection: 'row', alignItems: 'center', gap: space[2], paddingLeft: 44, minHeight: 36 },
  viewRepliesRule: { width: 24, height: stroke.hairline },
  composer: { borderTopWidth: stroke.rule, paddingHorizontal: space[3], paddingTop: space[2], paddingBottom: space[2], gap: space[2] },
  replying: { flexDirection: 'row', alignItems: 'center', gap: space[2], paddingHorizontal: space[3], paddingVertical: 6 },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space[2] },
  input: {
    flex: 1,
    minHeight: size.tapMin,
    maxHeight: 120,
    borderWidth: stroke.rule,
    paddingHorizontal: space[3],
    paddingTop: 12,
    paddingBottom: 12,
    fontFamily: fontFamily.sans,
    fontSize: 16,
  },
  send: { minWidth: 64, height: size.tapMin, borderWidth: stroke.rule, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space[3] },
});
