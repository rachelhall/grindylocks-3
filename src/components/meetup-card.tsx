/**
 * Meetups where they show (Meetups v2 mockups "Home feed · meetup card",
 * "Park page with meetups" and "Profile · Meetups tab"):
 *
 * - MeetupFeedCard: the card in Home, once, when posted (a repeating
 *   meetup's next date takes its place when the date before it ends).
 * - MeetupRow: an Upcoming row on park pages and profiles.
 * - PastMeetupRow: a Past row, "12 went · 5 posts", or crossed out with its
 *   reason when it was cancelled.
 * - DateStamp: the ink date block they share.
 *
 * Everything shown is computed in the database (`meetups_everywhere`), so a
 * card never names someone the viewer may not see.
 *
 * Page meetups (PR 9, PageMeet-Home and PageMeet-ShopUpcoming): the card
 * gets the page's ink header (logo, name, OFFICIAL, SHOP or BRAND, a person
 * co-host), the place can be the shop or an address, and chips add 18+,
 * spots left (or FULL) and Tickets. MeetupRow's `page` place is a page
 * screen's Upcoming.
 */
import { router } from 'expo-router';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/avatar';
import { AdultsChip, daysRangeLabel } from '@/components/page-meetup';
import { PageTile, StampTape } from '@/components/pages';
import { Button, Icon } from '@/components/ui';
import { formatClock, localNow } from '@/lib/hours';
import {
  cancelReasonLabel,
  type MeetupCard,
  type MeetupFace,
  meetupHeadline,
  meetupPlaceName,
  meetupTz,
  repeatLabel,
  spotsLeft,
} from '@/lib/meetups';
import { isOfficial, pageKind } from '@/lib/pages';
import { brand, fontFamily, size, space, stroke, Text, useColors } from '@/theme';

/* Shared ------------------------------------------------------------------------------ */

const openMeetup = (id: string, going?: boolean) =>
  router.push({ pathname: '/meetup/[id]', params: going ? { id, going: '1' } : { id } });

function tzOf(m: MeetupCard) {
  return meetupTz(m);
}

/** "7:00–9:00 PM", on the park's clock; a meetup over several days is "Dec 4 – Dec 6 · 3 days". */
export function meetupTimes(m: MeetupCard, t: TFunction, locale: string) {
  const tz = tzOf(m);
  const days = m.meetup_days ?? [];
  if (m.multi_day && days.length >= 2) {
    const range = daysRangeLabel(new Date(days[0].starts_at), new Date(days[days.length - 1].starts_at), tz, locale, t);
    return `${range} · ${t('pageMeet.days', { count: days.length })}`;
  }
  return t('meetup.timeRange', {
    start: formatClock(localNow(new Date(m.starts_at), tz).minutes, locale),
    end: formatClock(localNow(new Date(m.ends_at), tz).minutes, locale),
  });
}

/**
 * The ink date block: weekday in pink, the day large with a pink offset,
 * and the month on the bigger size. It's a brand stamp, so it uses the
 * brand inks in both themes, like the meetup page's header.
 */
export function DateStamp({ startsAt, timeZone, big = false }: { startsAt: string; timeZone: string | null; big?: boolean }) {
  const { i18n } = useTranslation();
  const d = new Date(startsAt);
  const part = (o: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(i18n.language, { ...o, timeZone: timeZone ?? undefined }).format(d).replace('.', '');
  return (
    <View
      style={[styles.stamp, big ? styles.stampBig : styles.stampSmall]}
      accessibilityElementsHidden
      importantForAccessibility="no"
    >
      <Text variant="label" style={{ color: brand.pink }}>
        {part({ weekday: 'short' })}
      </Text>
      <Text variant={big ? 'display' : 'title'} style={styles.stampDay}>
        {part({ day: 'numeric' })}
      </Text>
      {big ? (
        <Text variant="label" style={{ color: brand.paper }}>
          {part({ month: 'short' })}
        </Text>
      ) : null}
    </View>
  );
}

/** The full date for screen readers: "Thursday, November 5". */
function spokenDate(m: MeetupCard, locale: string) {
  return new Intl.DateTimeFormat(locale, { weekday: 'long', month: 'long', day: 'numeric', timeZone: tzOf(m) ?? undefined }).format(
    new Date(m.starts_at),
  );
}

/**
 * "kaito.rolls, dee.makio and 7 others are going": up to two names (people
 * you follow first), then the rest as a count. The count includes everyone.
 */
export function goingLine(faces: MeetupFace[], total: number, t: TFunction, locale: string) {
  const names = faces
    .map((f) => f.username)
    .filter((n): n is string => Boolean(n))
    .slice(0, 2);
  const others = Math.max(total - names.length, 0);
  if (names.length === 0) return t('meetupCard.goingCount', { count: total });
  const list = new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(names);
  if (others === 0) return t('meetupCard.namesGoing', { count: names.length, names: list });
  return t('meetupCard.namesAndOthersGoing', { count: others, names: names.join(', ') });
}

function Faces({ faces }: { faces: MeetupFace[] }) {
  const c = useColors();
  return (
    <View style={styles.faces} accessibilityElementsHidden importantForAccessibility="no">
      {faces.map((f, i) => (
        <View key={f.id} style={[styles.face, i > 0 && styles.faceOverlap, { borderColor: c.surfaceRaised }]}>
          <Avatar path={f.avatar_path} username={f.username ?? ''} size={22} />
        </View>
      ))}
    </View>
  );
}

function GoingRow({ m }: { m: MeetupCard }) {
  const { t, i18n } = useTranslation();
  if (m.going_total === 0) return null;
  return (
    <View style={styles.goingRow}>
      {m.going_faces.length ? <Faces faces={m.going_faces} /> : null}
      <Text variant="caption" color="textSecondary" style={styles.flex}>
        {goingLine(m.going_faces, m.going_total, t, i18n.language)}
      </Text>
    </View>
  );
}

function DisciplineChips({ m }: { m: MeetupCard }) {
  const { t } = useTranslation();
  const c = useColors();
  if (!m.disciplines.length) return null;
  return (
    <View style={styles.chips}>
      {m.disciplines.map((d) => (
        <View key={d} style={[styles.chip, { borderColor: c.border }]}>
          <Text variant="caption" style={styles.semi}>
            {t(`disciplines.${d}`)}
          </Text>
        </View>
      ))}
    </View>
  );
}

function CancelledTag({ m }: { m: MeetupCard }) {
  const { t } = useTranslation();
  const c = useColors();
  return (
    <View style={[styles.cancelTag, { borderColor: c.statusClosed }]}>
      <Text variant="label" color="statusClosed">
        {cancelReasonLabel(m.cancel_reason, m.meetup_host_page, t)}
      </Text>
    </View>
  );
}

/** The page-only chips: 18+, spots left or FULL, and Tickets. */
function PageChips({ m, withDisciplines }: { m: MeetupCard; withDisciplines?: boolean }) {
  const { t } = useTranslation();
  const c = useColors();
  const left = spotsLeft(m);
  if (!m.adults_only && left === null && !m.ticket_url && !(withDisciplines && m.disciplines.length)) return null;
  return (
    <View style={styles.chips}>
      {m.adults_only ? <AdultsChip /> : null}
      {withDisciplines
        ? m.disciplines.map((d) => (
            <View key={d} style={[styles.chip, { borderColor: c.border }]}>
              <Text variant="caption" style={styles.semi}>
                {t(`disciplines.${d}`)}
              </Text>
            </View>
          ))
        : null}
      {left === 0 ? (
        <View style={[styles.chip, { borderColor: c.text, backgroundColor: c.text }]}>
          <Text variant="label" style={{ color: c.surface }}>
            {t('pageMeet.full')}
          </Text>
        </View>
      ) : left !== null ? (
        <View style={[styles.chip, { borderColor: c.border }]}>
          <Text variant="caption" style={styles.semi}>
            {t('pageMeet.spotsLeft', { count: left })}
          </Text>
        </View>
      ) : null}
      {m.ticket_url ? (
        <View style={[styles.chip, { borderColor: c.border }]}>
          <Text variant="caption" style={styles.semi}>
            {t('pageMeet.ticketsChip')}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

/** A page meetup's header on Home (PageMeet-Home): the page's ink strip, like its posts'. */
function PageHead({ m }: { m: MeetupCard }) {
  const { t } = useTranslation();
  const page = m.meetup_host_page!;
  const coHost = m.host_list.find((h) => h.kind !== 'page' && h.role === 'co_host');
  const tile = { displayName: page.display_name, state: page.state, logoPath: page.logo_path };
  return (
    <View style={[styles.head, styles.pageHead, { backgroundColor: brand.ink }]}>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={page.display_name}
        onPress={() => router.push({ pathname: '/page/[handle]', params: { handle: page.handle } })}
        style={({ pressed }) => [styles.headWho, pressed && styles.pressed]}
      >
        <View style={[styles.logoRing, { borderColor: brand.paper }]}>
          <PageTile page={tile} size={32} />
        </View>
        <View style={styles.flex}>
          <View style={styles.pageName}>
            <Text variant="bodySm" numberOfLines={1} style={[styles.shrink, styles.semi, { color: brand.paper }]}>
              {page.display_name}
            </Text>
            {isOfficial(tile) ? <StampTape stamp="official" small /> : null}
            <Text variant="label" style={{ color: brand.paper, opacity: 0.75 }}>
              {t(`page.${pageKind(page)}`)}
            </Text>
          </View>
          {coHost?.username ? (
            <Text variant="caption" numberOfLines={1} style={{ color: brand.paper, opacity: 0.75 }}>
              {t('meetupCard.withCoHost', { username: coHost.username })}
            </Text>
          ) : null}
        </View>
      </Pressable>
      <View style={[styles.tape, { backgroundColor: brand.pink }]}>
        <Text variant="label" style={{ color: brand.ink }}>
          {t('meetup.tape')}
        </Text>
      </View>
    </View>
  );
}

/* Home -------------------------------------------------------------------------------- */

/**
 * The meetup card in Home: who's hosting (with a co-host), the MEETUP tape,
 * the date stamp, headline, times and repeat, the park, the line, discipline
 * chips, faces and I'm going. Hosts see "You're hosting"; once a date has
 * passed the card says how many went; a cancelled date is crossed out with
 * its reason and no button.
 */
export function MeetupFeedCard({ m, now, viewerId }: { m: MeetupCard; now: number; viewerId: string | undefined }) {
  const { t, i18n } = useTranslation();
  const c = useColors();
  const locale = i18n.language;
  const host = m.host_list.find((h) => h.role === 'host') ?? m.host_list[0];
  const coHost = m.host_list.find((h) => h.role === 'co_host');
  const cancelled = m.status === 'cancelled';
  const over = new Date(m.ends_at).getTime() <= now;
  const headline = meetupHeadline(m, t);
  const repeats = repeatLabel(m.series.weekdays, t, locale);
  const times = [meetupTimes(m, t, locale), repeats].filter(Boolean).join(' · ');
  const iHost = Boolean(m.i_run_meetup) || (Boolean(viewerId) && m.host_list.some((h) => h.kind !== 'page' && h.id === viewerId));
  const place = meetupPlaceName(m, t);
  const full = spotsLeft(m) === 0;

  return (
    <View style={[styles.feedCard, { backgroundColor: c.surfaceRaised, borderColor: c.border }]}>
      {m.meetup_host_page ? (
        <PageHead m={m} />
      ) : (
      <View style={styles.head}>
        <Pressable
          accessibilityRole="link"
          disabled={!host?.username}
          onPress={() => host?.username && router.push({ pathname: '/profile/[username]', params: { username: host.username } })}
          style={({ pressed }) => [styles.headWho, pressed && styles.pressed]}
        >
          <Avatar path={host?.avatar_path ?? null} username={host?.username ?? ''} size={36} />
          <View style={styles.flex}>
            <Text variant="bodySm" numberOfLines={1} style={styles.semi}>
              {host?.username ?? t('common.deletedUser')}
            </Text>
            {coHost?.username ? (
              <Text variant="caption" color="textSecondary" numberOfLines={1}>
                {t('meetupCard.withCoHost', { username: coHost.username })}
              </Text>
            ) : null}
          </View>
        </Pressable>
        <View style={[styles.tape, { backgroundColor: c.accent }]}>
          <Text variant="label" style={{ color: c.onAccent }}>
            {t('meetup.tape')}
          </Text>
        </View>
      </View>
      )}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={[headline, spokenDate(m, locale), times, place, cancelled ? t('meetupCard.cancelledA11y') : null]
          .filter(Boolean)
          .join(', ')}
        onPress={() => openMeetup(m.id)}
        style={({ pressed }) => [styles.main, pressed && styles.pressed]}
      >
        <DateStamp startsAt={m.starts_at} timeZone={tzOf(m)} big />
        <View style={styles.mainText}>
          <Text variant="headline" numberOfLines={3} style={cancelled && [styles.struck, { color: c.textSecondary }]}>
            {headline}
          </Text>
          <Text variant="bodySm" color="textSecondary">
            {times}
          </Text>
          <View style={styles.parkLine}>
            <Icon name={m.place === 'page' ? 'storefront' : 'pin'} color={c.accentText} size={16} />
            <Text variant="bodySm" color="accentText" numberOfLines={1} style={styles.semi}>
              {place}
            </Text>
          </View>
        </View>
      </Pressable>

      {m.title && m.note ? (
        <Text variant="body" style={styles.note} numberOfLines={4}>
          {m.note}
        </Text>
      ) : null}
      {cancelled ? (
        <View style={styles.padded}>
          <CancelledTag m={m} />
        </View>
      ) : (
        <>
          {m.meetup_host_page ? <PageChips m={m} withDisciplines /> : <DisciplineChips m={m} />}
          {over ? null : <GoingRow m={m} />}
        </>
      )}

      {cancelled ? null : (
        <View style={styles.actions}>
          {over ? (
            <View style={[styles.statusBox, { borderColor: c.border }]}>
              <Text variant="body" style={styles.semi}>
                {[t('meetup.went', { count: m.going_total }), m.linked_post_count ? t('meetupCard.posts', { count: m.linked_post_count }) : null]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
            </View>
          ) : iHost ? (
            <View style={[styles.statusBox, styles.dashed, { borderColor: c.border }]}>
              <Text variant="body" style={styles.semi}>
                {t('meetup.youreHosting')}
              </Text>
            </View>
          ) : full && !m.i_am_going ? (
            <View style={[styles.statusBox, styles.dashed, { borderColor: c.textSecondary }]}>
              <Icon name="block" color={c.textSecondary} size={18} />
              <Text variant="body" color="textSecondary" style={styles.semi}>
                {t('pageMeet.full')}
              </Text>
            </View>
          ) : m.i_am_going ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => openMeetup(m.id, true)}
              style={({ pressed }) => [styles.statusBox, { borderColor: c.border, backgroundColor: c.accentSubtle }, pressed && styles.pressed]}
            >
              <Icon name="check" color={c.onAccentSubtle} size={18} />
              <Text variant="body" style={[styles.semi, { color: c.onAccentSubtle }]}>
                {t('meetup.going')}
              </Text>
            </Pressable>
          ) : (
            <Button label={t('meetup.imGoing')} icon="check" onPress={() => openMeetup(m.id, true)} style={styles.flex} />
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('meetupCard.comments', { count: m.meetup_comment_count })}
            onPress={() => openMeetup(m.id)}
            style={({ pressed }) => [styles.commentButton, { borderColor: c.border }, pressed && styles.pressed]}
          >
            <Icon name="chat" color={c.text} size={22} />
            {m.meetup_comment_count ? (
              <Text variant="bodySm" style={styles.semi}>
                {m.meetup_comment_count}
              </Text>
            ) : null}
          </Pressable>
        </View>
      )}
    </View>
  );
}

/* Park page and profile ---------------------------------------------------------------- */

/**
 * An Upcoming row. On a park page the third line names the hosts; on a
 * profile it says where ("7:00 PM · Memo · Every Thursday").
 */
export function MeetupRow({ m, place }: { m: MeetupCard; place: 'park' | 'profile' | 'page' }) {
  const { t, i18n } = useTranslation();
  const c = useColors();
  const locale = i18n.language;
  const cancelled = m.status === 'cancelled';
  const headline = meetupHeadline(m, t);
  const repeats = repeatLabel(m.series.weekdays, t, locale);
  const hosts = new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(
    m.host_list.map((h) => h.username).filter((n): n is string => Boolean(n)),
  );
  const where = meetupPlaceName(m, t);
  const second =
    place === 'park'
      ? [meetupTimes(m, t, locale), repeats].filter(Boolean).join(' · ')
      : place === 'page'
        ? [meetupTimes(m, t, locale), where, repeats].filter(Boolean).join(' · ')
        : [formatClock(localNow(new Date(m.starts_at), tzOf(m)).minutes, locale), where, repeats].filter(Boolean).join(' · ');

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[headline, spokenDate(m, locale), second, cancelled ? t('meetupCard.cancelledA11y') : null].filter(Boolean).join(', ')}
      onPress={() => openMeetup(m.id)}
      style={({ pressed }) => [styles.row, { backgroundColor: c.surfaceRaised, borderColor: c.border }, pressed && styles.pressed]}
    >
      <View style={styles.rowMain}>
        <DateStamp startsAt={m.starts_at} timeZone={tzOf(m)} />
        <View style={styles.mainText}>
          <Text variant="body" numberOfLines={2} style={[styles.semi, cancelled && [styles.struck, { color: c.textSecondary }]]}>
            {headline}
          </Text>
          <Text variant="bodySm" color="textSecondary">
            {second}
          </Text>
          {cancelled ? (
            <CancelledTag m={m} />
          ) : place === 'page' ? null : place === 'park' ? (
            hosts ? (
              <Text variant="bodySm" color="textSecondary" numberOfLines={1}>
                {hosts}
              </Text>
            ) : null
          ) : (
            <Text variant="bodySm" color="textSecondary">
              {t('meetupCard.goingCount', { count: m.going_total })}
            </Text>
          )}
        </View>
      </View>
      {place === 'page' && !cancelled ? <PageChips m={m} withDisciplines /> : null}
      {place === 'park' && !cancelled ? <GoingRow m={m} /> : null}
    </Pressable>
  );
}

/** A Past row: "OCT 29 · Thursday blade night · 12 went · 5 posts", or crossed out with its reason. */
export function PastMeetupRow({ m, last }: { m: MeetupCard; last?: boolean }) {
  const { t, i18n } = useTranslation();
  const c = useColors();
  const locale = i18n.language;
  const cancelled = m.status === 'cancelled';
  const headline = meetupHeadline(m, t);
  const date = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', timeZone: tzOf(m) ?? undefined }).format(
    new Date(m.starts_at),
  );
  const counts = [
    m.going_total ? t('meetup.went', { count: m.going_total }) : null,
    m.linked_post_count ? t('meetupCard.posts', { count: m.linked_post_count }) : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[headline, spokenDate(m, locale), cancelled ? t('meetupCard.cancelledA11y') : counts].filter(Boolean).join(', ')}
      onPress={() => openMeetup(m.id)}
      style={({ pressed }) => [
        styles.pastRow,
        !last && { borderBottomWidth: stroke.hairline, borderBottomColor: c.borderSubtle },
        pressed && styles.pressed,
      ]}
    >
      <Text variant="label" color="textSecondary" style={styles.pastDate}>
        {date}
      </Text>
      <Text
        variant="body"
        numberOfLines={1}
        style={[styles.flex, styles.semi, cancelled && [styles.struck, { color: c.textSecondary }]]}
      >
        {headline}
      </Text>
      {cancelled ? (
        <CancelledTag m={m} />
      ) : counts ? (
        <Text variant="caption" color="textSecondary">
          {counts}
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pressed: { opacity: 0.75 },
  semi: { fontFamily: fontFamily.sansSemiBold },
  shrink: { flexShrink: 1 },
  pageHead: { paddingVertical: space[2] },
  pageName: { flexDirection: 'row', alignItems: 'center', gap: space[1], minWidth: 0 },
  logoRing: { borderWidth: 2 },
  struck: { textDecorationLine: 'line-through' },
  stamp: { backgroundColor: brand.ink, alignItems: 'center', justifyContent: 'center', gap: 2 },
  stampBig: { width: 64, height: 72 },
  stampSmall: { width: 52, height: 60 },
  stampDay: { color: brand.paper, textShadowColor: brand.pink, textShadowOffset: { width: 2, height: 2 }, textShadowRadius: 0 },
  faces: { flexDirection: 'row', paddingLeft: 6 },
  face: { borderWidth: 2, marginLeft: 0 },
  faceOverlap: { marginLeft: -6 },
  goingRow: { flexDirection: 'row', alignItems: 'center', gap: space[2], paddingHorizontal: space[3], paddingBottom: space[3] },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: space[3], paddingBottom: space[3] },
  chip: { borderWidth: 1, paddingHorizontal: space[2], paddingVertical: 2 },
  cancelTag: { borderWidth: stroke.rule, paddingHorizontal: 6, paddingVertical: 1, alignSelf: 'flex-start' },
  feedCard: { borderWidth: stroke.rule },
  head: { flexDirection: 'row', alignItems: 'center', gap: space[2], paddingHorizontal: space[3], paddingVertical: space[2] },
  headWho: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space[2], minHeight: size.tapMin },
  tape: { paddingHorizontal: 7, paddingVertical: 3, transform: [{ rotate: '2deg' }] },
  main: { flexDirection: 'row', gap: space[3], paddingHorizontal: space[3], paddingTop: space[1], paddingBottom: space[3] },
  mainText: { flex: 1, minWidth: 0, gap: 3 },
  parkLine: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  note: { paddingHorizontal: space[3], paddingBottom: space[3] },
  padded: { paddingHorizontal: space[3], paddingBottom: space[3] },
  actions: { flexDirection: 'row', gap: space[2], paddingHorizontal: space[3], paddingBottom: space[3] },
  statusBox: {
    flex: 1,
    minHeight: size.tapMin,
    borderWidth: stroke.rule,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[2],
    paddingHorizontal: space[2],
  },
  dashed: { borderStyle: 'dashed' },
  commentButton: {
    minWidth: size.tapMin,
    height: size.tapMin,
    borderWidth: stroke.rule,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: space[3],
  },
  row: { borderWidth: stroke.rule },
  rowMain: { flexDirection: 'row', gap: space[3], padding: space[3] },
  pastRow: { minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: space[3], paddingHorizontal: space[1] },
  pastDate: { width: 56 },
});
