/**
 * Meetups on a park page (Meetups v2 mockup "Park page with meetups"):
 * Upcoming between Here now and Plan a meetup, each meetup once at its next
 * date, and Past meetups as a collapsed row lower down that loads when
 * opened. Cancelled dates show crossed out with their reason. Also the
 * profile's Meetups tab, which uses the same rows.
 */
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { MeetupRow, PastMeetupRow } from '@/components/meetup-card';
import { Button, Icon } from '@/components/ui';
import {
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
      <View style={[styles.block, styles.tabTop]}>
        <Text variant="body" color="textSecondary" style={styles.center}>
          {isMe ? t('meetupCard.emptyOwn') : t('meetupCard.empty', { username })}
        </Text>
        {isMe ? <Button label={t('meetup.plan')} icon="add" variant="secondary" onPress={() => router.push('/new-meetup')} /> : null}
      </View>
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
