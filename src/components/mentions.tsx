/**
 * @mentions, shared by the comment box, the new post Caption screen and the
 * Edit post caption (Comment box mockup, Nov 2; Mentions (v2) row, Nov 2):
 *
 * - MentionList: the list that opens when you type @. People on the post,
 *   then people you follow, then regulars at the post's park; the first row
 *   is highlighted as the likely pick.
 * - MentionedText: comment or caption text with each @username as a link to
 *   that profile.
 * - useCaptionMentions: what a caption box needs to open the list while you
 *   type @ and put the picked name in.
 *
 * Who goes in the list, and in what order, is in lib/mentions.ts.
 */
import { router } from 'expo-router';
import { Fragment, type ReactNode, type RefObject, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type NativeSyntheticEvent, Pressable, StyleSheet, type TextInput, type TextInputSelectionChangeEventData, View } from 'react-native';

import { Avatar } from '@/components/profile';
import {
  activeMention,
  buildCandidates,
  insertMention,
  type MentionCandidate,
  type MentionReason,
  type Person,
  useMentionSearch,
} from '@/lib/mentions';
import { type Post, useParkRegulars } from '@/lib/posts';
import { useBlockedAccounts, useFollowing } from '@/lib/social';
import { fontFamily, space, stroke, Text, useColors } from '@/theme';

const MENTION = /(@[A-Za-z0-9._]{2,30})/g;

export const openProfile = (username: string) => router.push({ pathname: '/profile/[username]', params: { username } });

/**
 * Text with @mentions as links to profiles. Renders bare text pieces, so it
 * goes inside a <Text> that sets the variant, next to the username or the
 * "replying to" link.
 */
export function MentionedText({ text, variant }: { text: string; variant: 'body' | 'bodySm' }): ReactNode {
  const c = useColors();
  const link = { color: c.accentText, fontFamily: fontFamily.sansSemiBold };
  return text.split(MENTION).map((part, i) =>
    i % 2 === 1 ? (
      <Text key={i} variant={variant} accessibilityRole="link" onPress={() => openProfile(part.slice(1))} style={link}>
        {part}
      </Text>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}

/** A username with the letters typed so far underlined. */
function MatchedName({ username, typed, color }: { username: string; typed: number; color: string }) {
  return (
    <Text variant="body" numberOfLines={1} style={{ color, fontFamily: fontFamily.sansSemiBold }}>
      {typed > 0 ? (
        <Text variant="body" style={[styles.typed, { color, fontFamily: fontFamily.sansSemiBold }]}>
          {username.slice(0, typed)}
        </Text>
      ) : null}
      {username.slice(typed)}
    </Text>
  );
}

export function MentionList({
  candidates,
  typed,
  parkName,
  onPick,
}: {
  candidates: MentionCandidate[];
  typed: number;
  parkName: string | null;
  onPick: (username: string) => void;
}) {
  const { t } = useTranslation();
  const c = useColors();
  const reasonText = (reason: MentionReason) => {
    switch (reason) {
      case 'posted':
        return t('comments.mentionPosted');
      case 'filmed':
        return t('comments.mentionFilmed');
      case 'tagged':
        return t('comments.mentionTagged');
      case 'commented':
        return t('comments.mentionCommented');
      case 'following':
        return t('comments.mentionFollowing');
      case 'regular':
        return parkName ? t('comments.mentionRegular', { park: parkName }) : null;
      default:
        return null;
    }
  };
  return (
    <View
      accessibilityRole="list"
      accessibilityLabel={t('comments.mentionLabel')}
      style={[styles.mentions, { backgroundColor: c.surfaceRaised, borderColor: c.border }]}
    >
      <Text variant="label" color="textSecondary" style={styles.mentionsTitle}>
        {t('comments.mentionTitle')}
      </Text>
      {candidates.map((p, i) => {
        const first = i === 0;
        const reason = reasonText(p.reason);
        const ink = first ? c.onAccentSubtle : c.text;
        return (
          <Pressable
            key={p.id}
            accessibilityRole="button"
            accessibilityLabel={reason ? `${p.username}, ${reason}` : p.username}
            onPress={() => onPick(p.username)}
            style={({ pressed }) => [
              styles.mentionRow,
              first && { backgroundColor: c.accentSubtle },
              pressed && styles.pressed,
            ]}
          >
            <Avatar path={p.avatarPath} username={p.username} size={32} />
            <View style={styles.flex}>
              <MatchedName username={p.username} typed={typed} color={ink} />
              {reason ? (
                <Text variant="caption" numberOfLines={1} style={{ color: first ? c.onAccentSubtle : c.textSecondary }}>
                  {reason}
                </Text>
              ) : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * The @ list for a caption (new post or Edit post). Ranked like the comment
 * box: people on the post (saved, or tagged in the draft), then people you
 * follow, then regulars at the post's park, then search. The text stays in
 * the screen's state; this follows the cursor and swaps in a picked name.
 */
export function useCaptionMentions({
  userId,
  text,
  setText,
  inputRef,
  post = null,
  onPost = [],
  parkId,
}: {
  userId: string | undefined;
  text: string;
  setText: (next: string) => void;
  inputRef: RefObject<TextInput | null>;
  /** Edit post: the post as saved. */
  post?: Post | null;
  /** New post: filmers and tagged people from the draft. */
  onPost?: { person: Person; reason: 'filmed' | 'tagged' }[];
  parkId: string | null | undefined;
}) {
  const [cursor, setCursor] = useState(0);
  const mention = activeMention(text, cursor);
  const typing = mention !== null;
  const following = useFollowing(userId, typing);
  const regulars = useParkRegulars(typing ? (parkId ?? undefined) : undefined);
  const blocked = useBlockedAccounts(typing ? userId : undefined);
  const search = useMentionSearch(mention?.query ?? '', typing);
  const candidates = mention
    ? buildCandidates({
        query: mention.query,
        me: userId,
        post,
        onPost,
        threads: [],
        following: following.data ?? [],
        regulars: (regulars.data ?? []).map((r) => ({ id: r.id, username: r.username, avatarPath: r.avatar_path })),
        others: (search.data ?? []).map((p) => ({ id: p.id, username: p.username, avatarPath: null })),
        blockedIds: new Set((blocked.data ?? []).map((b) => b.id)),
      })
    : [];

  function pick(username: string) {
    if (!mention) return;
    const next = insertMention(text, cursor, mention.start, username);
    setText(next.text);
    setCursor(next.cursor);
    inputRef.current?.setSelection?.(next.cursor, next.cursor);
  }

  return {
    candidates,
    typed: mention?.query.length ?? 0,
    pick,
    onSelectionChange: (e: NativeSyntheticEvent<TextInputSelectionChangeEventData>) =>
      setCursor(e.nativeEvent.selection.end),
  };
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  pressed: { opacity: 0.75 },
  mentions: { marginHorizontal: space[4], borderWidth: stroke.rule, borderBottomWidth: 0 },
  mentionsTitle: { paddingHorizontal: space[3], paddingTop: space[2], paddingBottom: 2 },
  mentionRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 52, paddingHorizontal: space[3] },
  typed: { textDecorationLine: 'underline' },
});
