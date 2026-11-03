/**
 * "From Thursday's meetup?" (Meetups v2 mockup "Tag it · from Thursday's
 * meetup"): when you said you were going to a meetup at the post's park in
 * the last 7 days (or hosted one), a chip under the park row links the post
 * to it. Optional, and removable in Edit post. Shown in the posting flow's
 * Tag it step and in Edit post.
 */
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { Chip } from '@/components/tagging';
import { meetupDayName, meetupHeadline, useMeetup, useParkTimeZone, useRecentMeetups } from '@/lib/meetups';
import { space, stroke, Text, useColors } from '@/theme';

export function FromMeetupChip({
  userId,
  parkId,
  parkName,
  value,
  onChange,
}: {
  userId: string | undefined;
  parkId: string | null;
  parkName: string | null;
  /** The linked meetup date, or null. */
  value: string | null;
  onChange: (eventId: string | null) => void;
}) {
  const { t, i18n } = useTranslation();
  const c = useColors();
  const recent = useRecentMeetups(userId, parkId);
  const tz = useParkTimeZone(parkId);
  // A post already linked to an older date (Edit post) still shows it, so it can be removed.
  const linked = useMeetup(value && !recent.data?.some((m) => m.event_id === value) ? value : undefined);

  const options = (recent.data ?? []).map((m) => ({ id: m.event_id, startsAt: m.starts_at, title: m.title, note: m.note }));
  if (linked.data && !options.some((o) => o.id === linked.data!.id)) {
    options.unshift({ id: linked.data.id, startsAt: linked.data.starts_at, title: linked.data.title, note: linked.data.note });
  }
  if (!parkId || options.length === 0) return null;

  // Two at most: the latest, and the linked one if it's another.
  const shown = options.filter((o, i) => i === 0 || o.id === value).slice(0, 2);
  const picked = shown.find((o) => o.id === value);
  const about = picked ?? shown[0];
  const name = meetupHeadline({ title: about.title, note: about.note, park: { display_name: parkName ?? '' } }, t);

  return (
    <View style={[styles.box, { backgroundColor: c.surfaceRaised, borderBottomColor: c.borderSubtle }]}>
      <View style={styles.chips}>
        {shown.map((o) => {
          const day = meetupDayName(o.startsAt, tz.data, i18n.language);
          const on = o.id === value;
          return (
            <Chip
              key={o.id}
              label={on ? t('fromMeetup.linked', { day }) : t('fromMeetup.ask', { day })}
              picked={on}
              trailing={on ? undefined : 'add'}
              onPress={() => onChange(on ? null : o.id)}
            />
          );
        })}
      </View>
      <Text variant="caption" color="textSecondary">
        {picked ? t('fromMeetup.linkedNote', { meetup: name }) : t('fromMeetup.note', { meetup: name })}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { paddingHorizontal: space[4], paddingTop: space[2], paddingBottom: space[3], gap: 6, borderBottomWidth: stroke.hairline },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
});
