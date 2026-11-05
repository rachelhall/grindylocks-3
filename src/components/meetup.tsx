/**
 * The meetup page's pieces (Meetups v2 mockups "Meetup page" and "Going
 * sheet"): the going list with HOST and CO-HOST, people you follow and
 * everyone else; the Going sheet; comments with HOST and CO-HOST labels;
 * and the banner for a co-host invite waiting for you. Since PR 5 hosts can
 * take someone off Going, comments can be reported, @names in them link to
 * profiles, and the comment box has an @ list of people who can see the
 * meetup.
 *
 * Pages as hosts (PR 9): the host page is the first row of the going list
 * with HOST; an 18+ meetup asks "I'm 18 or older" in the Going sheet, which
 * also says how many spots are left; and the page's team can comment as the
 * page, labelled HOST.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { type RefObject, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { MentionedText, MentionList } from '@/components/mentions';
import { PageTile } from '@/components/pages';
import { timeAgo } from '@/components/post-card';
import { Avatar } from '@/components/profile';
import { Sheet } from '@/components/tagging';
import { Button, CheckBox, Icon, Toggle } from '@/components/ui';
import { MAX_COMMENT } from '@/lib/engagement';
import { activeMention, insertMention, MAX_SUGGESTIONS } from '@/lib/mentions';
import { usePageMentions } from '@/lib/pages';
import {
  goingError,
  type GoingPerson,
  type HostPage,
  type MeetupComment,
  type MeetupThread,
  useAddMeetupComment,
  useDeleteMeetupComment,
  useGoingPrivatelyDefault,
  useMeetupComments,
  useMeetupMentionPeople,
  useSetGoing,
} from '@/lib/meetups';
import { Sentry } from '@/lib/sentry';
import { brand, fontFamily, size, space, stroke, Text, useColors } from '@/theme';

/* Going list ------------------------------------------------------------------------ */

/** "HOST" / "CO-HOST": plain words, outlined like a label. */
export function HostLabel({ role }: { role: 'host' | 'co_host' }) {
  const { t } = useTranslation();
  const c = useColors();
  return (
    <View style={[styles.hostLabel, { borderColor: c.border }]}>
      <Text variant="label" style={styles.hostLabelText}>
        {role === 'host' ? t('meetup.host') : t('meetup.coHost')}
      </Text>
    </View>
  );
}

export function GoingList({
  hostPage,
  people,
  unnamed,
  hostView,
  onRemove,
}: {
  /** A page meetup's host (PR 9): its first row, with HOST. */
  hostPage?: HostPage | null;
  people: GoingPerson[];
  unnamed: number;
  hostView: boolean;
  /** Hosts and co-hosts, before the date ends: take someone off Going (they aren't told). */
  onRemove?: (personId: string, username: string | null) => void;
}) {
  const { t } = useTranslation();
  const c = useColors();
  const hosts = people.filter((p) => p.role !== 'going');
  const followed = people.filter((p) => p.role === 'going' && p.following);
  const others = people.filter((p) => p.role === 'going' && !p.following);

  const row = (p: GoingPerson, last: boolean) => (
    <Pressable
      key={p.user_id}
      accessibilityRole="button"
      onPress={() => (p.username ? router.push({ pathname: '/profile/[username]', params: { username: p.username } }) : undefined)}
      style={({ pressed }) => [
        styles.personRow,
        !last && { borderBottomWidth: stroke.hairline, borderBottomColor: c.borderSubtle },
        pressed && styles.pressed,
      ]}
    >
      <Avatar path={p.avatar_path} username={p.username ?? ''} size={36} />
      <Text variant="body" numberOfLines={1} style={[styles.flex, { fontFamily: fontFamily.sansSemiBold }]}>
        {p.username ?? t('common.deletedUser')}
      </Text>
      {p.role !== 'going' ? <HostLabel role={p.role as 'host' | 'co_host'} /> : null}
      {hostView && p.going_privately ? (
        <Text variant="caption" color="textSecondary">
          {t('meetup.goingPrivatelyLabel')}
        </Text>
      ) : null}
      {onRemove && p.role === 'going' ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('meetup.removeLabel', { username: p.username ?? '' })}
          onPress={() => onRemove(p.user_id, p.username)}
          hitSlop={8}
          style={styles.action}
        >
          <Text variant="caption" color="textSecondary" style={{ fontFamily: fontFamily.sansSemiBold }}>
            {t('meetup.remove')}
          </Text>
        </Pressable>
      ) : null}
    </Pressable>
  );
  const sub = (label: string) => (
    <Text variant="label" color="textSecondary" style={styles.sub}>
      {label}
    </Text>
  );

  const nobodyElse = hosts.length + followed.length + others.length === 0 && unnamed === 0;
  return (
    <View style={{ backgroundColor: c.surfaceRaised }}>
      {hostPage ? (
        <Pressable
          accessibilityRole="link"
          onPress={() => router.push({ pathname: '/page/[handle]', params: { handle: hostPage.handle } })}
          style={({ pressed }) => [
            styles.personRow,
            !nobodyElse && { borderBottomWidth: stroke.hairline, borderBottomColor: c.borderSubtle },
            pressed && styles.pressed,
          ]}
        >
          <PageTile page={{ displayName: hostPage.display_name, state: hostPage.state, logoPath: hostPage.logo_path }} size={36} />
          <Text variant="body" numberOfLines={1} style={[styles.flex, { fontFamily: fontFamily.sansSemiBold }]}>
            {hostPage.display_name}
          </Text>
          <HostLabel role="host" />
        </Pressable>
      ) : null}
      {hosts.map((p, i) => row(p, i === hosts.length - 1 && followed.length + others.length === 0 && unnamed === 0))}
      {followed.length > 0 && !hostView ? sub(t('meetup.peopleYouFollow')) : null}
      {followed.map((p, i) => row(p, i === followed.length - 1 && others.length === 0 && unnamed === 0))}
      {others.length > 0 && followed.length > 0 && !hostView ? sub(t('meetup.everyoneElse')) : null}
      {others.map((p, i) => row(p, i === others.length - 1 && unnamed === 0))}
      {unnamed > 0 ? (
        <View style={styles.personRow} accessible accessibilityLabel={t('meetup.others', { count: unnamed })}>
          <View style={[styles.lockBox, { borderColor: c.textSecondary }]}>
            <Icon name="lock" color={c.textSecondary} size={16} />
          </View>
          <Text variant="body" color="textSecondary">
            {t('meetup.others', { count: unnamed })}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

/* Going sheet ----------------------------------------------------------------------- */

const NOTICE_KEY = 'meetups.goingNoticeSeen';

/**
 * I'm going, for this date only: Going privately (from your Settings ›
 * Privacy default) and Remind me. The first time ever, a notice says people
 * who can see the meetup can see you're going.
 */
export function GoingSheet({
  visible,
  eventId,
  userId,
  summary,
  line,
  adultsOnlyBy = null,
  spotsLeft = null,
  hasTickets = false,
  onClose,
}: {
  visible: boolean;
  eventId: string;
  userId: string | undefined;
  summary: { i_am_going: boolean; my_going_privately: boolean; my_remind_me: boolean } | null;
  /** "Thursday blade night · Thu, Nov 5 · 7:00 PM · Memo" */
  line: string;
  /** An 18+ meetup (PR 9): who made it for people 18 and older, asked once per meetup. */
  adultsOnlyBy?: string | null;
  /** Spots left on a meetup with a capacity. */
  spotsLeft?: number | null;
  /** It has a ticket link: going isn't buying a ticket. */
  hasTickets?: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const c = useColors();
  const going = summary?.i_am_going ?? false;
  const { data: defaultPrivate = false } = useGoingPrivatelyDefault(userId);
  const setGoing = useSetGoing(eventId);
  const [priv, setPriv] = useState(false);
  const [remind, setRemind] = useState(false);
  const [noticeSeen, setNoticeSeen] = useState(true);
  const [adult, setAdult] = useState(false);
  const [needAdult, setNeedAdult] = useState(false);
  const [wasVisible, setWasVisible] = useState(false);
  // Asked once per meetup: someone already going isn't asked again.
  const askAdult = Boolean(adultsOnlyBy) && !going;

  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) {
      setAdult(false);
      setNeedAdult(false);
      setPriv(going ? (summary?.my_going_privately ?? false) : defaultPrivate);
      setRemind(going ? (summary?.my_remind_me ?? false) : false);
    }
  }
  useEffect(() => {
    if (!visible) return;
    void AsyncStorage.getItem(NOTICE_KEY)
      .then((v) => setNoticeSeen(v === '1'))
      .catch(() => setNoticeSeen(false));
  }, [visible]);

  const save = (next: boolean) => {
    if (next && askAdult && !adult) {
      setNeedAdult(true);
      return;
    }
    setGoing.mutate(
      {
        going: next,
        goingPrivately: next ? priv : undefined,
        remindMe: next ? remind : undefined,
        confirmedAdult: next && askAdult ? adult : undefined,
      },
      {
        onSuccess: () => {
          if (next) void AsyncStorage.setItem(NOTICE_KEY, '1').catch(() => undefined);
          onClose();
        },
        onError: (err) => {
          const known = goingError(err);
          if (known === 'adult_confirm_needed') return setNeedAdult(true);
          if (known === 'meetup_full') {
            onClose();
            Alert.alert(t('pageMeet.fullTitle'), t('pageMeet.fullBody'));
            return;
          }
          Sentry.captureException(err);
          Alert.alert(t('errors.generic'));
        },
      },
    );
  };

  return (
    <Sheet visible={visible} title={going ? t('meetup.youreGoing') : t('meetup.imGoing')} onClose={onClose}>
      <View style={styles.sheetBody}>
        <Text variant="bodySm" color="textSecondary">
          {line}
        </Text>
        {!noticeSeen ? (
          <View style={[styles.notice, { backgroundColor: c.accentSubtle, borderColor: c.border }]}>
            <Icon name="eye" color={c.onAccentSubtle} size={22} />
            <View style={styles.flex}>
              <Text variant="body" style={{ color: c.onAccentSubtle, fontFamily: fontFamily.sansSemiBold }}>
                {t('meetup.noticeTitle')}
              </Text>
              <Text variant="bodySm" style={{ color: c.onAccentSubtleSecondary }}>
                {t('meetup.noticeBody')}
              </Text>
            </View>
          </View>
        ) : null}
        {askAdult ? (
          <>
            <View style={[styles.adultNotice, { backgroundColor: brand.ink }]}>
              <View style={[styles.adultTag, { backgroundColor: brand.paper }]}>
                <Text variant="label" style={{ color: brand.ink }}>
                  {t('pageMeet.adults')}
                </Text>
              </View>
              <Text variant="bodySm" style={[styles.flex, { color: brand.paper }]}>
                {t('pageMeet.adultNotice', { name: adultsOnlyBy })}
              </Text>
            </View>
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: adult }}
              onPress={() => {
                setAdult((a) => !a);
                setNeedAdult(false);
              }}
              style={[styles.adultRow, { borderBottomColor: c.borderSubtle }]}
            >
              <CheckBox checked={adult} c={c} />
              <Text variant="headline">{t('pageMeet.adultConfirm')}</Text>
            </Pressable>
            {needAdult ? (
              <Text variant="bodySm" color="statusClosed" accessibilityLiveRegion="polite">
                {t('pageMeet.adultNeeded')}
              </Text>
            ) : null}
          </>
        ) : null}
      </View>
      <View style={[styles.switches, { borderTopColor: c.borderSubtle }]}>
        <View style={[styles.switchRow, { borderBottomColor: c.borderSubtle }]}>
          <Icon name="eyeOff" color={c.text} size={22} />
          <View style={styles.flex}>
            <Text variant="headline">{t('meetup.goingPrivately')}</Text>
            <Text variant="bodySm" color="textSecondary">
              {t('meetup.goingPrivatelyBody')}
            </Text>
          </View>
          <Toggle value={priv} onChange={setPriv} label={t('meetup.goingPrivately')} fg={c.text} />
        </View>
        <View style={[styles.switchRow, { borderBottomColor: c.borderSubtle }]}>
          <Icon name="alarm" color={c.text} size={22} />
          <View style={styles.flex}>
            <Text variant="headline">{t('meetup.remindMe')}</Text>
            <Text variant="bodySm" color="textSecondary">
              {t('meetup.remindMeBody')}
            </Text>
          </View>
          <Toggle value={remind} onChange={setRemind} label={t('meetup.remindMe')} fg={c.text} />
        </View>
      </View>
      <View style={styles.sheetBody}>
        {(spotsLeft !== null || hasTickets) && !going ? (
          <Text variant="bodySm" color="textSecondary">
            {[spotsLeft !== null ? `${t('pageMeet.spotsLeft', { count: spotsLeft })}.` : null, hasTickets ? t('pageMeet.noTicket') : null]
              .filter(Boolean)
              .join(' ')}
          </Text>
        ) : null}
        <Button
          label={going ? t('meetup.save') : t('meetup.imGoing')}
          icon="check"
          loading={setGoing.isPending && setGoing.variables?.going === true}
          onPress={() => save(true)}
        />
        {going ? (
          <Button
            label={t('meetup.notGoing')}
            variant="secondary"
            loading={setGoing.isPending && setGoing.variables?.going === false}
            onPress={() => save(false)}
          />
        ) : null}
        <Text variant="caption" color="textSecondary" style={styles.center}>
          {t('meetup.goingFootnote')}
        </Text>
      </View>
    </Sheet>
  );
}

/* Comments -------------------------------------------------------------------------- */

export type MeetupReply = { threadId: string; userId: string | null; username: string | null };

export function MeetupComments({
  eventId,
  userId,
  canModerate,
  onTeam = false,
  onReply,
  onReport,
}: {
  eventId: string;
  userId: string | undefined;
  /** Hosts and co-hosts can delete any comment on their meetup. */
  canModerate: boolean;
  /** You're on the host page's team: the page's own comments are yours to manage, not report. */
  onTeam?: boolean;
  onReply: (target: MeetupReply) => void;
  /** Someone else's comment: Report. */
  onReport: (comment: MeetupComment) => void;
}) {
  const { t, i18n } = useTranslation();
  const c = useColors();
  const comments = useMeetupComments(eventId);
  const remove = useDeleteMeetupComment(eventId);
  const threads: MeetupThread[] = comments.data ?? [];
  const count = threads.reduce((n, th) => n + (th.comment.deleted ? 0 : 1) + th.replies.length, 0);

  const confirmDelete = (comment: MeetupComment) =>
    Alert.alert(t('comments.deleteTitle'), t('comments.deleteBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('comments.delete'),
        style: 'destructive',
        onPress: () => remove.mutate(comment.id, { onError: () => Alert.alert(t('errors.generic')) }),
      },
    ]);

  const one = (cm: MeetupComment, threadId: string, small: boolean) => (
    <View key={cm.id} style={styles.comment}>
      {cm.deleted ? (
        <Text variant="bodySm" color="textSecondary" style={styles.deleted}>
          {t('comments.deleted')}
        </Text>
      ) : (
        <>
          {cm.page ? (
            <PageTile page={{ displayName: cm.page.display_name, state: 'managed', logoPath: cm.page.logo_path }} size={small ? 28 : 36} />
          ) : (
            <Avatar path={cm.avatar_path} username={cm.username ?? ''} size={small ? 28 : 36} />
          )}
          <View style={styles.flex}>
            <View style={styles.commentHead}>
              <Text
                variant="bodySm"
                accessibilityRole={cm.page ? 'link' : undefined}
                onPress={cm.page ? () => router.push({ pathname: '/page/[handle]', params: { handle: cm.page!.handle } }) : undefined}
                style={{ fontFamily: fontFamily.sansSemiBold }}
              >
                {cm.page?.display_name ?? cm.username ?? t('common.deletedUser')}
              </Text>
              {cm.author_role === 'host' || cm.author_role === 'co_host' ? <HostLabel role={cm.author_role} /> : null}
              <Text variant="caption" color="textSecondary">
                {timeAgo(cm.created_at, t, i18n.language)}
              </Text>
            </View>
            <Text variant="body">
              {cm.reply_to_username ? (
                <Text variant="body" color="accentText" style={{ fontFamily: fontFamily.sansSemiBold }}>
                  {`@${cm.reply_to_username} `}
                </Text>
              ) : null}
              <MentionedText text={cm.body ?? ''} variant="body" />
            </Text>
            <View style={styles.commentActions}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('comments.replyTo', { username: cm.page?.display_name ?? cm.username ?? '' })}
                onPress={() => onReply({ threadId, userId: cm.author_id, username: cm.page ? null : cm.username })}
                hitSlop={6}
                style={styles.action}
              >
                <Text variant="caption" color="textSecondary" style={{ fontFamily: fontFamily.sansSemiBold }}>
                  {t('comments.reply')}
                </Text>
              </Pressable>
              {userId && (cm.author_id === userId || canModerate || (cm.page && onTeam)) ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('comments.deleteLabel')}
                  onPress={() => confirmDelete(cm)}
                  hitSlop={6}
                  style={styles.action}
                >
                  <Text variant="caption" color="textSecondary" style={{ fontFamily: fontFamily.sansSemiBold }}>
                    {t('comments.delete')}
                  </Text>
                </Pressable>
              ) : null}
              {userId && ((cm.author_id && cm.author_id !== userId) || (cm.page && !onTeam)) ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('meetup.reportComment', { username: cm.page?.display_name ?? cm.username ?? '' })}
                  onPress={() => onReport(cm)}
                  hitSlop={6}
                  style={styles.action}
                >
                  <Text variant="caption" color="textSecondary" style={{ fontFamily: fontFamily.sansSemiBold }}>
                    {t('meetup.report')}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        </>
      )}
    </View>
  );

  return (
    <View style={styles.block}>
      <Text variant="title" accessibilityRole="header">
        {t('comments.title')}
        {count ? (
          <Text variant="title" color="textSecondary">
            {` ${count}`}
          </Text>
        ) : null}
      </Text>
      {comments.isPending ? <ActivityIndicator color={c.text} /> : null}
      {comments.isError ? (
        <Text variant="bodySm" color="statusClosed">
          {t('errors.network')}
        </Text>
      ) : null}
      {!comments.isPending && threads.length === 0 ? (
        <Text variant="bodySm" color="textSecondary">
          {t('meetup.noComments')}
        </Text>
      ) : null}
      {threads.map((th) => (
        <View key={th.comment.id} style={styles.thread}>
          {one(th.comment, th.comment.id, false)}
          {th.replies.length > 0 ? (
            <View style={styles.replies}>{th.replies.map((r) => one(r, th.comment.id, true))}</View>
          ) : null}
        </View>
      ))}
    </View>
  );
}

/** The comment bar at the bottom of the meetup page. */
export function MeetupCommentComposer({
  eventId,
  userId,
  asPage = null,
  replyTo,
  onClearReply,
  inputRef,
}: {
  eventId: string;
  userId: string | undefined;
  /** The host page, when you're on its team (PR 9): you can comment as it. */
  asPage?: HostPage | null;
  replyTo: MeetupReply | null;
  onClearReply: () => void;
  inputRef: RefObject<TextInput | null>;
}) {
  const { t } = useTranslation();
  const c = useColors();
  const add = useAddMeetupComment(eventId, userId);
  const [text, setText] = useState('');
  const [cursor, setCursor] = useState(0);
  const [asIt, setAsIt] = useState(false);
  const page = asIt ? asPage : null;
  const ready = text.trim().length > 0 && !add.isPending;

  // Typing @ opens the list: only people who can see this meetup (decided Nov 3).
  const mention = activeMention(text, cursor);
  const people = useMeetupMentionPeople(eventId, mention ? mention.query : null);
  const pageHits = usePageMentions(mention ? mention.query : null, mention !== null);
  const pages = mention ? (pageHits.data ?? []) : [];
  const candidates = mention
    ? (people.data ?? [])
        .filter((p) => p.username.toLowerCase().startsWith(mention.query.toLowerCase()))
        .slice(0, MAX_SUGGESTIONS)
        .map((p) => ({ id: p.id, username: p.username, avatarPath: p.avatarPath, reason: p.reason }))
    : [];

  function pick(username: string) {
    if (!mention) return;
    const next = insertMention(text, cursor, mention.start, username);
    setText(next.text);
    setCursor(next.cursor);
    inputRef.current?.setSelection?.(next.cursor, next.cursor);
  }

  const send = () => {
    if (!ready) return;
    add.mutate(
      { body: text.trim(), parentId: replyTo?.threadId ?? null, replyToUserId: replyTo?.userId ?? null, asPage: page?.id ?? null },
      {
        onSuccess: () => {
          setText('');
          onClearReply();
        },
        onError: (err) => {
          Sentry.captureException(err);
          Alert.alert(t('comments.failed'), t('errors.network'));
        },
      },
    );
  };

  return (
    <>
      {candidates.length > 0 || pages.length > 0 ? (
        <MentionList candidates={candidates} pages={pages} typed={mention?.query.length ?? 0} parkName={null} onPick={pick} />
      ) : null}
      <View style={[styles.composer, { borderTopColor: c.borderSubtle, backgroundColor: c.surface }]}>
        {asPage ? (
          <Pressable
            accessibilityRole="switch"
            accessibilityState={{ checked: asIt }}
            accessibilityLabel={t('commentAs.toggleLabel', { name: page?.display_name ?? t('commentAs.you') })}
            accessibilityHint={t('commentAs.toggleHint')}
            onPress={() => setAsIt((v) => !v)}
            style={({ pressed }) => [
              styles.asChip,
              { borderColor: c.text, backgroundColor: asIt ? c.accentSubtle : c.surface },
              pressed && styles.pressed,
            ]}
          >
            {asIt ? (
              <PageTile page={{ displayName: asPage.display_name, state: asPage.state, logoPath: asPage.logo_path }} size={20} />
            ) : null}
            <Text variant="caption" style={{ color: asIt ? c.onAccentSubtle : c.text, fontFamily: fontFamily.sansSemiBold }}>
              {asIt ? t('commentAs.asPage', { name: asPage.display_name }) : t('commentAs.asYou')}
            </Text>
            <Icon name="repeat" color={asIt ? c.onAccentSubtle : c.text} size={14} />
          </Pressable>
        ) : null}
        {replyTo ? (
          <View style={styles.replying}>
            <Text variant="caption" color="textSecondary" style={styles.flex}>
              {replyTo.username ? t('comments.replyingTo', { username: replyTo.username }) : t('comments.replyingToThread')}
            </Text>
            <Pressable accessibilityRole="button" accessibilityLabel={t('comments.cancelReply')} onPress={onClearReply} hitSlop={8}>
              <Icon name="close" color={c.textSecondary} size={16} />
            </Pressable>
          </View>
        ) : null}
        <View style={styles.composerRow}>
          <TextInput
            ref={inputRef}
            value={text}
            onChangeText={(v) => setText(v.slice(0, MAX_COMMENT))}
            onSelectionChange={(e) => setCursor(e.nativeEvent.selection.end)}
            placeholder={page ? t('commentAs.placeholder', { name: page.display_name }) : t('comments.placeholder')}
            placeholderTextColor={c.textSecondary}
            multiline
            maxLength={MAX_COMMENT}
            accessibilityLabel={page ? t('commentAs.placeholder', { name: page.display_name }) : t('comments.placeholder')}
            style={[styles.composerInput, { borderColor: c.border, backgroundColor: c.surfaceRaised, color: c.text }]}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('comments.post')}
            accessibilityState={{ disabled: !ready }}
            disabled={!ready}
            onPress={send}
            style={[styles.send, { borderColor: c.border, backgroundColor: ready ? c.accent : c.surfaceRaised }]}
          >
            {add.isPending ? <ActivityIndicator color={c.onAccent} /> : <Icon name="arrowUp" color={ready ? c.onAccent : c.textSecondary} size={22} />}
          </Pressable>
        </View>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { textAlign: 'center' },
  pressed: { opacity: 0.75 },
  block: { paddingHorizontal: space[4], gap: space[3] },
  hostLabel: { borderWidth: 1, paddingHorizontal: 4 },
  hostLabelText: { fontSize: 10, lineHeight: 14 },
  personRow: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: space[3], paddingHorizontal: space[3] },
  sub: { paddingHorizontal: space[3], paddingTop: space[3], paddingBottom: space[1] },
  lockBox: { width: 36, height: 36, borderWidth: stroke.rule, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' },
  sheetBody: { paddingHorizontal: space[4], paddingVertical: space[3], gap: space[3] },
  notice: { borderWidth: stroke.rule, padding: space[3], flexDirection: 'row', gap: space[3] },
  switches: { borderTopWidth: stroke.hairline },
  switchRow: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    borderBottomWidth: stroke.hairline,
  },
  thread: { gap: space[2] },
  replies: { paddingLeft: 46, gap: space[2] },
  comment: { flexDirection: 'row', gap: space[3] },
  deleted: { fontStyle: 'italic', paddingVertical: space[1] },
  commentHead: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  commentActions: { flexDirection: 'row', gap: space[4] },
  action: { minHeight: 36, justifyContent: 'center' },
  composer: { borderTopWidth: stroke.hairline, paddingHorizontal: space[4], paddingTop: space[2], paddingBottom: space[3], gap: space[1] },
  replying: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  asChip: {
    alignSelf: 'flex-start',
    minHeight: 32,
    borderWidth: stroke.rule,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: space[2],
  },
  adultNotice: { flexDirection: 'row', alignItems: 'flex-start', gap: space[3], padding: space[3] },
  adultTag: { paddingHorizontal: 6, paddingVertical: 2 },
  adultRow: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: space[3], borderBottomWidth: stroke.hairline },
  composerRow: { flexDirection: 'row', gap: space[2], alignItems: 'flex-end' },
  composerInput: {
    flex: 1,
    minHeight: size.tapMin,
    maxHeight: 96,
    borderWidth: stroke.rule,
    paddingHorizontal: space[3],
    paddingTop: 12,
    paddingBottom: 12,
    fontFamily: fontFamily.sans,
    fontSize: 16,
  },
  send: { width: size.tapMin, height: size.tapMin, borderWidth: stroke.rule, alignItems: 'center', justifyContent: 'center' },
});
