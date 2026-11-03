/**
 * The "At Memo · until 7:30" tag on a profile (Meetups v2, "Your profile ·
 * checked in" in the Mockups canvas), shown only to people who may see the
 * check-in. On your own profile it says who can see it and has I left.
 */
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { Button, Icon } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { useCheckInTime, useCheckOut, useProfileCheckIn } from '@/lib/here-now';
import { usePark } from '@/lib/parks';
import { fontFamily, size, space, stroke, Text, useColors } from '@/theme';

export function CheckInTag({ personId, isMe }: { personId: string; isMe: boolean }) {
  const { t } = useTranslation();
  const c = useColors();
  const { session } = useAuth();
  const until = useCheckInTime();
  const { data: checkIn } = useProfileCheckIn(personId);
  const { data: park } = usePark(checkIn?.park_slug);
  const checkOut = useCheckOut(session?.user.id);
  if (!checkIn) return null;

  const time = until(checkIn.ends_at, park?.metro?.timezone);
  const label = t('hereNow.tag', { park: checkIn.park_name, time });

  return (
    <View style={styles.tagBlock}>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={label}
        onPress={() => router.push({ pathname: '/park/[slug]', params: { slug: checkIn.park_slug } })}
        style={({ pressed }) => [styles.tag, { backgroundColor: c.accent, borderColor: c.onAccent }, pressed && styles.pressed]}
      >
        <Icon name="checkIn" color={c.onAccent} size={18} />
        <Text variant="bodySm" style={{ color: c.onAccent, fontFamily: fontFamily.sansSemiBold }}>
          {label}
        </Text>
      </Pressable>
      {isMe ? (
        <View style={styles.tagOwn}>
          <Text variant="caption" color="textSecondary" style={styles.flex}>
            {checkIn.audience === 'friends' ? t('hereNow.seenByFriends') : t('hereNow.seenByFollowers')}
          </Text>
          <Button
            label={t('hereNow.iLeft')}
            variant="secondary"
            loading={checkOut.isPending}
            onPress={() => checkOut.mutate(undefined, { onError: () => Alert.alert(t('errors.generic')) })}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.75 },
  flex: { flex: 1 },
  tagBlock: { gap: space[2] },
  tag: {
    alignSelf: 'flex-start',
    minHeight: 36,
    borderWidth: stroke.rule,
    paddingHorizontal: space[3],
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  tagOwn: { flexDirection: 'row', alignItems: 'center', gap: space[2], minHeight: size.tapMin },
});
