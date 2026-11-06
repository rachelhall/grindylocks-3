import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  type TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GoingList, GoingSheet, MeetupCommentComposer, MeetupComments, type MeetupReply } from '@/components/meetup';
import { WhoForLine } from '@/components/meetup-card';
import { CancelMeetupSheet, CoHostsSheet, confirmDeleteMeetup, MeetupMenu } from '@/components/meetup-manage';
import { AdultsChip, dayHours, daysRangeLabel, HostedBy } from '@/components/page-meetup';
import { HalftoneGround, PHOTOCOPY } from '@/components/park-header';
import { openDirections } from '@/components/parks';
import { MasonryGrid } from '@/components/profile';
import { SafeAreaView } from '@/components/safe-area';
import { useReportSheet } from '@/components/safety';
import { BackButton, Button, CheckBox, Icon } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { useMyPages } from '@/lib/claims';
import { formatClock, localNow } from '@/lib/hours';
import {
  cancelReasonLabel,
  clocksDiffer,
  meetupHeadline,
  meetupPlaceName,
  meetupTz,
  repeatLabel,
  spotsLeft,
  useCanDeleteMeetup,
  useCanHideMeetup,
  useCoverUrl,
  useDeleteMeetup,
  useGoing,
  useHideMeetup,
  useHideMeetupStop,
  useMeetup,
  useMeetupCard,
  useMyHostRow,
  useRemoveFromGoing,
  useRespondCoHost,
  useSeriesFollow,
} from '@/lib/meetups';
import { roleRank } from '@/lib/page-team';
import { pageKind } from '@/lib/pages';
import { useMyProfile } from '@/lib/profiles';
import { Sentry } from '@/lib/sentry';
import { toGridPost, useMeetupPosts } from '@/lib/posts';
import { brand, fontFamily, size, space, stroke, Text, useColors } from '@/theme';

/**
 * A meetup date (mockup "Meetup page"): the header with its headline (the
 * title, or its one line when there's no title), when and where on the
 * park's clock (your own time too when you're elsewhere), who can see it
 * and its disciplines, the note, I'm going and Follow series, the going
 * list and comments. Once it's over (mockup "A past meetup"), the list gives
 * way to "12 went" and the posts linked to it ("From this session") in the
 * masonry grid. Opened with `going=1` (the I'm going button on a card), it
 * opens the Going sheet straight away.
 *
 * The ⋯ button (PR 5) opens the host menu (Edit, Co-hosts, Cancel, Delete)
 * for hosts and co-hosts, Report for everyone else, and Hide this date for
 * the park's admins. Hosts can take someone off Going from the list.
 *
 * Hosted by a page (PR 9, PageMeet-Page and PageMeet-Camp): the "Hosted by"
 * strip, OFFICIAL when it's the park's own page, the place (a park, the
 * shop or an address, with Directions), each day of a meetup over several
 * days, "18 of 30 spots taken" with FULL, the 18+ chip, Get tickets, and
 * the page as HOST in the going list and on its comments. The page's team
 * manages it as hosts and can comment as the page. Delete, ending the series
 * and co-hosts are for the page's managers and owner (and the member who
 * made it; the database decides).
 */
export default function MeetupScreen() {
  const { id, going: openGoing } = useLocalSearchParams<{ id: string; going?: string }>();
  const { t, i18n } = useTranslation();
  const c = useColors();
  const insets = useSafeAreaInsets();
  const locale = i18n.language;
  const { session } = useAuth();
  const myId = session?.user.id;

  const { data: meetup, isPending, isError, refetch } = useMeetup(id);
  const going = useGoing(id);
  const follow = useSeriesFollow(meetup?.series_id, myId);
  const hostRow = useMyHostRow(meetup?.series_id, myId);
  const respond = useRespondCoHost(meetup?.series_id);
  const cover = useCoverUrl(meetup?.cover_path);
  const { data: myProfile } = useMyProfile(myId);
  const hostPage = meetup?.meetup_host_page ?? null;
  const myPages = useMyPages(hostPage ? myId : undefined);
  const myPageRole = hostPage ? (myPages.data?.find((p) => p.pageId === hostPage.id)?.role ?? null) : null;
  const [goingOpen, setGoingOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [coHostsOpen, setCoHostsOpen] = useState(false);
  const mainHost = Boolean(
    meetup && myId && (meetup.series.host_id === myId || (meetup.i_run_meetup && roleRank(myPageRole) >= 2)),
  );
  const canDelete = useCanDeleteMeetup(id, mainHost && menuOpen);
  const canHide = useCanHideMeetup(id, (myProfile?.roles.length ?? 0) > 0);
  const remove = useDeleteMeetup(id);
  const hide = useHideMeetup(id);
  const hideStop = useHideMeetupStop(id);
  const removeGoing = useRemoveFromGoing(id);
  const report = useReportSheet();
  const [replyTo, setReplyTo] = useState<MeetupReply | null>(null);
  const inputRef = useRef<TextInput>(null);
  // When the page opened; enough to tell whether this date is over.
  const [now] = useState(() => Date.now());
  const { width } = useWindowDimensions();
  // Posts linked to this date can come from its start onwards.
  const started = meetup ? new Date(meetup.starts_at).getTime() <= now : false;
  const linked = useMeetupPosts(id, started);
  const counts = useMeetupCard(started ? id : undefined);

  // The card's I'm going button: open the sheet once we know you can go
  // (once only, decided while rendering, like the check-in sheet's reset).
  const [autoDone, setAutoDone] = useState(openGoing !== '1');
  const summaryNow = going.data?.summary;
  if (!autoDone && meetup && summaryNow) {
    setAutoDone(true);
    const ended = new Date(meetup.ends_at).getTime() <= now;
    if (!summaryNow.i_host && meetup.status !== 'cancelled' && !ended) setGoingOpen(true);
  }

  if (isPending || meetup === undefined) {
    return (
      <SafeAreaView style={[styles.screen, { backgroundColor: c.surface }]}>
        <View style={styles.topBar}>
          <BackButton />
        </View>
        {isError ? (
          <View style={styles.block}>
            <Text variant="body" color="statusClosed">
              {t('errors.network')}
            </Text>
            <Button label={t('common.retry')} variant="secondary" onPress={() => void refetch()} />
          </View>
        ) : (
          <ActivityIndicator color={c.text} style={styles.loading} />
        )}
      </SafeAreaView>
    );
  }
  if (!meetup) {
    return (
      <SafeAreaView style={[styles.screen, { backgroundColor: c.surface }]}>
        <View style={styles.topBar}>
          <BackButton />
        </View>
        <View style={styles.block}>
          <Text variant="body" color="textSecondary">
            {t('meetup.missing')}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const tz = meetupTz(meetup);
  const start = new Date(meetup.starts_at);
  const end = new Date(meetup.ends_at);
  const over = end.getTime() <= now;
  const cancelled = meetup.status === 'cancelled';
  const headline = meetupHeadline(meetup, t);
  const repeats = repeatLabel(meetup.series.weekdays, t, locale);
  const place = meetup.meetup_place_info;
  const placeName = meetupPlaceName(meetup, t);
  // More parks after the main place (PR 9b). Hosts and that park's admins also get hidden ones.
  const stops = meetup.meetup_stops ?? [];
  // The clock's name: the park's, else the host page's.
  const clockName = meetup.park?.display_name ?? place?.page?.display_name ?? hostPage?.display_name ?? placeName;
  const days = meetup.multi_day ? (meetup.meetup_days ?? []) : [];
  const several = days.length >= 2;
  const dayLine = several
    ? daysRangeLabel(new Date(days[0].starts_at), new Date(days[days.length - 1].starts_at), tz, locale, t)
    : `${new Intl.DateTimeFormat(locale, { weekday: 'short', month: 'short', day: 'numeric', timeZone: tz ?? undefined }).format(start)} · ${t('meetup.timeRange', {
        start: formatClock(localNow(start, tz).minutes, locale),
        end: formatClock(localNow(end, tz).minutes, locale),
      })}`;
  const left = spotsLeft(meetup);
  const full = left === 0;
  const ofThePark = Boolean(meetup.meetup_official);
  const yourTime = clocksDiffer(tz, start)
    ? new Intl.DateTimeFormat(locale, { weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(start)
    : null;

  const summary = going.data?.summary ?? null;
  const total = summary?.total ?? 0;
  const iHost = Boolean(summary?.i_host);
  const isHost = hostRow.data?.role === 'host' || (hostRow.data?.role === 'co_host' && hostRow.data.accepted_at);
  const invited = hostRow.data?.role === 'co_host' && !hostRow.data.accepted_at;
  const goingLine = [headline, dayLine, placeName].join(' · ');
  const pastDate = new Intl.DateTimeFormat(locale, { weekday: 'short', month: 'short', day: 'numeric', timeZone: tz ?? undefined }).format(start);
  const linkedPosts = linked.data?.pages.flat() ?? [];
  const linkedCount = counts.data?.linked_post_count ?? linkedPosts.length;

  const hosting = iHost || Boolean(isHost);
  const dateLabel = new Intl.DateTimeFormat(locale, { weekday: 'short', month: 'short', day: 'numeric', timeZone: tz ?? undefined }).format(start);
  const dayName = new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: tz ?? undefined }).format(start);
  const hostName = hostPage
    ? hostPage.display_name
    : meetup.series.host_id === myId
      ? (myProfile?.username ?? '')
      : (going.data?.people.find((p) => p.role === 'host')?.username ?? '');

  const deleteIt = () =>
    confirmDeleteMeetup(t, () =>
      remove.mutate(undefined, {
        onSuccess: () => router.back(),
        onError: (err) => {
          Sentry.captureException(err);
          Alert.alert(t('meetupMenu.deleteFailed'), t('meetupMenu.deleteFailedBody'));
        },
      }),
    );

  const setHidden = (next: boolean) => {
    const go = () =>
      hide.mutate(next, {
        onSuccess: () => void refetch(),
        onError: (err) => {
          Sentry.captureException(err);
          Alert.alert(t('errors.generic'));
        },
      });
    if (!next) return go();
    Alert.alert(t('meetupMenu.hideTitle'), t('meetupMenu.hideBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('meetupMenu.hide'), style: 'destructive', onPress: go },
    ]);
  };

  const takeOff = (personId: string, username: string | null) =>
    Alert.alert(t('meetup.removeTitle', { username: username ?? '' }), t('meetup.removeBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('meetup.remove'),
        style: 'destructive',
        onPress: () => removeGoing.mutate(personId, { onError: () => Alert.alert(t('errors.generic')) }),
      },
    ]);

  const answer = (accept: boolean) =>
    respond.mutate(accept, {
      onSuccess: () => {
        void hostRow.refetch();
        void going.refetch();
      },
      onError: () => Alert.alert(t('errors.generic')),
    });

  return (
    <View style={[styles.screen, { backgroundColor: c.surface }]}>
      <StatusBar style="light" />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView contentInsetAdjustmentBehavior="never" contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {/* Header: ink and halftone, or the cover photocopied. */}
          <View style={[styles.header, { paddingTop: insets.top + space[2] }]}>
            {cover.data ? (
              <>
                {/* Darkened like the park header's photo, so the paper headline stays readable. */}
                <Image source={{ uri: cover.data }} style={StyleSheet.absoluteFill} contentFit="cover" />
                <View style={[StyleSheet.absoluteFill, { backgroundColor: brand.ink, opacity: 1 - PHOTOCOPY.brightness }]} />
              </>
            ) : (
              // The halftone shader paints its own ink, so it's only for meetups without a cover.
              <HalftoneGround />
            )}
            <View style={styles.headerButtons}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('common.back')}
                onPress={() => router.back()}
                style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}
              >
                <Icon name="back" color={brand.ink} size={22} />
              </Pressable>
              {myId ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('meetupMenu.open')}
                  onPress={() => setMenuOpen(true)}
                  style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}
                >
                  <Icon name="more" color={brand.ink} size={22} />
                </Pressable>
              ) : null}
            </View>
            <View style={styles.headerText}>
              <View style={styles.tapes}>
                <View style={[styles.tape, { backgroundColor: brand.pink }]}>
                  <Text variant="label" style={{ color: brand.ink }}>
                    {over
                      ? t('meetupCard.pastTape', { date: pastDate })
                      : repeats
                        ? t('meetup.tapeRepeating', { repeats })
                        : t('meetup.tape')}
                  </Text>
                </View>
                {ofThePark ? (
                  <View style={[styles.officialTape, { borderColor: brand.paper }]}>
                    <Text variant="label" style={{ color: brand.paper }}>
                      {t('page.stamp.official')}
                    </Text>
                  </View>
                ) : null}
              </View>
              <Text
                variant="display"
                accessibilityRole="header"
                style={[styles.headline, cancelled && styles.struck]}
                numberOfLines={4}
              >
                {headline}
              </Text>
              {/* Who it's for (Org-Meetup): paper on the ink header. */}
              <WhoForLine text={meetup.who_for} color={brand.paper} size={15} />
            </View>
          </View>

          {hostPage ? <HostedBy page={hostPage} ofThePark={ofThePark} /> : null}

          {meetup.hidden_at ? (
            <View style={[styles.block, styles.cancelled, { borderColor: c.border }]}>
              <Text variant="label" color="textSecondary">
                {t('meetup.hiddenTitle')}
              </Text>
              <Text variant="bodySm" color="textSecondary">
                {t('meetup.hiddenBody')}
              </Text>
            </View>
          ) : null}

          {cancelled ? (
            <View style={[styles.block, styles.cancelled, { borderColor: c.statusClosed }]}>
              <Text variant="label" color="statusClosed">
                {t('meetup.cancelled', { reason: cancelReasonLabel(meetup.cancel_reason, hostPage, t) })}
              </Text>
              {meetup.cancel_note ? <Text variant="bodySm">{meetup.cancel_note}</Text> : null}
            </View>
          ) : null}

          {invited ? (
            <View style={[styles.block, styles.invite, { backgroundColor: c.accentSubtle, borderColor: c.border }]}>
              <Text variant="body" style={{ color: c.onAccentSubtle, fontFamily: fontFamily.sansSemiBold }}>
                {t('meetup.invitedToCoHost', { username: hostRow.data?.invited_by?.username ?? '' })}
              </Text>
              <Text variant="bodySm" style={{ color: c.onAccentSubtleSecondary }}>
                {t('meetup.coHostBody')}
              </Text>
              <View style={styles.inviteButtons}>
                <Button label={t('meetup.accept')} onPress={() => answer(true)} loading={respond.isPending && respond.variables} style={styles.flex} />
                <Button
                  label={t('meetup.decline')}
                  variant="secondary"
                  onPress={() => answer(false)}
                  loading={respond.isPending && respond.variables === false}
                  style={styles.flex}
                />
              </View>
            </View>
          ) : null}

          <View style={styles.block}>
            <View style={styles.fact}>
              <Icon name={several ? 'dateRange' : 'calendar'} color={c.text} size={20} />
              <View style={styles.flex}>
                <Text variant="body" style={{ fontFamily: fontFamily.sansSemiBold }}>
                  {dayLine}
                </Text>
                <Text variant="caption" color="textSecondary">
                  {[
                    several ? t('pageMeet.days', { count: days.length }) : null,
                    yourTime
                      ? t('meetup.parkTimeAndYours', { park: clockName, time: yourTime })
                      : t('meetup.parkTime', { park: clockName }),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
              </View>
            </View>
            {stops.length > 0 && meetup.place === 'park' ? null : meetup.place === 'park' && meetup.park ? (
              <Pressable
                accessibilityRole="link"
                onPress={() => router.push({ pathname: '/park/[slug]', params: { slug: meetup.park!.slug } })}
                style={styles.fact}
              >
                <Icon name="pin" color={c.text} size={20} />
                <Text variant="body" color="accentText" style={{ fontFamily: fontFamily.sansSemiBold }}>
                  {meetup.park.display_name}
                </Text>
              </Pressable>
            ) : (
              <View style={[styles.fact, styles.factTop]}>
                <Icon
                  name={meetup.place === 'page' ? (hostPage && pageKind(hostPage) === 'organizer' ? 'homePin' : 'storefront') : 'editLocation'}
                  color={c.text}
                  size={20}
                />
                <View style={[styles.flex, styles.placeText]}>
                  {meetup.place === 'page' && place?.page ? (
                    <Text
                      variant="body"
                      color="accentText"
                      accessibilityRole="link"
                      onPress={() => router.push({ pathname: '/page/[handle]', params: { handle: place.page!.handle } })}
                      style={{ fontFamily: fontFamily.sansSemiBold }}
                    >
                      {placeName}
                    </Text>
                  ) : null}
                  {place?.address ? (
                    <Text variant={meetup.place === 'page' ? 'bodySm' : 'body'} color={meetup.place === 'page' ? 'textSecondary' : 'text'} style={meetup.place === 'page' ? undefined : { fontFamily: fontFamily.sansSemiBold }}>
                      {[place.address, place.metro_name].filter(Boolean).join(', ')}
                    </Text>
                  ) : null}
                  {place && (place.latitude !== null || place.address) ? (
                    <Text
                      variant="bodySm"
                      color="accentText"
                      accessibilityRole="link"
                      onPress={() =>
                        openDirections({ latitude: place.latitude, longitude: place.longitude, display_name: placeName, address: place.address })
                      }
                      style={[styles.directions, { fontFamily: fontFamily.sansSemiBold }]}
                    >
                      {t('shop.directions')}
                    </Text>
                  ) : null}
                </View>
              </View>
            )}
            {meetup.capacity !== null ? (
              <View style={styles.fact}>
                <Icon name="people" color={c.text} size={20} />
                <Text variant="body">{t('pageMeet.spotsTaken', { taken: meetup.spots_taken ?? 0, capacity: meetup.capacity })}</Text>
                {full ? (
                  <View style={[styles.fullTag, { backgroundColor: c.text }]}>
                    <Text variant="label" style={{ color: c.surface }}>
                      {t('pageMeet.full')}
                    </Text>
                  </View>
                ) : null}
              </View>
            ) : null}
            <View style={styles.fact}>
              <Icon name={meetup.series.visibility === 'public' ? 'globe' : 'people'} color={c.text} size={20} />
              <Text variant="bodySm" color="textSecondary" style={styles.flex}>
                {meetup.series.visibility === 'public' ? t('meetupCompose.public') : t('meetupCompose.followersOnly')}
              </Text>
              {meetup.adults_only ? <AdultsChip /> : null}
              {meetup.disciplines.map((d) => (
                <View key={d} style={[styles.chip, { borderColor: c.border }]}>
                  <Text variant="caption" style={{ fontFamily: fontFamily.sansSemiBold }}>
                    {t(`disciplines.${d}`)}
                  </Text>
                </View>
              ))}
            </View>
          </View>

          {stops.length > 0 ? (
            <View style={styles.block}>
              <View style={styles.parksHead}>
                <Text variant="title" accessibilityRole="header" style={styles.flex}>
                  {t('hops.parks')}{' '}
                  <Text variant="title" color="textSecondary">
                    {stops.length + 1}
                  </Text>
                </Text>
                <Text variant="bodySm" color="textSecondary">
                  {t('hops.inOrder')}
                </Text>
              </View>
              <View style={[styles.days, { borderTopColor: c.borderSubtle }]}>
                <StopRow
                  n={1}
                  name={placeName}
                  start
                  onPress={
                    meetup.place === 'park' && meetup.park
                      ? () => router.push({ pathname: '/park/[slug]', params: { slug: meetup.park!.slug } })
                      : meetup.place === 'page' && place?.page
                        ? () => router.push({ pathname: '/page/[handle]', params: { handle: place.page!.handle } })
                        : undefined
                  }
                />
                {stops.map((s, i) => (
                  <StopRow
                    key={s.id}
                    n={i + 2}
                    name={s.display_name}
                    hidden={s.hidden}
                    onPress={() => router.push({ pathname: '/park/[slug]', params: { slug: s.slug } })}
                  />
                ))}
              </View>
            </View>
          ) : null}

          {several ? (
            <View style={styles.block}>
              <Text variant="label" color="textSecondary">
                {t('pageMeet.eachDay')}
              </Text>
              <View style={[styles.days, { backgroundColor: c.surfaceRaised, borderTopColor: c.borderSubtle }]}>
                {days.map((d) => (
                  <View key={d.day} style={[styles.dayRow, { borderBottomColor: c.borderSubtle }]}>
                    <Text variant="bodySm" style={[styles.dayName, { fontFamily: fontFamily.sansSemiBold }]}>
                      {new Intl.DateTimeFormat(locale, { weekday: 'short', month: 'short', day: 'numeric', timeZone: tz ?? undefined }).format(
                        new Date(d.starts_at),
                      )}
                    </Text>
                    <Text variant="bodySm">{dayHours(new Date(d.starts_at), new Date(d.ends_at), tz, locale)}</Text>
                  </View>
                ))}
              </View>
            </View>
          ) : null}

          {meetup.title && meetup.note ? (
            <Text variant="body" style={styles.block}>
              {meetup.note}
            </Text>
          ) : null}

          {meetup.ticket_url && !cancelled && !over ? (
            <View style={styles.block}>
              <Button
                label={t('pageMeet.getTickets')}
                icon="external"
                onPress={() => void Linking.openURL(meetup.ticket_url!).catch(() => Alert.alert(t('errors.generic')))}
                palette={{ fill: c.accent, text: c.onAccent, border: c.onAccent }}
              />
              <Text variant="caption" color="textSecondary" style={styles.center}>
                {t('pageMeet.ticketsNote', { name: hostPage?.display_name ?? '' })}
              </Text>
            </View>
          ) : null}

          {/* Going and Follow series. */}
          {!cancelled ? (
            <View style={[styles.block, styles.actions]}>
              {over ? (
                <View style={styles.wentBlock}>
                  <Text variant="displayXl" style={styles.wentNumber}>
                    {String(counts.data?.going_total ?? total)}
                  </Text>
                  <View style={styles.flex}>
                    <Text variant="headline" style={{ color: brand.paper }}>
                      {t('meetupCard.wentWord', { count: counts.data?.going_total ?? total })}
                    </Text>
                    <Text variant="bodySm" style={{ color: brand.paper, opacity: 0.75 }}>
                      {t('meetupCard.postsFromSession', { count: linkedCount })}
                    </Text>
                  </View>
                </View>
              ) : iHost || isHost ? (
                <View style={[styles.hosting, { borderColor: c.border }]}>
                  <Text variant="body" style={{ fontFamily: fontFamily.sansSemiBold }}>
                    {t('meetup.youreHosting')}
                  </Text>
                </View>
              ) : summary?.i_am_going ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setGoingOpen(true)}
                  style={({ pressed }) => [
                    styles.goingButton,
                    { borderColor: c.border, backgroundColor: c.accentSubtle },
                    pressed && styles.pressed,
                  ]}
                >
                  <CheckBox checked c={c} />
                  <Text variant="body" style={{ color: c.onAccentSubtle, fontFamily: fontFamily.sansSemiBold }}>
                    {summary.my_remind_me ? t('meetup.goingReminder') : t('meetup.going')}
                  </Text>
                </Pressable>
              ) : full ? (
                <View
                  accessible
                  accessibilityRole="button"
                  accessibilityState={{ disabled: true }}
                  style={[styles.hosting, styles.fullButton, { borderColor: c.textSecondary }]}
                >
                  <Icon name="block" color={c.textSecondary} size={18} />
                  <Text variant="body" color="textSecondary" style={{ fontFamily: fontFamily.sansSemiBold }}>
                    {t('pageMeet.full')}
                  </Text>
                </View>
              ) : (
                <Button label={t('meetup.imGoing')} icon="check" onPress={() => setGoingOpen(true)} style={styles.flex} />
              )}
              {meetup.series.weekdays.length > 0 && !meetup.series.ended_at && !(iHost || isHost) ? (
                <Button
                  label={follow.following ? t('meetup.followingSeries') : t('meetup.followSeries')}
                  variant="secondary"
                  onPress={() => follow.toggle.mutate(!follow.following)}
                />
              ) : null}
            </View>
          ) : null}

          {full && !over && !cancelled && !summary?.i_am_going && !(iHost || isHost) ? (
            <Text variant="caption" color="textSecondary" style={[styles.block, styles.center]}>
              {t('pageMeet.fullNote')}
            </Text>
          ) : null}

          {/* Going list: gone for everyone but the hosts once it's over. */}
          {!over || iHost ? (
            <View style={styles.block}>
              <Text variant="title" accessibilityRole="header">
                {over ? t('meetup.wentTitle') : t('meetup.goingTitle')}{' '}
                <Text variant="title" color="textSecondary">
                  {total}
                </Text>
              </Text>
              {going.isPending ? (
                <ActivityIndicator color={c.text} />
              ) : going.isError ? (
                <Text variant="bodySm" color="statusClosed">
                  {t('errors.network')}
                </Text>
              ) : (
                <GoingList
                  hostPage={hostPage}
                  people={going.data?.people ?? []}
                  unnamed={summary?.unnamed ?? 0}
                  hostView={iHost}
                  onRemove={hosting && !over && !cancelled ? takeOff : undefined}
                />
              )}
              {over && iHost ? (
                <Text variant="caption" color="textSecondary">
                  {t('meetup.hostsOnlyList')}
                </Text>
              ) : null}
            </View>
          ) : null}

          {/* From this session: posts linked to this date. */}
          {started && linkedPosts.length > 0 ? (
            <View style={styles.sessionPosts}>
              <Text variant="title" accessibilityRole="header" style={styles.block}>
                {t('meetupCard.fromThisSession')}
              </Text>
              <MasonryGrid posts={linkedPosts.map(toGridPost)} width={width} />
              {linked.hasNextPage ? (
                <View style={styles.block}>
                  <Button
                    label={t('meetupCard.showMore')}
                    variant="secondary"
                    loading={linked.isFetchingNextPage}
                    onPress={() => void linked.fetchNextPage()}
                  />
                </View>
              ) : null}
            </View>
          ) : null}

          <MeetupComments
            eventId={meetup.id}
            userId={myId}
            canModerate={iHost}
            onTeam={Boolean(meetup.i_run_meetup)}
            onReport={(cm) =>
              cm.page
                ? report.open({ kind: 'meetup_comment', id: cm.id, personId: null, username: cm.page.display_name, parkName: placeName })
                : cm.author_id && cm.username
                  ? report.open({
                      kind: 'meetup_comment',
                      id: cm.id,
                      personId: cm.author_id,
                      username: cm.username,
                      parkName: placeName,
                    })
                  : undefined
            }
            onReply={(target) => {
              setReplyTo(target);
              inputRef.current?.focus();
            }}
          />
        </ScrollView>

        <View style={{ paddingBottom: insets.bottom }}>
          <MeetupCommentComposer
            eventId={meetup.id}
            userId={myId}
            asPage={meetup.i_run_meetup && hostPage ? hostPage : null}
            replyTo={replyTo}
            onClearReply={() => setReplyTo(null)}
            inputRef={inputRef}
          />
        </View>
      </KeyboardAvoidingView>

      <MeetupMenu
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        hosting={hosting}
        mainHost={mainHost}
        canEdit={!over && !cancelled}
        canDelete={Boolean(canDelete.data)}
        canHide={Boolean(canHide.data)}
        hidden={Boolean(meetup.hidden_at)}
        onEdit={() => router.push({ pathname: '/new-meetup', params: { edit: meetup.id } })}
        onCoHosts={() => setCoHostsOpen(true)}
        onCancel={() => setCancelOpen(true)}
        onDelete={deleteIt}
        onReport={() =>
          report.open({
            kind: 'meetup',
            id: meetup.id,
            personId: meetup.series.host_id,
            username: hostName,
            parkName: placeName,
          })
        }
        onHide={setHidden}
        stops={stops.filter((s) => s.can_hide && s.id !== meetup.park_id)}
        onHideStop={(park, hide) =>
          hideStop.mutate(
            { park, hide },
            {
              onError: (err) => {
                Sentry.captureException(err);
                Alert.alert(t('errors.generic'));
              },
            },
          )
        }
      />
      <CancelMeetupSheet
        visible={cancelOpen}
        onClose={() => setCancelOpen(false)}
        eventId={meetup.id}
        dateLabel={dateLabel}
        dayName={dayName}
        repeating={meetup.series.weekdays.length > 0}
        mainHost={mainHost}
        goingCount={Math.max(0, total - (going.data?.people.filter((p) => p.role !== 'going').length ?? 0))}
        onCancelled={() => void refetch()}
      />
      {mainHost ? <CoHostsSheet visible={coHostsOpen} onClose={() => setCoHostsOpen(false)} seriesId={meetup.series_id} /> : null}
      {report.sheet}
      <GoingSheet
        visible={goingOpen}
        eventId={meetup.id}
        userId={myId}
        summary={summary}
        line={goingLine}
        adultsOnlyBy={meetup.adults_only ? (hostPage?.display_name ?? hostName) : null}
        spotsLeft={left}
        hasTickets={Boolean(meetup.ticket_url)}
        onClose={() => setGoingOpen(false)}
      />
    </View>
  );
}

/** One park on a park hop's list: its number, its name, START on the first (mockup Hop-Meetup). */
function StopRow({ n, name, start, hidden, onPress }: { n: number; name: string; start?: boolean; hidden?: boolean; onPress?: () => void }) {
  const { t } = useTranslation();
  const c = useColors();
  return (
    <Pressable
      accessibilityRole={onPress ? 'link' : undefined}
      accessibilityLabel={[t('hops.stopA11y', { n, park: name }), start ? t('hops.start') : null, hidden ? t('hops.hiddenHere') : null]
        .filter(Boolean)
        .join(', ')}
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => [styles.stopRow, { backgroundColor: c.surfaceRaised, borderBottomColor: c.borderSubtle }, pressed && styles.pressed]}
    >
      <View style={[styles.stopNumber, { backgroundColor: c.text }]}>
        <Text variant="bodySm" style={{ color: c.surface, fontFamily: fontFamily.sansSemiBold }}>
          {n}
        </Text>
      </View>
      <View style={styles.flex}>
        <Text variant="body" numberOfLines={1} style={{ fontFamily: fontFamily.sansSemiBold }}>
          {name}
        </Text>
        {hidden ? (
          <Text variant="caption" color="textSecondary">
            {t('hops.hiddenHere')}
          </Text>
        ) : null}
      </View>
      {start ? (
        <Text variant="label" color="textSecondary">
          {t('hops.start')}
        </Text>
      ) : null}
      {onPress ? <Icon name="chevron" color={c.textSecondary} size={20} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1 },
  pressed: { opacity: 0.75 },
  loading: { marginTop: space[12] },
  topBar: { paddingHorizontal: space[4], paddingVertical: space[2] },
  content: { gap: space[6], paddingBottom: space[6] },
  block: { paddingHorizontal: space[4], gap: space[2] },
  header: {
    minHeight: 240,
    backgroundColor: brand.ink,
    overflow: 'hidden',
    paddingHorizontal: space[4],
    paddingBottom: space[4],
    justifyContent: 'space-between',
    gap: space[4],
  },
  headerButtons: { flexDirection: 'row', justifyContent: 'space-between' },
  headerButton: { width: size.tapMin, height: size.tapMin, backgroundColor: brand.paper, alignItems: 'center', justifyContent: 'center' },
  headerText: { gap: space[3], alignItems: 'flex-start' },
  tapes: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  tape: { paddingHorizontal: space[2], paddingVertical: 4, transform: [{ rotate: '-2deg' }] },
  officialTape: { borderWidth: stroke.rule, paddingHorizontal: 6, paddingVertical: 2 },
  center: { textAlign: 'center' },
  factTop: { alignItems: 'flex-start' },
  placeText: { gap: 2 },
  directions: { paddingVertical: 4 },
  fullTag: { paddingHorizontal: 6, paddingVertical: 2 },
  fullButton: { flexDirection: 'row', gap: space[2] },
  days: { borderTopWidth: stroke.hairline },
  dayRow: { flexDirection: 'row', alignItems: 'baseline', gap: space[3], paddingHorizontal: space[3], paddingVertical: 10, borderBottomWidth: stroke.hairline },
  dayName: { width: 96 },
  parksHead: { flexDirection: 'row', alignItems: 'baseline', gap: space[2] },
  stopRow: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: space[3], paddingHorizontal: space[3], borderBottomWidth: stroke.hairline },
  stopNumber: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  headline: {
    color: brand.paper,
    textShadowColor: brand.pink,
    textShadowOffset: { width: 3, height: 3 },
    textShadowRadius: 0,
  },
  struck: { textDecorationLine: 'line-through' },
  cancelled: { borderWidth: stroke.rule, marginHorizontal: space[4], padding: space[3] },
  invite: { borderWidth: stroke.rule, marginHorizontal: space[4], padding: space[3] },
  inviteButtons: { flexDirection: 'row', gap: space[2] },
  fact: { flexDirection: 'row', alignItems: 'center', gap: space[3], minHeight: 32 },
  chip: { borderWidth: 1, paddingHorizontal: space[2], paddingVertical: 2 },
  actions: { flexDirection: 'row', gap: space[2], alignItems: 'center' },
  goingButton: {
    flex: 1,
    minHeight: size.tapMin,
    borderWidth: stroke.rule,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[2],
  },
  wentBlock: { flex: 1, backgroundColor: brand.ink, padding: space[4], flexDirection: 'row', alignItems: 'center', gap: space[3] },
  wentNumber: { color: brand.paper, textShadowColor: brand.pink, textShadowOffset: { width: 3, height: 3 }, textShadowRadius: 0 },
  sessionPosts: { gap: space[2] },
  hosting: { flex: 1, minHeight: size.tapMin, borderWidth: stroke.rule, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' },
});
