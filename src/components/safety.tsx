/**
 * Roles and safety pieces shared by posts, comments, profiles and
 * Notifications (M5 mockups, Nov 2):
 *
 * - `useConfirmBlock`: the "Block @name?" alert, then the block.
 * - `useReportSheet`: the report bottom sheet (Report-Sheet mockup), then
 *   "Thanks, it's sent" with "Block @name too?" (Report-Sent).
 * - `RestrictionBanner`: the ink box at the top of Notifications for a
 *   suspended or banned member (Notices mockup).
 */
import { type ReactNode, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PagePicker } from '@/components/pages';
import { openSupportMail } from '@/components/settings';
import { Button, Icon, SelectRow, TextField } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import {
  goesToOwner,
  MAX_REPORT_DETAILS,
  type ReportReason,
  type ReportTarget,
  reportReasons,
  type Restriction,
  restrictionFor,
  useFileReport,
} from '@/lib/moderation';
import type { PageResult } from '@/lib/pages';
import { Sentry } from '@/lib/sentry';
import { useBlock } from '@/lib/social';
import { brand, fontFamily, size, space, stroke, Text, useColors } from '@/theme';

/* Blocking -------------------------------------------------------------------------- */

/**
 * Asks "Block @name?" and blocks on yes. `onBlocked` runs after the block
 * went through (a profile goes back, since they disappear for you).
 */
export function useConfirmBlock() {
  const { t } = useTranslation();
  const { session } = useAuth();
  const block = useBlock(session?.user.id);
  return useCallback(
    (person: { id: string; username: string }, onBlocked?: () => void) =>
      Alert.alert(t('block.title', { username: person.username }), t('block.body'), [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('block.block'),
          style: 'destructive',
          onPress: () =>
            block.mutate(
              { personId: person.id, block: true },
              {
                onSuccess: () => onBlocked?.(),
                onError: () => Alert.alert(t('errors.generic'), t('errors.network')),
              },
            ),
        },
      ]),
    [t, block],
  );
}

/* Report sheet ------------------------------------------------------------------------ */

/**
 * The report sheet for a post, a comment or a person. Render `sheet` once
 * and call `open(target)`. `onBlocked` runs when they also block the person
 * from the "Thanks, it's sent" step.
 */
export function useReportSheet({ onBlocked }: { onBlocked?: () => void } = {}): {
  sheet: ReactNode;
  open: (target: ReportTarget) => void;
} {
  const [target, setTarget] = useState<ReportTarget | null>(null);
  const open = useCallback((next: ReportTarget) => setTarget(next), []);
  const close = useCallback(() => setTarget(null), []);
  const sheet = (
    <Modal visible={target !== null} transparent animationType="slide" onRequestClose={close} statusBarTranslucent>
      {/* Keyed by the target, so each report starts empty. */}
      {target ? (
        <ReportSheetContent key={`${target.kind}:${target.id}`} target={target} onClose={close} onBlocked={onBlocked} />
      ) : null}
    </Modal>
  );
  return { sheet, open };
}

function ReportSheetContent({
  target,
  onClose,
  onBlocked,
}: {
  target: ReportTarget;
  onClose: () => void;
  onBlocked?: () => void;
}) {
  const { t } = useTranslation();
  const c = useColors();
  const insets = useSafeAreaInsets();
  const file = useFileReport();
  const confirmBlock = useConfirmBlock();
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState('');
  const [page, setPage] = useState<PageResult | null>(null);
  const [sent, setSent] = useState(false);
  const username = target.username;
  const impersonation = reason === 'impersonation';

  const send = () => {
    if (!reason) return;
    file.mutate(
      { target, reason, details, impersonating: page?.id },
      {
        onSuccess: () => setSent(true),
        onError: (err) => {
          // The post, comment or person is gone (or blocked you) since the sheet opened.
          if ((err as { code?: string }).code === 'P0002') {
            Alert.alert(t('report.gone'));
            onClose();
            return;
          }
          Sentry.captureException(err);
          Alert.alert(t('errors.generic'), t('errors.network'));
        },
      },
    );
  };

  const reasonText = (r: ReportReason) => {
    switch (r) {
      case 'spam':
        return { title: t('report.spam'), subtitle: t('report.spamBody') };
      case 'harassment':
        return { title: t('report.harassment'), subtitle: t('report.toOwner') };
      case 'wrong_park':
        return { title: t('report.wrongPark'), subtitle: t('report.wrongParkBody') };
      case 'involves_minor':
        return { title: t('report.minor'), subtitle: t('report.toOwner') };
      case 'impersonation':
        return { title: t('report.impersonation'), subtitle: t('report.toOwner') };
      default:
        return { title: t('report.other'), subtitle: undefined };
    }
  };

  const heading =
    target.kind === 'post'
      ? { label: t('report.postBy', { username }), title: t('report.titlePost') }
      : target.kind === 'comment' || target.kind === 'meetup_comment'
        ? { label: t('report.commentBy', { username }), title: t('report.titleComment') }
        : target.kind === 'meetup'
          ? { label: t('report.meetupBy', { username }), title: t('report.titleMeetup') }
          : { label: null, title: t('report.titlePerson', { username }) };

  const who =
    target.kind === 'person' && impersonation && page
      ? t('report.whoImpersonation', { username, page: page.displayName })
      : target.kind === 'person'
      ? t('report.whoPerson', { username })
      : target.kind === 'post'
        ? t('report.whoPost', { username })
        : target.kind === 'meetup'
          ? t('report.whoMeetup', { username })
          : t('report.whoComment', { username });

  const parkName = target.kind === 'post' || target.kind === 'meetup' || target.kind === 'meetup_comment' ? target.parkName : null;
  const sentBody =
    reason && goesToOwner(target.kind, reason)
      ? t('report.sentOwner')
      : parkName
        ? t('report.sentPark', { park: parkName })
        : t('report.sentAdmin');

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Pressable accessibilityLabel={t('common.close')} style={styles.scrim} onPress={onClose} />
      <View style={[styles.sheet, { backgroundColor: c.surface, borderColor: c.border, paddingBottom: space[6] + insets.bottom }]}>
        <View style={[styles.grabber, { backgroundColor: c.borderSubtle }]} />
        {sent ? (
          <View style={styles.body}>
            <View style={styles.sent}>
              <Icon name="checkCircle" color={c.statusOpen} size={40} />
              <Text variant="title" accessibilityRole="header" accessibilityLiveRegion="polite">
                {t('report.sentTitle')}
              </Text>
              <Text variant="body" color="textSecondary">
                {sentBody}
              </Text>
            </View>
            <View style={[styles.blockBox, { backgroundColor: c.surfaceRaised, borderColor: c.borderSubtle }]}>
              <Text variant="headline">{t('report.blockToo', { username })}</Text>
              <Text variant="bodySm" color="textSecondary">
                {t('report.blockTooBody')}
              </Text>
              <Button
                label={t('report.blockPerson', { username })}
                variant="secondary"
                palette={{ fill: 'transparent', text: c.danger, border: c.danger }}
                onPress={() =>
                  confirmBlock({ id: target.personId, username }, () => {
                    onClose();
                    onBlocked?.();
                  })
                }
                style={styles.outline}
              />
            </View>
            <Button label={t('report.done')} palette={{ fill: c.accent, text: c.onAccent, border: c.accent }} onPress={onClose} />
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled" bounces={false}>
            <View style={styles.head}>
              <View style={styles.flex}>
                {heading.label ? (
                  <Text variant="label" color="textSecondary">
                    {heading.label}
                  </Text>
                ) : null}
                <Text variant="title" accessibilityRole="header" style={styles.title}>
                  {heading.title}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('common.close')}
                onPress={onClose}
                hitSlop={4}
                style={({ pressed }) => [styles.close, { backgroundColor: c.surfaceRaised }, pressed && styles.pressed]}
              >
                <Icon name="close" color={c.text} size={20} />
              </Pressable>
            </View>

            <View style={styles.group} accessibilityRole="radiogroup">
              <Text variant="label" color="textSecondary">
                {t('report.whatsWrong')}
              </Text>
              {reportReasons(target.kind).map((r) => {
                const text = reasonText(r);
                return (
                  <SelectRow
                    key={r}
                    title={text.title}
                    subtitle={text.subtitle}
                    selected={reason === r}
                    onPress={() => setReason(r)}
                  />
                );
              })}
            </View>

            {impersonation ? <PagePicker value={page} onChange={setPage} /> : null}

            <TextField
              label={t('report.details')}
              labelNote={t('common.optional')}
              value={details}
              onChangeText={setDetails}
              maxLength={MAX_REPORT_DETAILS}
              multiline
              textAlignVertical="top"
            />

            <Text variant="bodySm" color="textSecondary">
              {who}
            </Text>
            <Button
              label={t('report.send')}
              palette={{ fill: c.accent, text: c.onAccent, border: c.accent }}
              onPress={send}
              disabled={!reason || (impersonation && !page)}
              loading={file.isPending}
            />
          </ScrollView>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

/* Suspension and ban ------------------------------------------------------------------ */

/**
 * For a failed post, comment, like or follow: if it failed because you're
 * suspended or banned, says so (with the date) and returns true; otherwise
 * returns false and the caller shows its usual error.
 */
export function useExplainRestriction() {
  const { t, i18n } = useTranslation();
  const { session } = useAuth();
  const userId = session?.user.id;
  return useCallback(
    async (error: unknown): Promise<boolean> => {
      const r = await restrictionFor(userId, error);
      if (!r) return false;
      if (r.banned) {
        Alert.alert(t('restriction.banned'), t('restriction.bannedBody'));
      } else {
        const date = new Intl.DateTimeFormat(i18n.language, { month: 'short', day: 'numeric' }).format(
          new Date(r.suspendedUntil ?? Date.now()),
        );
        Alert.alert(t('restriction.suspended', { date }), t('restriction.suspendedBody'));
      }
      return true;
    },
    [t, i18n.language, userId],
  );
}

/**
 * "You're suspended until Nov 9", the reason they were given and what they
 * can't do; or "Your account is banned". Always ink with paper text, like
 * the mockup, in both color schemes.
 */
export function RestrictionBanner({ restriction }: { restriction: Restriction }) {
  const { t, i18n } = useTranslation();
  const until = restriction.suspendedUntil
    ? new Intl.DateTimeFormat(i18n.language, { month: 'short', day: 'numeric' }).format(new Date(restriction.suspendedUntil))
    : null;
  const title = restriction.banned ? t('restriction.banned') : t('restriction.suspended', { date: until ?? '' });
  const rule = restriction.banned ? t('restriction.bannedBody') : t('restriction.suspendedBody');
  return (
    <View style={styles.banner} accessibilityRole="summary">
      <Text variant="headline" style={{ color: brand.paper, fontSize: 15 }}>
        {title}
      </Text>
      <Text variant="bodySm" style={{ color: brand.paper }}>
        {restriction.message ? `“${restriction.message}” ` : ''}
        {rule}
      </Text>
      <Text
        variant="bodySm"
        accessibilityRole="link"
        onPress={() => void openSupportMail()}
        style={[styles.bannerLink, { color: brand.pink }]}
      >
        {t('restriction.questions')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pressed: { opacity: 0.75 },
  scrim: { flex: 1, backgroundColor: 'rgba(17,17,17,0.5)' },
  sheet: { maxHeight: '92%', borderTopWidth: stroke.rule },
  grabber: { width: 40, height: 5, alignSelf: 'center', marginTop: 10 },
  body: { paddingHorizontal: 20, paddingTop: space[3], gap: space[4] },
  head: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  title: { fontSize: 26, lineHeight: 28 },
  close: { width: size.tapMin, height: size.tapMin, alignItems: 'center', justifyContent: 'center' },
  group: { gap: space[2] },
  sent: { gap: space[2], paddingTop: space[2] },
  blockBox: { borderWidth: stroke.rule, padding: space[4], gap: space[2] },
  outline: { minHeight: size.tapMin, marginTop: space[1] },
  banner: { marginHorizontal: space[4], marginTop: space[3], backgroundColor: brand.ink, padding: 14, gap: 6 },
  bannerLink: { fontFamily: fontFamily.sansSemiBold, paddingVertical: 4, alignSelf: 'flex-start' },
});
