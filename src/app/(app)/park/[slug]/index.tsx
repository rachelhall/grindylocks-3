import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, Animated, Linking, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SafeAreaView } from '@/components/safe-area';

import { HereNowSection } from '@/components/here-now';
import { ParkPastMeetups, ParkUpcomingMeetups } from '@/components/park-meetups';
import { HEADER_HEIGHT, ParkHeader } from '@/components/park-header';
import { AddParkPhotosSheet, NoPhotosCard, RoleBadge } from '@/components/park-photos';
import { PinnedBar } from '@/components/pinned-bar';
import { ParkPosts, ParkRegulars } from '@/components/park-social';
import { BookmarkIcon, DisciplineChips, IconButton, openDirections, StatusChip } from '@/components/parks';
import { BackButton, Button, Icon, useActionSheet } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import {
  dayRanges,
  formatClock,
  formatMonthDay,
  localNow,
  openState,
  type SessionRow,
  sunTime,
  weekdayName,
} from '@/lib/hours';
import { pickFromLibrary, type PickedMedia } from '@/lib/media';
import { MAX_PARK_PHOTOS, useParkPhotos, useParkRole } from '@/lib/park-photos';
import { type Discipline, type ParkDetail, pickDescription, usePark, useSavedParks } from '@/lib/parks';
import { fontFamily, size, space, stroke, Text, useColors } from '@/theme';

type HoursLine = { key: string; season: string | null; days: string; time: string; disciplines: Discipline[]; note: string | null };

/**
 * The park page, per the Park page mockups: a header with the park's name
 * (on its first photo, photocopied, or on ink), then what's there, when it's
 * open, who can skate, and its obstacles. People with a role at the park
 * add photos from here. Here now (Meetups v2) sits under Save. Then its
 * regulars and latest posts (M4a). Each
 * obstacle opens its own feed. Anyone can report wrong info (M5) from the
 * More menu or the "Suggest a fix" link by the last-verified line.
 */
export default function ParkScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { t, i18n } = useTranslation();
  const c = useColors();
  const { session, profile } = useAuth();
  const { saved, toggle } = useSavedParks(session?.user.id);
  // Shared with the map card's cache entry, so a park opened from its card
  // shows straight away. `null` means no park has this slug.
  const { data: park, isError, refetch } = usePark(slug);
  const failed = isError && park === undefined;
  const { data: photos = [] } = useParkPhotos(park?.id);
  const { role, canContribute } = useParkRole(session?.user.id, park?.id);
  const { sheet, show: showActions } = useActionSheet();
  const [picked, setPicked] = useState<PickedMedia[]>([]);
  const insets = useSafeAreaInsets();
  // Drives the pinned bar's fade (natively, with the scroll).
  const [scrollY] = useState(() => new Animated.Value(0));

  const locale = i18n.language;
  const place = useMemo(
    () =>
      park ? { latitude: park.latitude, longitude: park.longitude, timeZone: park.metro?.timezone ?? null } : null,
    [park],
  );

  // Sunrise and sunset on today's date at the park, for "sunrise–sunset" hours.
  const sunLabel = useMemo(() => {
    if (!place || place.latitude === null || place.longitude === null) return null;
    const today = localNow(new Date(), place.timeZone);
    const label = (which: 'sunrise' | 'sunset') => {
      const d = sunTime(today, place.latitude!, place.longitude!, which);
      return d ? formatClock(localNow(d, place.timeZone).minutes, locale) : null;
    };
    return { sunrise: label('sunrise'), sunset: label('sunset') };
  }, [place, locale]);

  const hours: HoursLine[] = useMemo(() => {
    if (!park) return [];
    const timeOf = (anchor: SessionRow['start_anchor'], time: string | null) => {
      if (anchor === 'sunrise' || anchor === 'sunset') {
        const at = sunLabel?.[anchor];
        return at ? `${t(`park.${anchor}`)} (${at})` : t(`park.${anchor}`);
      }
      if (!time) return null;
      const [h, m] = time.split(':').map(Number);
      return formatClock(h * 60 + m, locale);
    };
    return [...park.sessions]
      .sort((a, b) => (a.season_start_month ?? 0) - (b.season_start_month ?? 0) || a.days[0] - b.days[0])
      .map((s) => {
        const start = timeOf(s.start_anchor, s.start_time);
        const end = timeOf(s.end_anchor, s.end_time);
        const ranges = dayRanges(s.days);
        const days =
          ranges.length === 1 && ranges[0][0] === 1 && ranges[0][1] === 7
            ? t('park.daily')
            : ranges
                .map(([a, b]) => (a === b ? weekdayName(a, locale) : `${weekdayName(a, locale)}–${weekdayName(b, locale)}`))
                .join(', ');
        return {
          key: s.id,
          season:
            s.season_start_month && s.season_end_month
              ? t('park.season', {
                  start: formatMonthDay(s.season_start_month, s.season_start_day ?? 1, locale),
                  end: formatMonthDay(s.season_end_month, s.season_end_day ?? 31, locale),
                })
              : null,
          days,
          time: start && end ? t('park.timeRange', { start, end }) : t('park.hoursUnknown'),
          disciplines: s.disciplines,
          note: s.note,
        };
      });
  }, [park, sunLabel, t, locale]);

  if (park === undefined && !failed) {
    return (
      <SafeAreaView style={[styles.screen, { backgroundColor: c.surface }]}>
        <View style={styles.topBar}>
          <BackButton />
        </View>
        <ActivityIndicator color={c.text} style={styles.loading} />
      </SafeAreaView>
    );
  }
  if (!park) {
    return (
      <SafeAreaView style={[styles.screen, { backgroundColor: c.surface }]}>
        <View style={styles.topBar}>
          <BackButton />
        </View>
        <View style={styles.block}>
          <Text variant="body" color="textSecondary">
            {failed ? t('errors.network') : t('park.missing')}
          </Text>
          {failed ? <Button label={t('common.retry')} onPress={() => void refetch()} /> : null}
          <Button label={t('common.back')} variant="secondary" onPress={() => router.back()} />
        </View>
      </SafeAreaView>
    );
  }

  const state = openState(park.status, park.sessions, place!);
  const isSaved = saved.has(park.id);
  const allDisciplines = [...new Set(park.sessions.flatMap((s) => s.disciplines))];
  // Show each line's disciplines only where they differ between lines.
  const disciplinesVary = new Set(park.sessions.map((s) => [...s.disciplines].sort().join(','))).size > 1;
  const description = pickDescription(park.descriptions, locale);
  const dateFmt = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' });
  const subtitle = [park.official_name !== park.display_name ? park.official_name : null, park.address]
    .filter(Boolean)
    .join(' · ');

  const facts: { label: string; value: string }[] = [
    {
      label: t('park.lights'),
      value:
        park.night_lighting === true ? t('park.litYes') : park.night_lighting === false ? t('park.litNo') : t('park.unknown'),
    },
    { label: t('park.surface'), value: park.surface ? park.surface : t('park.unknown') },
    {
      label: t('park.entry'),
      value: [park.is_paid ? t('park.paid') : t('park.free'), park.setting ? t(`park.setting.${park.setting}`) : null]
        .filter(Boolean)
        .join(' · '),
    },
    { label: t('park.hours'), value: todayHours(park, hours, t('park.hoursUnknown')) },
  ];

  const remaining = MAX_PARK_PHOTOS - photos.length;
  const openGallery = () => router.push({ pathname: '/park/[slug]/photos', params: { slug: park.slug } });

  const addPhotos = async () => {
    if (remaining <= 0) {
      Alert.alert(t('parkPhotos.full', { max: MAX_PARK_PHOTOS }));
      return;
    }
    try {
      const { picked: chosen, rejected } = await pickFromLibrary(remaining, { photosOnly: true });
      if (rejected.length > 0) Alert.alert(t('parkPhotos.unsupported'));
      if (chosen.length > 0) setPicked(chosen.slice(0, remaining));
    } catch {
      Alert.alert(t('errors.generic'));
    }
  };

  const reportInfo = () => router.push({ pathname: '/park/[slug]/report', params: { slug: park.slug } });

  const more = () =>
    showActions({
      title: park.display_name,
      actions: [
        ...(photos.length > 0 ? [{ label: t('parkPhotos.see'), onPress: openGallery }] : []),
        ...(canContribute && remaining > 0 ? [{ label: t('parkPhotos.addPark'), onPress: () => void addPhotos() }] : []),
        { label: t('park.directions'), onPress: () => openDirections(park) },
        { label: t('parkReport.menu'), onPress: reportInfo },
      ],
    });

  return (
    <View style={[styles.screen, { backgroundColor: c.surface }]}>
      {/* The header and the pinned bar are ink in both themes, so the clock stays light. */}
      <StatusBar style="light" />
      <PinnedBar
        scrollY={scrollY}
        headerHeight={HEADER_HEIGHT}
        name={park.display_name}
        moreLabel={t('park.more')}
        onBack={() => router.back()}
        onMore={more}
      />
      <Animated.ScrollView
        // The header runs up under the status bar.
        contentInsetAdjustmentBehavior="never"
        contentContainerStyle={[styles.content, { paddingBottom: space[12] + insets.bottom }]}
        scrollEventThrottle={16}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true })}
      >
        <ParkHeader
          name={park.display_name}
          tape={[park.metro?.name ?? park.city, t(`park.type.${park.park_type}`)].join(' · ')}
          photoUrl={photos[0]?.url ?? null}
          onOpenGallery={photos.length > 0 ? openGallery : undefined}
          onAddPhotos={canContribute ? () => void addPhotos() : undefined}
        />

        <View style={[styles.block, styles.intro]}>
          {subtitle ? (
            <Text variant="bodySm" color="textSecondary">
              {subtitle}
            </Text>
          ) : null}
          {/* A private park links to the business that runs it (part A, PR 3). */}
          {park.runBy ? (
            <Text
              variant="bodySm"
              color="accentText"
              accessibilityRole="link"
              onPress={() => router.push({ pathname: '/page/[handle]', params: { handle: park.runBy!.handle } })}
              style={{ fontFamily: fontFamily.sansSemiBold }}
            >
              {t('park.runBy', { name: park.runBy.displayName })}
            </Text>
          ) : null}
          <View style={styles.chipRow}>
            <StatusChip state={state} />
            {park.verified_at ? (
              <View style={[styles.verified, { borderColor: c.border }]}>
                <Icon name="check" color={c.text} size={14} />
                <Text variant="bodySm" style={{ fontFamily: fontFamily.sansSemiBold }}>
                  {t('park.verified', { date: dateFmt.format(new Date(park.verified_at)) })}
                </Text>
              </View>
            ) : (
              <View style={[styles.chip, { borderColor: c.statusSoon }]}>
                <Text variant="label" color="statusSoon">
                  {t('park.notVerified')}
                </Text>
              </View>
            )}
            {role ? <RoleBadge role={role} /> : null}
          </View>
        </View>

        {canContribute && photos.length === 0 ? (
          <View style={styles.block}>
            <NoPhotosCard onAdd={() => void addPhotos()} />
          </View>
        ) : null}

        <View style={[styles.block, styles.actions]}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: isSaved }}
            accessibilityLabel={
              isSaved ? t('park.savedLabel', { park: park.display_name }) : t('park.saveLabel', { park: park.display_name })
            }
            onPress={() => void toggle(park.id)}
            style={({ pressed }) => [
              styles.saveButton,
              isSaved
                ? { backgroundColor: c.surfaceRaised, borderColor: c.border }
                : { backgroundColor: c.text, borderColor: c.text },
              pressed && styles.pressed,
            ]}
          >
            <BookmarkIcon saved={isSaved} color={c.surface} />
            <Text variant="headline" style={{ color: isSaved ? c.text : c.surface, fontSize: 16 }}>
              {isSaved ? t('park.saved') : t('park.save')}
            </Text>
          </Pressable>
          <IconButton icon="directions" label={t('park.directions')} onPress={() => openDirections(park)} />
        </View>

        {/* Meetups (v2): who's checked in, then Upcoming, then Plan a meetup. */}
        <HereNowSection park={park} />
        <ParkUpcomingMeetups parkId={park.id} />
        <View style={styles.block}>
          <Button
            label={t('meetup.plan')}
            icon="add"
            onPress={() =>
              router.push({ pathname: '/new-meetup', params: { park: park.id, parkName: park.display_name } })
            }
            palette={{ fill: c.accent, text: c.onAccent, border: c.onAccent }}
          />
        </View>

        <View style={[styles.block, styles.grid]}>
          {facts.map((f) => (
            <View key={f.label} style={[styles.fact, { backgroundColor: c.surfaceRaised }]}>
              <Text variant="label" color="textSecondary">
                {f.label}
              </Text>
              <Text variant="body" style={{ fontFamily: fontFamily.sansSemiBold }}>
                {f.value}
              </Text>
            </View>
          ))}
          {allDisciplines.length > 0 ? (
            <View style={[styles.fact, styles.factWide, { backgroundColor: c.surfaceRaised }]}>
              <Text variant="label" color="textSecondary">
                {t('park.whoCanSkate')}
              </Text>
              <DisciplineChips disciplines={allDisciplines} mine={profile?.disciplines ?? []} />
            </View>
          ) : null}
        </View>

        {park.helmet_required ? (
          <Text variant="bodySm" style={[styles.block, { fontFamily: fontFamily.sansSemiBold }]}>
            {t('park.helmet')}
          </Text>
        ) : null}

        {description ? (
          <Text variant="body" style={styles.block}>
            {description}
          </Text>
        ) : null}

        {/* Hours */}
        <View style={styles.block}>
          <Text variant="title" accessibilityRole="header">
            {t('park.hours')}
          </Text>
          <View style={styles.hours}>
            {hours.map((h) => (
              <View key={h.key} style={[styles.hoursRow, { borderBottomColor: c.borderSubtle }]}>
                {h.season ? (
                  <Text variant="label" color="textSecondary">
                    {h.season}
                  </Text>
                ) : null}
                <View style={styles.hoursMain}>
                  <Text variant="body" style={[styles.hoursDays, { fontFamily: fontFamily.sansSemiBold }]}>
                    {h.days}
                  </Text>
                  <Text variant="body" style={styles.flex}>
                    {h.time}
                  </Text>
                </View>
                {disciplinesVary ? (
                  <Text variant="bodySm" color="textSecondary">
                    {h.disciplines.map((d) => t(`disciplines.${d}`)).join(', ')}
                  </Text>
                ) : null}
                {h.note ? (
                  <Text variant="bodySm" color="textSecondary">
                    {h.note}
                  </Text>
                ) : null}
              </View>
            ))}
          </View>
          {park.is_paid && park.entry_fee ? (
            <View style={styles.fees}>
              <Text variant="label" color="textSecondary">
                {t('park.fees')}
              </Text>
              <Text variant="bodySm">{park.entry_fee}</Text>
            </View>
          ) : null}
        </View>

        {/* Obstacles */}
        <View style={styles.block}>
          <Text variant="title" accessibilityRole="header">
            {t('park.obstacles')}{' '}
            <Text variant="title" color="textSecondary">
              {park.obstacles.length}
            </Text>
          </Text>
          {park.obstacles.length === 0 ? (
            // A dashed box, like No regulars yet: tag one when you post here,
            // or report what's missing (Empty-Park-NoObstacles).
            <View style={[styles.noObstacles, { borderColor: c.textMuted }]}>
              <Icon name="category" color={c.textSecondary} size={22} />
              <Text variant="bodySm" color="textSecondary" style={styles.flex}>
                {t('empty.noObstaclesBody')}{' '}
                <Text variant="bodySm" color="accentText" accessibilityRole="link" onPress={reportInfo} style={styles.linkText}>
                  {t('empty.reportMissing')}
                </Text>
              </Text>
            </View>
          ) : (
            <View style={styles.obstacles}>
              {park.obstacles.map((o) => {
                // Street plaza placeholders aren't real obstacles, so they have no feed.
                const tappable = o.general_type !== 'street_plaza';
                return (
                  <Pressable
                    key={o.id}
                    accessibilityRole={tappable ? 'button' : undefined}
                    disabled={!tappable}
                    onPress={() =>
                      router.push({ pathname: '/park/[slug]/obstacle/[id]', params: { slug: park.slug, id: o.id } })
                    }
                    style={({ pressed }) => [
                      styles.obstacle,
                      { backgroundColor: c.surfaceRaised },
                      pressed && styles.pressed,
                    ]}
                  >
                    <View style={styles.flex}>
                      <Text variant="body" style={{ fontFamily: fontFamily.sansSemiBold }}>
                        {o.name}
                      </Text>
                      {o.notes ? (
                        <Text variant="bodySm" color="textSecondary" numberOfLines={2}>
                          {o.notes}
                        </Text>
                      ) : null}
                    </View>
                    <Text variant="label" color="textSecondary">
                      {t(`obstacleTypes.${o.general_type}`)}
                    </Text>
                    {tappable ? <Icon name="chevron" color={c.textSecondary} size={16} /> : null}
                  </Pressable>
                );
              })}
            </View>
          )}
        </View>

        {/* Meetups (v2): Past meetups, collapsed until opened. */}
        <ParkPastMeetups parkId={park.id} />

        <ParkRegulars parkId={park.id} />
        <ParkPosts park={park} />

        <View style={[styles.block, styles.footer]}>
          <Text variant="bodySm" color="textSecondary">
            {park.verified_at
              ? t('park.lastVerified', { date: dateFmt.format(new Date(park.verified_at)) })
              : t('park.notVerified')}{' '}
            <Text
              variant="bodySm"
              color="accentText"
              accessibilityRole="link"
              onPress={reportInfo}
              style={{ fontFamily: fontFamily.sansSemiBold }}
            >
              {t('parkReport.suggestFix')}
            </Text>
          </Text>
          <Text
            variant="caption"
            color="textSecondary"
            accessibilityRole="link"
            onPress={() => void Linking.openURL('https://www.openstreetmap.org/copyright')}
          >
            {t('park.osmCredit')}
          </Text>
        </View>
      </Animated.ScrollView>
      {sheet}
      {profile?.username ? (
        <AddParkPhotosSheet
          parkId={park.id}
          parkName={park.display_name}
          username={profile.username}
          photos={picked}
          onClose={() => setPicked([])}
        />
      ) : null}
    </View>
  );
}

/** "10:00–22:00" for today, or the first line's hours if today has none listed. */
function todayHours(park: ParkDetail, lines: HoursLine[], unknown: string): string {
  const today = localNow(new Date(), park.metro?.timezone ?? null);
  const index = park.sessions.findIndex((s) => s.days.includes(today.isoWeekday));
  const line = lines.find((l) => l.key === park.sessions[index]?.id) ?? lines[0];
  return line ? line.time : unknown;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1 },
  pressed: { opacity: 0.75 },
  loading: { marginTop: space[12] },
  topBar: { paddingHorizontal: space[4], paddingVertical: space[2] },
  content: { gap: space[6] },
  intro: { marginTop: -space[2] },
  chip: { borderWidth: stroke.rule, paddingHorizontal: space[2], paddingVertical: 2 },
  block: { paddingHorizontal: space[4], gap: space[2] },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2], alignItems: 'center', marginTop: space[1] },
  verified: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: stroke.rule, paddingHorizontal: space[2], paddingVertical: 2 },
  actions: { flexDirection: 'row', alignItems: 'center' },
  saveButton: {
    flex: 1,
    height: size.tapMin,
    borderWidth: stroke.rule,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[2],
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  fact: { width: '48%', flexGrow: 1, padding: space[3], gap: space[1] },
  factWide: { width: '100%' },
  hours: { gap: 0 },
  hoursRow: { paddingVertical: space[2], borderBottomWidth: stroke.hairline, gap: 2 },
  hoursMain: { flexDirection: 'row', gap: space[3] },
  hoursDays: { minWidth: 96 },
  fees: { gap: 2, marginTop: space[2] },
  obstacles: { gap: 6 },
  noObstacles: { borderWidth: stroke.rule, borderStyle: 'dashed', padding: space[4], flexDirection: 'row', alignItems: 'flex-start', gap: space[3] },
  linkText: { fontFamily: fontFamily.sansSemiBold, textDecorationLine: 'underline' },
  obstacle: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: space[3], paddingHorizontal: space[3], paddingVertical: space[2] },
  footer: { gap: space[1] },
});
