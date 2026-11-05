/**
 * Meetups on a park page (Meetups v2 mockup "Park page with meetups"):
 * Upcoming between Here now and Plan a meetup, each meetup once at its next
 * date, and Past meetups as a collapsed row lower down that loads when
 * opened. Cancelled dates show crossed out with their reason. Also the
 * profile's Meetups tab, which uses the same rows, and (PR 9,
 * PageMeet-ShopUpcoming) a page screen's Upcoming, where the team gets
 * "Plan a meetup as …".
 */
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { EmptyState } from '@/components/empty-state';
import { MeetupRow, PastMeetupRow } from '@/components/meetup-card';
import { Button, Icon } from '@/components/ui';
import {
  usePageMeetups,
  useParkMeetups,
  useParkPastMeetupCount,
  useParkPastMeetups,
  useProfileMeetups,
  useProfilePastMeetups,
} from '@/lib/meetups';
import { space, stroke, Text, useColors } from '@/theme';

const FIRST = 5;

/** Upcoming: the next 5, then "All upcoming". Nothing at all when there are none. */
export function ParkUpcomingMeetups({ parkId }: { parkId: string }) {
  const { t } = useTranslation();
  const c = useColors();
  const [all, setAll] = useState(false);
  const upcoming = useParkMeetups(parkId, all ? 50 : FIRST);
  const list = upcoming.data ?? [];

  if (upcoming.isError) {
    return (
      <View style={styles.block}>
        <Text variant="bodySm" color="statusClosed">
          {t('errors.network')}
        </Text>
        <Button label={t('common.retry')} variant="secondary" onPress={() => void upcoming.refetch()} />
      </View>
    );
  }
  if (upcoming.isPending) return <ActivityIndicator color={c.text} style={styles.block} />;
  if (list.length === 0) return null;

  return (
    <View style={styles.block}>
      <Text variant="title" accessibilityRole="header">
        {t('meetupCard.upcoming')}
      </Text>
      <View style={styles.list}>
        {list.map((m) => (
          <MeetupRow key={m.id} m={m} place="park" />
        ))}
      </View>
      {!all && list.length >= FIRST ? (
        <Button label={t('meetupCard.allUpcoming')} variant="secondary" onPress={() => setAll(true)} />
      ) : null}
    </View>
  );
}

/**
 * A page's Upcoming: each meetup once at its next date. Nothing for
 * visitors when there are none; the team (`planAs`, when the page can host)
 * sees "Plan a meetup as …" either way.
 */
export function PageUpcomingMeetups({
  pageId,
  planAs,
}: {
  pageId: string;
  /** The page's name, when you can make meetups as it. */
  planAs: string | null;
}) {
  const { t } = useTranslation();
  const c = useColors();
  const [all, setAll] = useState(false);
  const upcoming = usePageMeetups(pageId, all ? 50 : FIRST);
  const list = upcoming.data ?? [];
  const plan = planAs ? (
    <Button
      label={t('pageMeet.planAs', { name: planAs })}
      icon="add"
      variant="secondary"
      onPress={() => router.push({ pathname: '/new-meetup', params: { asPage: pageId } })}
    />
  ) : null;

  if (upcoming.isError) {
    return (
      <View style={styles.pageBlock}>
        <Text variant="bodySm" color="statusClosed">
          {t('errors.network')}
        </Text>
        <Button label={t('common.retry')} variant="secondary" onPress={() => void upcoming.refetch()} />
      </View>
    );
  }
  if (upcoming.isPending) return planAs ? <ActivityIndicator color={c.text} style={styles.pageBlock} /> : null;
  if (list.length === 0 && !planAs) return null;

  return (
    <View style={styles.pageBlock}>
      <Text variant="title" accessibilityRole="header">
        {t('meetupCard.upcoming')}
      </Text>
      {list.length === 0 ? (
        <Text variant="bodySm" color="textSecondary">
          {t('pageMeet.noneYet')}
        </Text>
      ) : (
        <View style={styles.list}>
          {list.map((m) => (
            <MeetupRow key={m.id} m={m} place="page" />
          ))}
        </View>
      )}
      {!all && list.length >= FIRST ? (
        <Button label={t('meetupCard.allUpcoming')} variant="tertiary" onPress={() => setAll(true)} />
      ) : null}
      {plan}
    </View>
  );
}

/** Past meetups: a collapsed row with the count; opening it loads the dates, newest first. */
export function ParkPastMeetups({ parkId }: { parkId: string }) {
  const { t } = useTranslation();
  const c = useColors();
  const [open, setOpen] = useState(false);
  const count = useParkPastMeetupCount(parkId);
  const past = useParkPastMeetups(parkId, open);
  const n = count.data ?? 0;
  if (!n) return null;
  const list = past.data?.pages.flat() ?? [];

  return (
    <View style={styles.block}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((o) => !o)}
        style={({ pressed }) => [styles.toggle, { borderTopColor: c.border }, pressed && styles.pressed]}
      >
        <Text variant="title" accessibilityRole="header" style={styles.flex}>
          {t('meetupCard.pastMeetups')}{' '}
          <Text variant="title" color="textSecondary">
            {n}
          </Text>
        </Text>
        <Icon name={open ? 'chevronUp' : 'chevronDown'} color={c.text} size={22} />
      </Pressable>
      {open ? (
        <View>
          {list.map((m, i) => (
            <PastMeetupRow key={m.id} m={m} last={i === list.length - 1 && !past.hasNextPage} />
          ))}
          {past.isPending || past.isFetchingNextPage ? <ActivityIndicator color={c.text} style={styles.loading} /> : null}
          {past.isError ? (
            <Text variant="bodySm" color="statusClosed">
              {t('errors.network')}
            </Text>
          ) : null}
          {past.hasNextPage && !past.isFetchingNextPage ? (
            <Button label={t('meetupCard.showMore')} variant="secondary" onPress={() => void past.fetchNextPage()} />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pressed: { opacity: 0.75 },
  block: { paddingHorizontal: space[4], gap: space[2] },
  pageBlock: { paddingHorizontal: space[4], paddingTop: space[6], gap: space[3] },
  list: { gap: space[2] },
  toggle: { minHeight: 52, borderTopWidth: stroke.rule, flexDirection: 'row', alignItems: 'center', gap: space[2] },
  loading: { paddingVertical: space[3] },
  tabLoading: { marginTop: space[12] },
  tabTop: { paddingTop: space[4] },
  sections: { gap: space[6] },
  center: { textAlign: 'center' },
});

/* Profile ----------------------------------------------------------------------------- */

/**
 * A profile's Meetups tab (mockup "Profile · Meetups tab", option B):
 * meetups the person hosts or co-hosts. Upcoming as cards (each meetup once,
 * at its next date), Past as rows, newest first.
 */
export function ProfileMeetups({ userId, isMe, username }: { userId: string; isMe: boolean; username: string }) {
  const { t } = useTranslation();
  const c = useColors();
  const upcoming = useProfileMeetups(userId);
  const past = useProfilePastMeetups(userId);
  const coming = upcoming.data ?? [];
  const done = past.data?.pages.flat() ?? [];

  if (upcoming.isPending || past.isPending) return <ActivityIndicator color={c.text} style={styles.tabLoading} />;
  if ((upcoming.isError && !coming.length) || (past.isError && !done.length)) {
    return (
      <View style={[styles.block, styles.tabTop]}>
        <Text variant="body" color="statusClosed">
          {t('errors.network')}
        </Text>
        <Button
          label={t('common.retry')}
          variant="secondary"
          onPress={() => {
            void upcoming.refetch();
            void past.refetch();
          }}
        />
      </View>
    );
  }
  if (!coming.length && !done.length) {
    return (
      <EmptyState
        title={t('empty.meetupsTitle')}
        body={isMe ? t('empty.meetupsOwnBody') : t('meetupCard.empty', { username })}
        action={isMe ? { label: t('meetup.plan'), icon: 'add', onPress: () => router.push('/new-meetup') } : undefined}
      />
    );
  }

  return (
    <View style={[styles.tabTop, styles.sections]}>
      {coming.length ? (
        <View style={styles.block}>
          <Text variant="label" color="textSecondary" accessibilityRole="header">
            {t('meetupCard.upcoming')}
          </Text>
          <View style={styles.list}>
            {coming.map((m) => (
              <MeetupRow key={m.id} m={m} place="profile" />
            ))}
          </View>
        </View>
      ) : null}
      {done.length ? (
        <View style={styles.block}>
          <Text variant="label" color="textSecondary" accessibilityRole="header">
            {t('meetupCard.past')}
          </Text>
          <View>
            {done.map((m, i) => (
              <PastMeetupRow key={m.id} m={m} last={i === done.length - 1 && !past.hasNextPage} />
            ))}
          </View>
          {past.isFetchingNextPage ? <ActivityIndicator color={c.text} style={styles.loading} /> : null}
          {past.hasNextPage && !past.isFetchingNextPage ? (
            <Button label={t('meetupCard.showMore')} variant="secondary" onPress={() => void past.fetchNextPage()} />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
