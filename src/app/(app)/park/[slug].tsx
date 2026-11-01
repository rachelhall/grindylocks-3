import { StatusBar } from 'expo-status-bar';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Alert,
  Linking,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PARK_HEADER_HEIGHT, ParkHeader } from '@/components/park-header';
import { AddPhotosSheet, NoPhotosCard, NotVerifiedChip, RoleBadge } from '@/components/park-photos';
import { BookmarkIcon, DisciplineChips, IconButton, openDirections, StatusChip } from '@/components/parks';
import { ActionSheet, BackButton, Button, Icon, type SheetAction } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { type PickedMedia, pickPhotos } from '@/lib/media';
import { MAX_PARK_PHOTOS, useParkPhotoMutations, useParkPhotos } from '@/lib/park-photos';
import { canContribute, roleAtPark, useMyRoles } from '@/lib/roles';
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
import { type Discipline, type ParkDetail, pickDescription, usePark, useSavedParks } from '@/lib/parks';
import { brand, fontFamily, size, space, stroke, Text, useColors } from '@/theme';

type HoursLine = { key: string; season: string | null; days: string; time: string; disciplines: Discipline[]; note: string | null };

/**
 * The park page, per the Park page mockups: a header with the park's first
 * photo (or a halftone when it has none), then what's there, when it's open,
 * who can skate, and its obstacles. Contributors and admins add park photos
 * from the header. Regulars and the posts grid come with posts (M4); info
 * reports and obstacle feeds come later in v1.
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
  const { data: roles } = useMyRoles(session?.user.id);
  const role = park ? roleAtPark(roles, park) : null;
  const contributor = canContribute(role);
  const { upload } = useParkPhotoMutations(park?.id, session?.user.id);
  const [picked, setPicked] = useState<PickedMedia[]>([]);
  const [moreOpen, setMoreOpen] = useState(false);
  // The header is ink, so the status bar is light until the header scrolls away.
  const [pastHeader, setPastHeader] = useState(false);

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

  const openGallery = photos.length > 0 ? () => router.push({ pathname: '/park/[slug]/photos', params: { slug: park.slug } }) : undefined;

  const addPhotos = async () => {
    const remaining = MAX_PARK_PHOTOS - photos.length;
    if (remaining <= 0) {
      Alert.alert(t('parkPhotos.full', { max: MAX_PARK_PHOTOS }));
      return;
    }
    const { picked: chosen, rejected } = await pickPhotos(remaining);
    if (rejected > 0) Alert.alert(t('parkPhotos.unsupported', { count: rejected }));
    upload.reset();
    setPicked(chosen);
  };

  const moreActions: SheetAction[] = [
    { label: t('park.directions'), icon: 'directions', onPress: () => openDirections(park) },
    ...(openGallery ? [{ label: t('parkPhotos.title'), icon: 'photo' as const, onPress: openGallery }] : []),
    ...(contributor ? [{ label: t('parkPhotos.addPark'), icon: 'addPhoto' as const, onPress: () => void addPhotos() }] : []),
  ];

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const past = e.nativeEvent.contentOffset.y > PARK_HEADER_HEIGHT;
    if (past !== pastHeader) setPastHeader(past);
  };

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

  return (
    <View style={[styles.screen, { backgroundColor: c.surface }]}>
      <StatusBar style={pastHeader ? 'auto' : 'light'} />
      <ScrollView contentContainerStyle={styles.content} onScroll={onScroll} scrollEventThrottle={32}>
        {/* Ink above the header, for iOS's pull-down bounce. */}
        <View style={styles.overscroll} />
        <ParkHeader
          name={park.display_name}
          tape={[park.metro?.name ?? park.city, t(`park.type.${park.park_type}`)].join(' · ')}
          photoUrl={photos[0]?.url ?? null}
          onOpenGallery={openGallery}
          onMore={() => setMoreOpen(true)}
          onAddPhotos={contributor ? () => void addPhotos() : undefined}
        />
        <View style={[styles.block, styles.intro]}>
          {subtitle ? (
            <Text variant="bodySm" color="textSecondary">
              {subtitle}
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
              <NotVerifiedChip />
            )}
            <RoleBadge role={role} />
          </View>
        </View>

        {contributor && photos.length === 0 ? (
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
            <Text variant="body" color="textSecondary">
              {t('park.noObstacles')}
            </Text>
          ) : (
            <View style={styles.obstacles}>
              {park.obstacles.map((o) => (
                <View key={o.id} style={[styles.obstacle, { backgroundColor: c.surfaceRaised }]}>
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
                </View>
              ))}
            </View>
          )}
        </View>

        <View style={[styles.block, styles.footer]}>
          <Text variant="bodySm" color="textSecondary">
            {park.verified_at
              ? t('park.lastVerified', { date: dateFmt.format(new Date(park.verified_at)) })
              : t('park.notVerified')}
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
      </ScrollView>
      <ActionSheet visible={moreOpen} title={park.display_name} actions={moreActions} onClose={() => setMoreOpen(false)} />
      <AddPhotosSheet
        photos={picked}
        parkName={park.display_name}
        username={profile?.username ?? ''}
        busy={upload.isPending}
        failed={upload.isError}
        onCancel={() => setPicked([])}
        onSubmit={(credit) => upload.mutate({ photos: picked, credit }, { onSuccess: () => setPicked([]) })}
      />
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
  content: { paddingBottom: space[12], gap: space[6] },
  intro: { marginTop: -space[2] },
  overscroll: { position: 'absolute', top: -1000, left: 0, right: 0, height: 1000, backgroundColor: brand.ink },
  block: { paddingHorizontal: space[4], gap: space[2] },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2], alignItems: 'center' },
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
  obstacle: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: space[3], paddingHorizontal: space[3], paddingVertical: space[2] },
  footer: { gap: space[1] },
});
