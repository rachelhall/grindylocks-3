/**
 * The "At Memo · until 7:30" tag on a profile (Meetups v2, "Your profile ·
 * checked in" in the Mockups canvas), shown only to people who may see the
 * check-in. On your own profile it says who can see it and has I left.
 *
 * When you aren't checked in, your own profile has I'm at a park (decided
 * Nov 3): one location reading finds the parks within about 500 m; with one,
 * the check-in sheet opens for it, with several you pick, with none it says
 * so. The server still makes the real 500 m check.
 */
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Linking, Pressable, StyleSheet, View } from 'react-native';

import { CheckInSheet } from '@/components/here-now';
import { Button, Icon, useActionSheet } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { locateOnce, useCheckInTime, useCheckOut, useProfileCheckIn } from '@/lib/here-now';
import { fetchCheckInParks } from '@/lib/meetups';
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
  if (!checkIn) return isMe ? <CheckInFromProfile /> : null;

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

/** I'm at a park: find the park you're at, then the usual check-in sheet. */
function CheckInFromProfile() {
  const { t } = useTranslation();
  const { sheet, show } = useActionSheet();
  const [finding, setFinding] = useState(false);
  const [chosen, setChosen] = useState<{ slug: string; reading: { latitude: number; longitude: number } } | null>(null);
  const { data: park } = usePark(chosen?.slug);

  async function find() {
    setFinding(true);
    try {
      const at = await locateOnce();
      if (at.kind === 'off') {
        Alert.alert(t('hereNow.locationOff'), t('hereNow.locationOffBody'), [
          { text: t('common.cancel'), style: 'cancel' },
          { text: t('hereNow.openSettings'), onPress: () => void Linking.openSettings() },
        ]);
        return;
      }
      if (at.kind === 'unknown') {
        Alert.alert(t('hereNow.noFix'), t('hereNow.noFixBody'));
        return;
      }
      const reading = { latitude: at.latitude, longitude: at.longitude };
      const parks = await fetchCheckInParks(at.latitude, at.longitude);
      if (parks.length === 0) {
        Alert.alert(t('hereNow.noParkNear'), t('hereNow.noParkNearBody'));
      } else if (parks.length === 1) {
        setChosen({ slug: parks[0].slug, reading });
      } else {
        show({
          title: t('hereNow.whichPark'),
          actions: parks.map((p) => ({ label: p.display_name, onPress: () => setChosen({ slug: p.slug, reading }) })),
        });
      }
    } catch {
      Alert.alert(t('errors.generic'));
    } finally {
      setFinding(false);
    }
  }

  return (
    <>
      <Button label={t('hereNow.imAtAPark')} icon="checkIn" variant="secondary" loading={finding} onPress={() => void find()} />
      {park && chosen ? (
        <CheckInSheet
          key={`${park.id}-${chosen.reading.latitude}-${chosen.reading.longitude}`}
          park={park}
          located={chosen.reading}
          visible
          onClose={() => setChosen(null)}
        />
      ) : null}
      {sheet}
    </>
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
