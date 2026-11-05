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
import {
  CapacitySheet,
  DatesSheet,
  daysRangeLabel,
  isTicketUrl,
  type PickedPlace,
  PlaceSheet,
  TicketsSheet,
} from '@/components/page-meetup';
import { PostingAsRow, usePostablePages } from '@/components/posting-as';
import { SafeAreaView } from '@/components/safe-area';
import { Caption, ParkPickerModal } from '@/components/tagging';
import { Button, CheckBox, Icon, type IconName, Toggle } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { formatClock, localNow } from '@/lib/hours';
import { pickFromLibrary } from '@/lib/media';
import {
  clocksDiffer,
  type DraftDay,
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
import { usePage } from '@/lib/pages';
import { useMyProfile } from '@/lib/profiles';
import { Sentry } from '@/lib/sentry';
import { fontFamily, size, space, stroke, Text, useColors } from '@/theme';

type SheetName = 'park' | 'place' | 'starts' | 'ends' | 'dates' | 'capacity' | 'tickets' | 'disciplines' | 'repeats' | 'coHosts' | 'title' | null;

/**
 * New › Meetup (mockup "New meetup · fast path"): park, start and an
 * optional line are enough ("I'll be at Memo Saturday at 4"). The end time
 * is optional (2 hours after the start). Who can see it starts at Public,
 * or Followers only for private accounts. "More, if you want" holds
 * disciplines, Repeats (with seasons), co-hosts, a title and a cover.
 * Opened from a park page's Plan a meetup with `park` and `parkName`.
 * New meetups never notify anyone; they show on Home for followers.
 *
 * Pages (PR 9, Shop-Meetup-Compose): someone who can post as a page gets
 * Posting as at the top. As a page, Park becomes Place (a park, the shop
 * itself or an address), and FOR PAGES adds Dates (one day or several),
 * Capacity, Tickets and 18+ only. Opened with `asPage` (a page's id, from
 * "Plan a meetup as …" on its screen) it starts as that page.
 *
 * Opened with `edit` (a date's id) it edits that date instead (PR 5): the
 * same rows filled in, without the Post/Meetup switch, Posting as, Repeats
 * or co-hosts (the meetup page's Co-hosts handles those). Saving a
 * repeating meetup asks "This date or all upcoming?". Only what changed is
 * sent; a new day, time or place tells the people going.
 */
export default function NewMeetup() {
  const { t, i18n } = useTranslation();
  const c = useColors();
  const locale = i18n.language;
  const { session, profile } = useAuth();
  const userId = session?.user.id;
  const { data: me } = useMyProfile(userId);
  const params = useLocalSearchParams<{ park?: string; parkName?: string; edit?: string; asPage?: string }>();
  const create = useCreateMeetup(userId);
  const editing = useMeetup(params.edit);
  const update = useUpdateMeetup(params.edit);
  const original = params.edit ? (editing.data ?? null) : null;
  const postable = usePostablePages(params.edit ? undefined : userId);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  // The cover a date already has; null once removed in this edit.
  const [keptCover, setKeptCover] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [draft, setDraft] = useState<MeetupDraft>(() => ({
    asPage: params.asPage ?? null,
    place: 'park',
    park: params.park && params.parkName ? { id: params.park, name: params.parkName, timeZone: null } : null,
    address: null,
    days: null,
    capacity: null,
    ticketUrl: '',
    adultsOnly: false,
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
  const set = (patch: Partial<MeetupDraft>) => setDraft((d) => ({ ...d, ...patch }));

  // The page it's made as: one you can post as, or (editing) the page hosting it.
  const asPageId = original ? original.series.host_page_id : draft.asPage;
  const myPage = postable.find((p) => p.pageId === draft.asPage) ?? null;
  const pageHandle = original ? (original.meetup_host_page?.handle ?? null) : (myPage?.handle ?? null);
  const { data: hostPage = null } = usePage(pageHandle ?? undefined);
  const asPage = asPageId && hostPage && hostPage.id === asPageId ? hostPage : null;
  const pageName = asPage?.displayName ?? myPage?.displayName ?? original?.meetup_host_page?.display_name ?? null;
  const forPage = Boolean(asPageId);
  const visibility = visibilityPicked ? draft.visibility : !forPage && me?.isPrivate ? 'followers' : 'public';

  // Editing: fill the draft from the date once it loads.
  if (original && loadedFor !== original.id) {
    setLoadedFor(original.id);
    setVisibilityPicked(true);
    setKeptCover(original.cover_path);
    const info = original.meetup_place_info;
    const days = (original.meetup_days ?? []).map((d) => ({ startsAt: new Date(d.starts_at), endsAt: new Date(d.ends_at) }));
    setDraft({
      asPage: original.series.host_page_id,
      place: original.place,
      park: original.park ? { id: original.park.id, name: original.park.display_name, timeZone: original.park.metro?.timezone ?? null } : null,
      address:
        original.place === 'address' && info?.address && info.latitude !== null && info.longitude !== null
          ? { text: info.address, latitude: info.latitude, longitude: info.longitude }
          : null,
      days: original.multi_day && days.length >= 2 ? days : null,
      capacity: original.capacity,
      ticketUrl: original.ticket_url ?? '',
      adultsOnly: original.adults_only,
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

  // Times are on the place's clock: the park's, else the page's own.
  const { data: parkTz = null } = useParkTimeZone(draft.place === 'park' ? draft.park?.id : undefined);
  const timeZone = draft.place === 'park' ? parkTz : (asPage?.timeZone ?? original?.meetup_timezone ?? null);
  const clock = (d: Date) => formatClock(localNow(d, timeZone).minutes, locale);
  const dayAndTime = (d: Date) =>
    `${new Intl.DateTimeFormat(locale, { weekday: 'short', month: 'short', day: 'numeric', timeZone: timeZone ?? undefined }).format(d)} · ${clock(d)}`;

  const placeLabel =
    draft.place === 'page'
      ? t('pageMeet.theShop', { name: pageName ?? '' })
      : draft.place === 'address'
        ? (draft.address?.text ?? null)
        : (draft.park?.name ?? null);
  const placed = draft.place === 'park' ? Boolean(draft.park) : draft.place === 'address' ? Boolean(draft.address) : true;
  const timed = draft.days ? draft.days.length >= 2 : Boolean(draft.startsAt);
  const endDefault = draft.startsAt ? new Date(draft.startsAt.getTime() + 2 * 60 * 60 * 1000) : null;
  const ready = placed && timed && !create.isPending && !saving && (!params.edit || Boolean(original)) && (!forPage || !draft.ticketUrl || isTicketUrl(draft.ticketUrl));
  const repeats = repeatLabel(draft.weekdays, t, locale);
  const startDay = draft.startsAt ? localNow(draft.startsAt, timeZone) : null;
  const firstStart = draft.days?.[0]?.startsAt ?? draft.startsAt;

  /** Posting as you again clears everything only pages have. */
  const pickAs = (pageId: string | null) => {
    if (pageId === draft.asPage) return;
    set({
      asPage: pageId,
      ...(pageId
        ? {}
        : {
            place: 'park' as const,
            address: null,
            park: draft.place === 'park' ? draft.park : null,
            days: null,
            capacity: null,
            ticketUrl: '',
            adultsOnly: false,
          }),
    });
  };

  const pickPlace = (p: PickedPlace) => {
    if (p.place === 'park') set({ place: 'park', park: { ...p.park, timeZone: null }, address: null, seasons: [] });
    else if (p.place === 'page') set({ place: 'page', park: null, address: null, seasons: [] });
    else set({ place: 'address', park: null, address: p.address, seasons: [] });
  };

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
    if (!original || !placed || !timed) return;
    const changes: MeetupChanges = {};
    const info = original.meetup_place_info;
    if (draft.place !== original.place) changes.place = draft.place;
    if (draft.place === 'park' && draft.park && draft.park.id !== original.park_id) {
      changes.park = draft.park.id;
      if (forPage) changes.place = 'park';
    }
    if (
      draft.place === 'address' &&
      draft.address &&
      (draft.address.text !== info?.address || draft.address.latitude !== info?.latitude || draft.address.longitude !== info?.longitude)
    ) {
      changes.place = 'address';
      changes.address = draft.address.text;
      changes.latitude = draft.address.latitude;
      changes.longitude = draft.address.longitude;
    }
    if (draft.days) {
      const key = (a: Date, b: Date) => `${a.toISOString()}|${b.toISOString()}`;
      const was = (original.meetup_days ?? []).map((d) => key(new Date(d.starts_at), new Date(d.ends_at))).join();
      const now = draft.days.map((d) => key(d.startsAt, d.endsAt)).join();
      if (was !== now) {
        changes.days = draft.days.map((d) => ({ starts_at: d.startsAt.toISOString(), ends_at: d.endsAt.toISOString() }));
      }
    } else if (draft.startsAt) {
      if (draft.startsAt.getTime() !== new Date(original.starts_at).getTime()) changes.starts_at = draft.startsAt.toISOString();
      if (draft.endsAt) {
        // An end before the start means it runs past midnight.
        const endsAt = draft.endsAt <= draft.startsAt ? new Date(draft.endsAt.getTime() + 24 * 60 * 60 * 1000) : draft.endsAt;
        if (endsAt.getTime() !== new Date(original.ends_at).getTime()) changes.ends_at = endsAt.toISOString();
      }
    }
    if (forPage) {
      if (draft.capacity !== original.capacity) changes.capacity = draft.capacity ?? '';
      if (draft.ticketUrl.trim() !== (original.ticket_url ?? '')) changes.ticket_url = draft.ticketUrl.trim();
      if (draft.adultsOnly !== original.adults_only) changes.adults_only = draft.adultsOnly;
    }
    if (draft.title.trim() !== (original.title ?? '')) changes.title = draft.title.trim();
    if (draft.note.trim() !== (original.note ?? '')) changes.note = draft.note.trim();
    if ([...draft.disciplines].sort().join() !== [...original.disciplines].sort().join()) changes.disciplines = draft.disciplines;
    if (visibility !== original.series.visibility) changes.visibility = visibility;
    setSaving(true);
    try {
      if (draft.cover && userId) changes.cover_path = await uploadMeetupCover(userId, draft.cover.uri);
      else if (!keptCover && original.cover_path) changes.cover_path = '';
      if (Object.keys(changes).length === 0) {
        router.back();
        return;
      }
      await update.mutateAsync({ scope, changes });
      router.back();
    } catch (err) {
      Sentry.captureException(err);
      const message = (err as { message?: string } | null)?.message ?? '';
      Alert.alert(
        t('meetupEdit.failed'),
        message.includes('seasons') ? t('meetupEdit.seasonsPark') : forPage ? t('pageMeet.failedPage') : t('meetupCompose.failedBody'),
      );
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
      { ...draft, endsAt, visibility, weekdays: draft.days ? [] : draft.weekdays },
      {
        onSuccess: (id) => router.replace({ pathname: '/meetup/[id]', params: { id } }),
        onError: (err) => {
          Sentry.captureException(err);
          const denied = (err as { code?: string } | null)?.code === '42501';
          Alert.alert(
            t('meetupCompose.failed'),
            denied && pageName ? t('pageMeet.cantHost', { name: pageName }) : forPage ? t('pageMeet.failedPage') : t('meetupCompose.failedBody'),
          );
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

  const days = draft.days;
  const daysValue = days
    ? `${daysRangeLabel(days[0].startsAt, days[days.length - 1].startsAt, timeZone, locale, t)} · ${t('pageMeet.days', { count: days.length })}`
    : t('pageMeet.oneDay');
  const footer = params.edit
    ? t('meetupEdit.footer')
    : forPage && pageName
      ? visibility === 'followers'
        ? t('pageMeet.footerPageFollowers', { name: pageName })
        : t('pageMeet.footerPage', { name: pageName })
      : visibility === 'followers'
        ? t('meetupCompose.footerFollowers')
        : t('meetupCompose.footer');

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
          <NewModeSwitch mode="meetup" park={draft.place === 'park' ? draft.park : null} />
        </View>
      )}

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {!params.edit && postable.length > 0 && me ? (
            <View style={styles.pad}>
              <PostingAsRow
                username={me.username ?? ''}
                avatarPath={me.avatarPath ?? null}
                pages={postable}
                value={draft.asPage}
                onChange={pickAs}
                reach={false}
              />
            </View>
          ) : null}

          <View>
            <View style={[styles.rows, { borderTopColor: c.borderSubtle }]}>
              {forPage
                ? row('pin', t('pageMeet.place'), placeLabel ?? t('pageMeet.pickPlace'), placed, () => (asPage ? setSheet('place') : undefined), true)
                : row('pin', t('meetupCompose.park'), draft.park?.name ?? t('meetupCompose.pickPark'), Boolean(draft.park), () => setSheet('park'), true)}
              {/* Several days are set under FOR PAGES › Dates instead. */}
              {days
                ? null
                : row(
                    'calendar',
                    t('meetupCompose.starts'),
                    draft.startsAt ? dayAndTime(draft.startsAt) : t('meetupCompose.pickTime'),
                    Boolean(draft.startsAt),
                    () => setSheet('starts'),
                    true,
                  )}
              {days
                ? null
                : row(
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
            {forPage ? (
              <Text variant="caption" color="textSecondary" style={[styles.pad, styles.hint]}>
                {asPage && !asPage.roles.includes('shop') ? t('pageMeet.placeHintBrand') : t('pageMeet.placeHint')}
              </Text>
            ) : null}
          </View>
          {firstStart && clocksDiffer(timeZone, firstStart) ? (
            <Text variant="caption" color="textSecondary" style={styles.pad}>
              {t('meetupCompose.parkTimeNote', {
                time: new Intl.DateTimeFormat(locale, { weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(firstStart),
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
              placeholder={t('meetupCompose.linePlaceholder', { park: placeLabel ?? 'Memo' })}
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

          {forPage ? (
            <View>
              <View style={styles.pad}>
                <Caption>{t('pageMeet.forPages')}</Caption>
              </View>
              <View style={[styles.rows, { borderTopColor: c.borderSubtle }]}>
                {/* Editing can't turn one day into several, or back (the database changes them separately). */}
                {!original || original.multi_day ? row('dateRange', t('pageMeet.dates'), daysValue, Boolean(days), () => setSheet('dates')) : null}
                {row(
                  'people',
                  t('pageMeet.capacity'),
                  draft.capacity ? t('pageMeet.capacityValue', { count: draft.capacity }) : t('pageMeet.noLimit'),
                  Boolean(draft.capacity),
                  () => setSheet('capacity'),
                )}
                {row(
                  'ticket',
                  t('pageMeet.tickets'),
                  draft.ticketUrl ? t('pageMeet.linkAdded') : t('pageMeet.addLink'),
                  Boolean(draft.ticketUrl),
                  () => setSheet('tickets'),
                )}
                <View style={[styles.row, { borderBottomColor: c.borderSubtle }]}>
                  <Icon name="idBadge" color={c.text} size={22} />
                  <View style={styles.flex}>
                    <Text variant="body" style={{ fontFamily: fontFamily.sansSemiBold }}>
                      {t('pageMeet.adultsOnly')}
                    </Text>
                    <Text variant="caption" color="textSecondary">
                      {t('pageMeet.adultsOnlyBody')}
                    </Text>
                  </View>
                  <Toggle value={draft.adultsOnly} onChange={(adultsOnly) => set({ adultsOnly })} label={t('pageMeet.adultsOnly')} fg={c.text} />
                </View>
              </View>
              <Text variant="caption" color="textSecondary" style={[styles.pad, styles.hint]}>
                {t('pageMeet.ticketsFooter')}
              </Text>
            </View>
          ) : null}

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
                    days
                      ? Alert.alert(t('pageMeet.severalNoRepeat'))
                      : placed && draft.startsAt
                        ? setSheet('repeats')
                        : Alert.alert(t('meetupCompose.repeatsFirst')),
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
            {footer}
          </Text>
          <Button
            label={params.edit ? t('meetupEdit.save') : forPage && pageName ? t('pageMeet.postAs', { name: pageName }) : t('meetupCompose.post')}
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
      {asPage ? (
        <PlaceSheet
          visible={sheet === 'place'}
          page={asPage}
          current={
            draft.place === 'page'
              ? { place: 'page' }
              : draft.place === 'address' && draft.address
                ? { place: 'address', address: draft.address }
                : draft.park
                  ? { place: 'park', park: { id: draft.park.id, name: draft.park.name } }
                  : null
          }
          onPick={pickPlace}
          onClose={() => setSheet(null)}
        />
      ) : null}
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
      <DatesSheet
        visible={sheet === 'dates'}
        timeZone={timeZone}
        value={draft.days}
        fixed={Boolean(original?.multi_day)}
        onChange={(next: DraftDay[] | null) =>
          next
            ? set({ days: next, startsAt: next[0].startsAt, endsAt: next[next.length - 1].endsAt, weekdays: [], seasons: [] })
            : set({ days: null, ...(days ? { startsAt: null, endsAt: null } : {}) })
        }
        onClose={() => setSheet(null)}
      />
      <CapacitySheet visible={sheet === 'capacity'} value={draft.capacity} onChange={(capacity) => set({ capacity })} onClose={() => setSheet(null)} />
      <TicketsSheet visible={sheet === 'tickets'} value={draft.ticketUrl} onChange={(ticketUrl) => set({ ticketUrl })} onClose={() => setSheet(null)} />
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
                park: placeLabel ?? '',
              })
            : null
        }
        seasons={draft.place === 'park'}
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
  hint: { paddingTop: space[2] },
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
