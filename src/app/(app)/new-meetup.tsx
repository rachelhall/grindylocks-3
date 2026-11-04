import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import {
  CoHostSheet,
  DateTimeSheet,
  DisciplinesSheet,
  MEETUP_DISCIPLINES,
  NewModeSwitch,
  type RepeatDraft,
  RepeatsSheet,
  TitleSheet,
} from '@/components/meetup-compose';
import { SafeAreaView } from '@/components/safe-area';
import { Caption, ParkPickerModal } from '@/components/tagging';
import { Button, CheckBox, Icon, type IconName } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { formatClock, localNow } from '@/lib/hours';
import { pickFromLibrary } from '@/lib/media';
import {
  clocksDiffer,
  type MeetupChanges,
  type MeetupDraft,
  MEETUP_NOTE_MAX,
  repeatLabel,
  uploadMeetupCover,
  useCreateMeetup,
  useMeetup,
  useParkTimeZone,
  useUpdateMeetup,
} from '@/lib/meetups';
import { useMyProfile } from '@/lib/profiles';
import { Sentry } from '@/lib/sentry';
import { fontFamily, size, space, stroke, Text, useColors } from '@/theme';

type SheetName = 'park' | 'starts' | 'ends' | 'disciplines' | 'repeats' | 'coHosts' | 'title' | null;

/**
 * New › Meetup (mockup "New meetup · fast path"): park, start and an
 * optional line are enough ("I'll be at Memo Saturday at 4"). The end time
 * is optional (2 hours after the start). Who can see it starts at Public,
 * or Followers only for private accounts. "More, if you want" holds
 * disciplines, Repeats (with seasons), co-hosts, a title and a cover.
 * Opened from a park page's Plan a meetup with `park` and `parkName`.
 * New meetups never notify anyone; they show on Home for followers.
 *
 * Opened with `edit` (a date's id) it edits that date instead (PR 5): the
 * same rows filled in, without the Post/Meetup switch, Repeats or co-hosts
 * (the meetup page's Co-hosts handles those). Saving a repeating meetup
 * asks "This date or all upcoming?". Only what changed is sent; a new day,
 * time or park tells the people going.
 */
export default function NewMeetup() {
  const { t, i18n } = useTranslation();
  const c = useColors();
  const locale = i18n.language;
  const { session, profile } = useAuth();
  const { data: me } = useMyProfile(session?.user.id);
  const params = useLocalSearchParams<{ park?: string; parkName?: string; edit?: string }>();
  const create = useCreateMeetup(session?.user.id);
  const editing = useMeetup(params.edit);
  const update = useUpdateMeetup(params.edit);
  const original = params.edit ? (editing.data ?? null) : null;
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  // The cover a date already has; null once removed in this edit.
  const [keptCover, setKeptCover] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [draft, setDraft] = useState<MeetupDraft>(() => ({
    park: params.park && params.parkName ? { id: params.park, name: params.parkName, timeZone: null } : null,
    startsAt: null,
    endsAt: null,
    note: '',
    title: '',
    visibility: 'public',
    disciplines: (profile?.disciplines ?? []).filter((d) => MEETUP_DISCIPLINES.includes(d)),
    weekdays: [],
    repeatEndsOn: null,
    seasons: [],
    coHosts: [],
    cover: null,
  }));
  const [sheet, setSheet] = useState<SheetName>(null);
  // Who can see it starts at Followers only for private accounts, until picked.
  const [visibilityPicked, setVisibilityPicked] = useState(false);
  const visibility = visibilityPicked ? draft.visibility : me?.isPrivate ? 'followers' : 'public';
  const set = (patch: Partial<MeetupDraft>) => setDraft((d) => ({ ...d, ...patch }));

  // Editing: fill the draft from the date once it loads.
  if (original && loadedFor !== original.id) {
    setLoadedFor(original.id);
    setVisibilityPicked(true);
    setKeptCover(original.cover_path);
    setDraft({
      park: { id: original.park.id, name: original.park.display_name, timeZone: original.park.metro?.timezone ?? null },
      startsAt: new Date(original.starts_at),
      endsAt: new Date(original.ends_at),
      note: original.note ?? '',
      title: original.title ?? '',
      visibility: original.series.visibility,
      disciplines: original.disciplines,
      weekdays: original.series.weekdays,
      repeatEndsOn: null,
      seasons: [],
      coHosts: [],
      cover: null,
    });
  }

  const { data: timeZone = null } = useParkTimeZone(draft.park?.id);
  const clock = (d: Date) => formatClock(localNow(d, timeZone).minutes, locale);
  const dayAndTime = (d: Date) =>
    `${new Intl.DateTimeFormat(locale, { weekday: 'short', month: 'short', day: 'numeric', timeZone: timeZone ?? undefined }).format(d)} · ${clock(d)}`;

  const endDefault = draft.startsAt ? new Date(draft.startsAt.getTime() + 2 * 60 * 60 * 1000) : null;
  const ready = Boolean(draft.park && draft.startsAt) && !create.isPending && !saving && (!params.edit || Boolean(original));
  const repeats = repeatLabel(draft.weekdays, t, locale);
  const startDay = draft.startsAt ? localNow(draft.startsAt, timeZone) : null;

  const pickCover = async () => {
    try {
      const { picked } = await pickFromLibrary(1, { photosOnly: true });
      if (picked[0]) set({ cover: { uri: picked[0].uri, width: picked[0].width, height: picked[0].height } });
    } catch (err) {
      Sentry.captureException(err);
      Alert.alert(t('errors.generic'));
    }
  };

  const save = async (scope: 'date' | 'upcoming') => {
    if (!original || !draft.park || !draft.startsAt) return;
    const changes: MeetupChanges = {};
    if (draft.park.id !== original.park_id) changes.park = draft.park.id;
    if (draft.startsAt.getTime() !== new Date(original.starts_at).getTime()) changes.starts_at = draft.startsAt.toISOString();
    if (draft.endsAt) {
      // An end before the start means it runs past midnight.
      const endsAt = draft.endsAt <= draft.startsAt ? new Date(draft.endsAt.getTime() + 24 * 60 * 60 * 1000) : draft.endsAt;
      if (endsAt.getTime() !== new Date(original.ends_at).getTime()) changes.ends_at = endsAt.toISOString();
    }
    if (draft.title.trim() !== (original.title ?? '')) changes.title = draft.title.trim();
    if (draft.note.trim() !== (original.note ?? '')) changes.note = draft.note.trim();
    if ([...draft.disciplines].sort().join() !== [...original.disciplines].sort().join()) changes.disciplines = draft.disciplines;
    if (visibility !== original.series.visibility) changes.visibility = visibility;
    setSaving(true);
    try {
      if (draft.cover && session?.user.id) changes.cover_path = await uploadMeetupCover(session.user.id, draft.cover.uri);
      else if (!keptCover && original.cover_path) changes.cover_path = '';
      if (Object.keys(changes).length === 0) {
        router.back();
        return;
      }
      await update.mutateAsync({ scope, changes });
      router.back();
    } catch (err) {
      Sentry.captureException(err);
      const seasons = (err as { message?: string } | null)?.message?.includes('seasons');
      Alert.alert(t('meetupEdit.failed'), seasons ? t('meetupEdit.seasonsPark') : t('meetupCompose.failedBody'));
    } finally {
      setSaving(false);
    }
  };

  const saveEdit = () => {
    if (!ready || !original) return;
    if (original.series.weekdays.length > 0 && !original.series.ended_at) {
      Alert.alert(t('meetupEdit.scopeTitle'), t('meetupEdit.scopeBody'), [
        { text: t('meetupEdit.thisDate'), onPress: () => void save('date') },
        { text: t('meetupEdit.allUpcoming'), onPress: () => void save('upcoming') },
        { text: t('common.cancel'), style: 'cancel' },
      ]);
    } else {
      void save('date');
    }
  };

  const post = () => {
    if (params.edit) return saveEdit();
    if (!ready) return;
    // An end before the start means it runs past midnight.
    const endsAt =
      draft.endsAt && draft.startsAt && draft.endsAt <= draft.startsAt
        ? new Date(draft.endsAt.getTime() + 24 * 60 * 60 * 1000)
        : draft.endsAt;
    create.mutate(
      { ...draft, endsAt, visibility },
      {
        onSuccess: (id) => router.replace({ pathname: '/meetup/[id]', params: { id } }),
        onError: (err) => {
          Sentry.captureException(err);
          Alert.alert(t('meetupCompose.failed'), t('meetupCompose.failedBody'));
        },
      },
    );
  };

  const row = (icon: IconName, label: string, value: string, filled: boolean, onPress: () => void, raised?: boolean) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${value}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        { borderBottomColor: c.borderSubtle, backgroundColor: raised ? c.surfaceRaised : 'transparent' },
        pressed && styles.pressed,
      ]}
    >
      <Icon name={icon} color={c.text} size={22} />
      <Text variant="body" style={[styles.rowLabel, { fontFamily: fontFamily.sansSemiBold }]}>
        {label}
      </Text>
      <Text
        variant="body"
        numberOfLines={1}
        color={filled ? 'text' : 'textSecondary'}
        style={[styles.flex, filled && { fontFamily: fontFamily.sansSemiBold }]}
      >
        {value}
      </Text>
      <Icon name="chevron" color={c.textSecondary} size={20} />
    </Pressable>
  );

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: c.surface }]}>
      <View style={styles.header}>
        <Button label={t('post.cancel')} variant="tertiary" onPress={() => router.back()} style={styles.headerButton} />
        <Text variant="title" accessibilityRole="header">
          {params.edit ? t('meetupEdit.title') : t('meetupCompose.newTitle')}
        </Text>
        <View style={styles.headerButton} />
      </View>
      {params.edit ? null : (
        <View style={styles.modeSwitch}>
          <NewModeSwitch mode="meetup" park={draft.park} />
        </View>
      )}

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={[styles.rows, { borderTopColor: c.borderSubtle }]}>
            {row('pin', t('meetupCompose.park'), draft.park?.name ?? t('meetupCompose.pickPark'), Boolean(draft.park), () => setSheet('park'), true)}
            {row(
              'calendar',
              t('meetupCompose.starts'),
              draft.startsAt ? dayAndTime(draft.startsAt) : t('meetupCompose.pickTime'),
              Boolean(draft.startsAt),
              () => setSheet('starts'),
              true,
            )}
            {row(
              'clock',
              t('meetupCompose.ends'),
              draft.endsAt
                ? clock(draft.endsAt)
                : endDefault
                  ? t('meetupCompose.endsDefault', { time: clock(endDefault) })
                  : t('meetupCompose.optional'),
              Boolean(draft.endsAt),
              () => (draft.startsAt ? setSheet('ends') : setSheet('starts')),
              true,
            )}
          </View>
          {draft.startsAt && clocksDiffer(timeZone, draft.startsAt) ? (
            <Text variant="caption" color="textSecondary" style={styles.pad}>
              {t('meetupCompose.parkTimeNote', {
                time: new Intl.DateTimeFormat(locale, { weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(draft.startsAt),
              })}
            </Text>
          ) : null}

          <View style={styles.pad}>
            <Text variant="label" color="textSecondary">
              {t('meetupCompose.line')}
            </Text>
            <TextInput
              value={draft.note}
              onChangeText={(note) => set({ note: note.slice(0, MEETUP_NOTE_MAX) })}
              placeholder={t('meetupCompose.linePlaceholder', { park: draft.park?.name ?? 'Memo' })}
              placeholderTextColor={c.textSecondary}
              maxLength={MEETUP_NOTE_MAX}
              multiline
              accessibilityLabel={t('meetupCompose.line')}
              style={[styles.input, { borderColor: c.border, backgroundColor: c.surfaceRaised, color: c.text }]}
            />
          </View>

          <View style={styles.pad}>
            <Text variant="label" color="textSecondary">
              {t('meetupCompose.whoCanSee')}
            </Text>
            <View accessibilityRole="radiogroup" style={styles.radios}>
              {(['public', 'followers'] as const).map((v) => {
                const on = visibility === v;
                return (
                  <Pressable
                    key={v}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: on }}
                    onPress={() => {
                      setVisibilityPicked(true);
                      set({ visibility: v });
                    }}
                    style={[styles.radio, { borderColor: c.border, backgroundColor: on ? c.accentSubtle : 'transparent' }]}
                  >
                    {on ? <CheckBox checked c={c} /> : null}
                    <Text
                      variant="body"
                      style={{ fontFamily: fontFamily.sansSemiBold, color: on ? c.onAccentSubtle : c.text }}
                    >
                      {v === 'public' ? t('meetupCompose.public') : t('meetupCompose.followersOnly')}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View>
            <View style={styles.pad}>
              <Caption>{t('meetupCompose.more')}</Caption>
            </View>
            <View style={[styles.rows, { borderTopColor: c.borderSubtle }]}>
              {row(
                'skate',
                t('meetupCompose.disciplines'),
                draft.disciplines.length ? draft.disciplines.map((d) => t(`disciplines.${d}`)).join(', ') : t('meetupCompose.anyone'),
                false,
                () => setSheet('disciplines'),
              )}
              {params.edit
                ? null
                : row('repeat', t('meetupCompose.repeats'), repeats ?? t('meetupCompose.doesntRepeat'), Boolean(repeats), () =>
                    draft.park && draft.startsAt ? setSheet('repeats') : Alert.alert(t('meetupCompose.repeatsFirst')),
                  )}
              {params.edit
                ? null
                : row(
                    'coHost',
                    t('meetupCompose.coHosts'),
                    draft.coHosts.length ? draft.coHosts.map((p) => `@${p.username}`).join(', ') : t('meetupCompose.invitePeople'),
                    draft.coHosts.length > 0,
                    () => setSheet('coHosts'),
                  )}
              {row('titleText', t('meetupCompose.title'), draft.title.trim() || t('meetupCompose.addTitle'), Boolean(draft.title.trim()), () =>
                setSheet('title'),
              )}
              {row(
                'photo',
                t('meetupCompose.cover'),
                draft.cover || keptCover ? t('meetupCompose.coverPicked') : t('meetupCompose.addPhoto'),
                Boolean(draft.cover || keptCover),
                () => void pickCover(),
              )}
            </View>
            {draft.cover ? (
              <View style={[styles.pad, styles.coverRow]}>
                <Image source={{ uri: draft.cover.uri }} style={styles.cover} contentFit="cover" />
                <Button label={t('meetupCompose.removeCover')} variant="tertiary" onPress={() => set({ cover: null })} />
              </View>
            ) : keptCover ? (
              <View style={[styles.pad, styles.coverRow]}>
                <Button label={t('meetupCompose.removeCover')} variant="tertiary" onPress={() => setKeptCover(null)} />
              </View>
            ) : null}
          </View>
        </ScrollView>

        <View style={[styles.footer, { borderTopColor: c.borderSubtle }]}>
          <Text variant="bodySm" color="textSecondary" style={styles.center}>
            {params.edit
              ? t('meetupEdit.footer')
              : visibility === 'followers'
                ? t('meetupCompose.footerFollowers')
                : t('meetupCompose.footer')}
          </Text>
          <Button
            label={params.edit ? t('meetupEdit.save') : t('meetupCompose.post')}
            disabled={!ready}
            loading={create.isPending || saving}
            onPress={post}
            palette={ready ? { fill: c.accent, text: c.onAccent, border: c.onAccent } : undefined}
          />
        </View>
      </KeyboardAvoidingView>

      <ParkPickerModal
        visible={sheet === 'park'}
        current={draft.park}
        onClose={() => setSheet(null)}
        onPick={(park) => park && set({ park: { ...park, timeZone: null }, seasons: [] })}
      />
      <DateTimeSheet
        visible={sheet === 'starts'}
        title={t('meetupCompose.starts')}
        value={draft.startsAt}
        timeZone={timeZone}
        onPick={(startsAt) => set({ startsAt, endsAt: null })}
        onClose={() => setSheet(null)}
      />
      <DateTimeSheet
        visible={sheet === 'ends'}
        title={t('meetupCompose.ends')}
        value={draft.endsAt}
        timeZone={timeZone}
        onlyTime={startDay ? { day: startDay } : undefined}
        optional
        onPick={(endsAt) => set({ endsAt })}
        onClose={() => setSheet(null)}
      />
      <DisciplinesSheet
        visible={sheet === 'disciplines'}
        value={draft.disciplines}
        onChange={(disciplines) => set({ disciplines })}
        onClose={() => setSheet(null)}
      />
      <RepeatsSheet
        visible={sheet === 'repeats'}
        value={{ weekdays: draft.weekdays, repeatEndsOn: draft.repeatEndsOn, seasons: draft.seasons }}
        startLabel={
          draft.startsAt
            ? t('meetupCompose.repeatTime', {
                start: clock(draft.startsAt),
                end: clock(draft.endsAt ?? endDefault!),
                park: draft.park?.name ?? '',
              })
            : null
        }
        onChange={(next: RepeatDraft) => set(next)}
        onClose={() => setSheet(null)}
      />
      <CoHostSheet
        visible={sheet === 'coHosts'}
        value={draft.coHosts}
        onChange={(coHosts) => set({ coHosts })}
        onClose={() => setSheet(null)}
      />
      <TitleSheet visible={sheet === 'title'} value={draft.title} onChange={(title) => set({ title })} onClose={() => setSheet(null)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1 },
  pressed: { opacity: 0.75 },
  center: { textAlign: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space[2],
    paddingVertical: space[1],
  },
  headerButton: { minWidth: 88, minHeight: 48 },
  modeSwitch: { paddingHorizontal: space[4], paddingTop: space[2] },
  content: { paddingTop: space[4], paddingBottom: space[6], gap: space[4] },
  pad: { paddingHorizontal: space[4], gap: space[2] },
  rows: { borderTopWidth: stroke.hairline },
  row: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingHorizontal: space[4],
    borderBottomWidth: stroke.hairline,
  },
  rowLabel: { width: 104 },
  input: {
    minHeight: 52,
    borderWidth: stroke.rule,
    paddingHorizontal: space[3],
    paddingVertical: space[3],
    fontFamily: fontFamily.sans,
    fontSize: 16,
  },
  radios: { flexDirection: 'row', gap: space[2] },
  radio: {
    flex: 1,
    minHeight: size.tapMin,
    borderWidth: stroke.rule,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[2],
  },
  coverRow: { flexDirection: 'row', alignItems: 'center' },
  cover: { width: 96, height: 64 },
  footer: { paddingHorizontal: space[4], paddingTop: space[3], paddingBottom: space[4], gap: space[2], borderTopWidth: stroke.hairline },
});
