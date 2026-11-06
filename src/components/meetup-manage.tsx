/**
 * Changing a meetup from its page (Meetups v2 mockups "Delete a meetup",
 * "Cancel a meetup" and "Delete a meetup · confirm"):
 *
 * - MeetupMenu, the ⋯ menu. For hosts and co-hosts, YOUR MEETUP: Edit
 *   meetup, Co-hosts (the host only), Cancel meetup, and Delete meetup while
 *   the database still allows it (nobody but the hosts going, before it
 *   starts). For everyone else, Report meetup. Park admins also get Hide
 *   this date (or Show it again).
 * - CancelMeetupSheet: which dates (this date, or the whole series for the
 *   host), a reason (Rained out, Park closed, Something came up, Other) and
 *   an optional note. People going get a push.
 * - CoHostsSheet: the host invites and removes co-hosts after the fact.
 */
import type { TFunction } from 'i18next';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { CoHostSheet } from '@/components/meetup-compose';
import { Avatar } from '@/components/profile';
import { Sheet } from '@/components/tagging';
import { Button, CheckBox, Icon, type IconName } from '@/components/ui';
import {
  type CoHostRow,
  MAX_CO_HOSTS,
  type MeetupCancelReason,
  useCancelMeetup,
  useCoHosts,
  useInviteCoHosts,
  useRemoveCoHost,
} from '@/lib/meetups';
import { Sentry } from '@/lib/sentry';
import { fontFamily, size, space, stroke, Text, useColors } from '@/theme';

/* The ⋯ menu ------------------------------------------------------------------------- */

type MenuItem = { icon: IconName; label: string; detail?: string; destructive?: boolean; onPress: () => void };

export function MeetupMenu({
  visible,
  onClose,
  hosting,
  mainHost,
  canEdit,
  canDelete,
  canHide,
  hidden,
  onEdit,
  onCoHosts,
  onCancel,
  onDelete,
  onReport,
  onHide,
  stops = [],
  onHideStop,
}: {
  visible: boolean;
  onClose: () => void;
  /** Host or accepted co-host. */
  hosting: boolean;
  /** The host (only they change co-hosts and delete). */
  mainHost: boolean;
  /** Not over and not cancelled: Edit and Cancel are offered. */
  canEdit: boolean;
  canDelete: boolean;
  /** You moderate this park. */
  canHide: boolean;
  hidden: boolean;
  onEdit: () => void;
  onCoHosts: () => void;
  onCancel: () => void;
  onDelete: () => void;
  onReport: () => void;
  onHide: (hide: boolean) => void;
  /** Stops at parks you moderate (PR 9b): hide the date there only, or show it again. */
  stops?: { id: string; display_name: string; hidden: boolean }[];
  onHideStop?: (park: string, hide: boolean) => void;
}) {
  const { t } = useTranslation();
  const c = useColors();

  const mine: MenuItem[] = hosting
    ? [
        ...(canEdit ? [{ icon: 'edit' as const, label: t('meetupMenu.edit'), onPress: onEdit }] : []),
        ...(mainHost ? [{ icon: 'coHost' as const, label: t('meetupMenu.coHosts'), onPress: onCoHosts }] : []),
        ...(canEdit
          ? [{ icon: 'calendarOff' as const, label: t('meetupMenu.cancel'), detail: t('meetupMenu.cancelDetail'), onPress: onCancel }]
          : []),
        ...(canDelete
          ? [{ icon: 'trash' as const, label: t('meetupMenu.delete'), detail: t('meetupMenu.deleteDetail'), destructive: true, onPress: onDelete }]
          : []),
      ]
    : [];
  const others: MenuItem[] = [
    ...(!hosting ? [{ icon: 'flag' as const, label: t('meetupMenu.report'), onPress: onReport }] : []),
    ...(canHide
      ? [
          hidden
            ? { icon: 'eye' as const, label: t('meetupMenu.unhide'), detail: t('meetupMenu.unhideDetail'), onPress: () => onHide(false) }
            : { icon: 'eyeOff' as const, label: t('meetupMenu.hide'), detail: t('meetupMenu.hideDetail'), onPress: () => onHide(true) },
        ]
      : []),
    ...stops.map((s) =>
      s.hidden
        ? { icon: 'eye' as const, label: t('hops.showAt', { park: s.display_name }), detail: t('hops.showAtDetail'), onPress: () => onHideStop?.(s.id, false) }
        : { icon: 'eyeOff' as const, label: t('hops.hideAt', { park: s.display_name }), detail: t('hops.hideAtDetail'), onPress: () => onHideStop?.(s.id, true) },
    ),
  ];

  const row = (item: MenuItem) => (
    <Pressable
      key={item.label}
      accessibilityRole="button"
      accessibilityHint={item.detail}
      onPress={() => {
        onClose();
        item.onPress();
      }}
      style={({ pressed }) => [styles.menuRow, { borderBottomColor: c.borderSubtle }, pressed && styles.pressed]}
    >
      <Icon name={item.icon} color={item.destructive ? c.statusClosed : c.text} size={22} />
      <View style={styles.flex}>
        <Text variant="headline" color={item.destructive ? 'statusClosed' : 'text'}>
          {item.label}
        </Text>
        {item.detail ? (
          <Text variant="bodySm" color="textSecondary">
            {item.detail}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );

  return (
    <Sheet visible={visible} title={hosting ? t('meetupMenu.yourMeetup') : t('meetupMenu.title')} onClose={onClose}>
      <View style={[styles.rows, { borderTopColor: c.borderSubtle }]}>
        {mine.map(row)}
        {others.map(row)}
      </View>
      <View style={styles.sheetBody}>
        <Button label={t('common.close')} variant="secondary" onPress={onClose} />
      </View>
    </Sheet>
  );
}

/** "Delete this meetup?" Only for mistakes; once someone else is going or it starts, only Cancel. */
export function confirmDeleteMeetup(t: TFunction, onConfirm: () => void) {
  Alert.alert(t('meetupMenu.deleteTitle'), `${t('meetupMenu.deleteBody')}\n\n${t('meetupMenu.deleteNote')}`, [
    { text: t('meetupMenu.keepIt'), style: 'cancel' },
    { text: t('meetupMenu.delete'), style: 'destructive', onPress: onConfirm },
  ]);
}

/* Cancelling --------------------------------------------------------------------------- */

const REASONS: { reason: MeetupCancelReason; icon: IconName }[] = [
  { reason: 'rained_out', icon: 'rain' },
  { reason: 'park_closed', icon: 'block' },
  { reason: 'something_came_up', icon: 'calendarOff' },
  { reason: 'other', icon: 'more' },
];

export function CancelMeetupSheet({
  visible,
  onClose,
  eventId,
  dateLabel,
  dayName,
  repeating,
  mainHost,
  goingCount,
  onCancelled,
}: {
  visible: boolean;
  onClose: () => void;
  eventId: string;
  /** "Thu, Nov 5" */
  dateLabel: string;
  /** "Thursday", for the button. */
  dayName: string;
  repeating: boolean;
  /** Only the host can end the whole series. */
  mainHost: boolean;
  /** Everyone going, hosts included. */
  goingCount: number;
  onCancelled: () => void;
}) {
  const { t } = useTranslation();
  const c = useColors();
  const cancel = useCancelMeetup(eventId);
  const [scope, setScope] = useState<'date' | 'series'>('date');
  const [reason, setReason] = useState<MeetupCancelReason | null>(null);
  const [note, setNote] = useState('');
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) {
      setScope('date');
      setReason(null);
      setNote('');
    }
  }

  const option = (key: string, label: string, on: boolean, onPress: () => void, extra?: { icon?: IconName; detail?: string }) => (
    <Pressable
      key={key}
      accessibilityRole="radio"
      accessibilityState={{ checked: on }}
      onPress={onPress}
      style={[styles.option, { borderBottomColor: c.borderSubtle, backgroundColor: on ? c.accentSubtle : 'transparent' }]}
    >
      <CheckBox checked={on} c={c} />
      {extra?.icon ? <Icon name={extra.icon} color={on ? c.onAccentSubtle : c.text} size={20} /> : null}
      <View style={styles.flex}>
        <Text variant="headline" style={{ color: on ? c.onAccentSubtle : c.text }}>
          {label}
        </Text>
        {extra?.detail ? (
          <Text variant="bodySm" style={{ color: on ? c.onAccentSubtleSecondary : c.textSecondary }}>
            {extra.detail}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );

  const submit = () => {
    if (!reason) return;
    cancel.mutate(
      { reason, scope, note },
      {
        onSuccess: () => {
          onClose();
          onCancelled();
        },
        onError: (err) => {
          Sentry.captureException(err);
          Alert.alert(t('errors.generic'));
        },
      },
    );
  };

  return (
    <Sheet visible={visible} title={t('meetupCancel.title')} onClose={onClose}>
      <ScrollView keyboardShouldPersistTaps="handled">
        {repeating && mainHost ? (
          <>
            <Text variant="label" color="textSecondary" style={styles.caption}>
              {t('meetupCancel.whichDates')}
            </Text>
            <View accessibilityRole="radiogroup" style={[styles.rows, { borderTopColor: c.borderSubtle }]}>
              {option('date', t('meetupCancel.thisDate', { date: dateLabel }), scope === 'date', () => setScope('date'))}
              {option('series', t('meetupCancel.wholeSeries'), scope === 'series', () => setScope('series'), {
                detail: t('meetupCancel.wholeSeriesDetail'),
              })}
            </View>
          </>
        ) : null}
        <Text variant="label" color="textSecondary" style={styles.caption}>
          {t('meetupCancel.why')}
        </Text>
        <View accessibilityRole="radiogroup" style={[styles.rows, { borderTopColor: c.borderSubtle }]}>
          {REASONS.map((r) => option(r.reason, t(`meetup.reason.${r.reason}`), reason === r.reason, () => setReason(r.reason), { icon: r.icon }))}
        </View>
        <View style={styles.sheetBody}>
          <Text variant="label" color="textSecondary">
            {t('meetupCancel.note')}
          </Text>
          <TextInput
            value={note}
            onChangeText={(v) => setNote(v.slice(0, 140))}
            maxLength={140}
            placeholder={t('meetupCancel.notePlaceholder')}
            placeholderTextColor={c.textSecondary}
            accessibilityLabel={t('meetupCancel.note')}
            style={[styles.input, { borderColor: c.border, backgroundColor: c.surfaceRaised, color: c.text }]}
          />
          <Text variant="bodySm" color="textSecondary">
            {goingCount > 0 ? t('meetupCancel.footnote', { count: goingCount }) : t('meetupCancel.footnoteNobody')}
          </Text>
          <Button
            label={scope === 'series' ? t('meetupCancel.confirmSeries') : t('meetupCancel.confirmDate', { day: dayName })}
            disabled={!reason}
            loading={cancel.isPending}
            onPress={submit}
            palette={reason ? { fill: c.statusClosed, text: c.surface, border: c.statusClosed } : undefined}
          />
          <Button label={t('meetupMenu.keepIt')} variant="secondary" onPress={onClose} />
        </View>
      </ScrollView>
    </Sheet>
  );
}

/* Co-hosts ----------------------------------------------------------------------------- */

export function CoHostsSheet({ visible, onClose, seriesId }: { visible: boolean; onClose: () => void; seriesId: string }) {
  const { t } = useTranslation();
  const c = useColors();
  const list = useCoHosts(seriesId, visible);
  const invite = useInviteCoHosts(seriesId);
  const remove = useRemoveCoHost(seriesId);
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<{ id: string; username: string }[]>([]);
  const rows: CoHostRow[] = list.data ?? [];

  const confirmRemove = (r: CoHostRow) =>
    Alert.alert(t('coHosts.removeTitle', { username: r.username ?? '' }), t('coHosts.removeBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('coHosts.remove'),
        style: 'destructive',
        onPress: () => remove.mutate(r.user_id, { onError: () => Alert.alert(t('errors.generic')) }),
      },
    ]);

  const sendInvites = () => {
    const ids = picked.map((p) => p.id).filter((id) => !rows.some((r) => r.user_id === id));
    setPicking(false);
    setPicked([]);
    if (ids.length === 0) return;
    invite.mutate(ids, {
      onError: (err) => {
        Sentry.captureException(err);
        Alert.alert(t('coHosts.inviteFailed'));
      },
    });
  };

  return (
    <>
      <Sheet visible={visible && !picking} title={t('meetupCompose.coHosts')} onClose={onClose}>
        <View style={styles.sheetBody}>
          <Text variant="bodySm" color="textSecondary">
            {t('coHosts.body')}
          </Text>
        </View>
        <ScrollView>
          <View style={[styles.rows, { borderTopColor: c.borderSubtle }]}>
            {rows.map((r) => (
              <View key={r.user_id} style={[styles.personRow, { borderBottomColor: c.borderSubtle }]}>
                <Avatar path={r.avatar_path} username={r.username ?? ''} size={36} />
                <View style={styles.flex}>
                  <Text variant="body" style={{ fontFamily: fontFamily.sansSemiBold }}>
                    {r.username ?? t('common.deletedUser')}
                  </Text>
                  {!r.accepted ? (
                    <Text variant="caption" color="textSecondary">
                      {t('coHosts.invited')}
                    </Text>
                  ) : null}
                </View>
                <Button
                  label={r.accepted ? t('coHosts.remove') : t('coHosts.withdraw')}
                  variant="tertiary"
                  onPress={() => confirmRemove(r)}
                />
              </View>
            ))}
            {!list.isPending && rows.length === 0 ? (
              <Text variant="bodySm" color="textSecondary" style={styles.sheetBody}>
                {t('coHosts.none')}
              </Text>
            ) : null}
          </View>
        </ScrollView>
        <View style={styles.sheetBody}>
          <Button
            label={t('coHosts.invite')}
            icon="coHost"
            disabled={rows.length >= MAX_CO_HOSTS}
            loading={invite.isPending}
            onPress={() => setPicking(true)}
          />
        </View>
      </Sheet>
      <CoHostSheet
        visible={visible && picking}
        value={picked}
        onChange={setPicked}
        onClose={sendInvites}
      />
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pressed: { opacity: 0.75 },
  rows: { borderTopWidth: stroke.hairline },
  sheetBody: { paddingHorizontal: space[4], paddingVertical: space[3], gap: space[3] },
  caption: { paddingHorizontal: space[4], paddingTop: space[3], paddingBottom: space[2] },
  menuRow: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingHorizontal: space[4],
    paddingVertical: space[2],
    borderBottomWidth: stroke.hairline,
  },
  option: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingHorizontal: space[4],
    paddingVertical: space[2],
    borderBottomWidth: stroke.hairline,
  },
  input: { minHeight: size.tapMin, borderWidth: stroke.rule, paddingHorizontal: space[3], fontFamily: fontFamily.sans, fontSize: 16 },
  personRow: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingHorizontal: space[4],
    borderBottomWidth: stroke.hairline,
  },
});
