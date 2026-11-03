/**
 * Here now (Meetups v2), from the Meetups (v2) row of the Mockups canvas:
 * - "Park page · followers" and "Park page · Here now as a count": the Here
 *   now section, with names for people you can see and an unnamed count for
 *   everyone else (only from 3 skaters up), and I'm here / I left.
 * - "Check-in sheet": checks your location once, then who sees you.
 * The profile tag is in check-in-tag.tsx (profile.tsx can't import this file,
 * which uses its Avatar).
 */
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, Linking, Pressable, StyleSheet, View } from 'react-native';

import { HalftoneGround } from '@/components/park-header';
import { Avatar } from '@/components/profile';
import { Caption, Sheet } from '@/components/tagging';
import { Button, CheckBox, Icon } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import {
  type CheckInAudience,
  isNotAtPark,
  locateForCheckIn,
  type Spot,
  useCheckIn,
  useCheckOut,
  useParkHereNow,
  useCheckInTime,
} from '@/lib/here-now';
import { formatDistance } from '@/lib/parks';
import { usesMetric } from '@/i18n';
import { brand, fontFamily, space, stroke, Text, useColors } from '@/theme';

type ParkForHereNow = {
  id: string;
  slug: string;
  display_name: string;
  latitude: number | null;
  longitude: number | null;
  metro?: { timezone: string | null } | null;
};

/* Park page section ---------------------------------------------------------------- */

export function HereNowSection({ park }: { park: ParkForHereNow }) {
  const { t } = useTranslation();
  const c = useColors();
  const { session } = useAuth();
  const myId = session?.user.id;
  const until = useCheckInTime();
  const { data, isPending, isError } = useParkHereNow(park.id);
  const checkOut = useCheckOut(myId);
  const [checkingIn, setCheckingIn] = useState(false);

  const people = data?.people ?? [];
  const unnamed = data?.unnamed ?? 0;
  const mine = people.find((p) => p.user_id === myId);
  const others = people.filter((p) => p.user_id !== myId);
  const tz = park.metro?.timezone;

  const leave = () =>
    checkOut.mutate(undefined, { onError: () => Alert.alert(t('errors.generic')) });

  return (
    <View style={styles.block}>
      <View style={styles.headingRow}>
        <Text variant="title" accessibilityRole="header" style={styles.flex}>
          {t('hereNow.title')}
        </Text>
        {others.length > 0 ? (
          <Text variant="label" color="textSecondary">
            {t('hereNow.peopleYouFollow')}
          </Text>
        ) : null}
      </View>

      {isPending ? (
        <ActivityIndicator color={c.text} style={styles.loading} />
      ) : isError ? (
        <Text variant="bodySm" color="statusClosed">
          {t('errors.network')}
        </Text>
      ) : (
        <>
          {people.length > 0 ? (
            <View style={{ backgroundColor: c.surfaceRaised }}>
              {people.map((p, i) => (
                <Pressable
                  key={p.user_id}
                  accessibilityRole="button"
                  accessibilityLabel={`${p.user_id === myId ? t('hereNow.you') : p.username ?? ''}, ${t('hereNow.until', { time: until(p.ends_at, tz) })}`}
                  onPress={() =>
                    p.username
                      ? router.push({ pathname: '/profile/[username]', params: { username: p.username } })
                      : undefined
                  }
                  style={({ pressed }) => [
                    styles.person,
                    i < people.length - 1 && { borderBottomWidth: stroke.hairline, borderBottomColor: c.borderSubtle },
                    pressed && styles.pressed,
                  ]}
                >
                  <Avatar path={p.avatar_path} username={p.username ?? ''} size={36} />
                  <Text variant="body" numberOfLines={1} style={[styles.flex, { fontFamily: fontFamily.sansSemiBold }]}>
                    {p.user_id === myId ? t('hereNow.you') : p.username}
                  </Text>
                  <Text variant="bodySm" color="textSecondary">
                    {t('hereNow.until', { time: until(p.ends_at, tz) })}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}

          {unnamed > 0 && people.length === 0 ? (
            <View style={styles.count} accessible accessibilityLabel={t('hereNow.count', { count: unnamed })}>
              <HalftoneGround />
              <Text variant="displayXl" style={styles.countNumber}>
                {unnamed}
              </Text>
              <View style={styles.flex}>
                <Text variant="headline" style={{ color: brand.paper }}>
                  {t('hereNow.countLabel', { count: unnamed })}
                </Text>
                <Text variant="bodySm" style={{ color: brand.paper, opacity: 0.75 }}>
                  {t('hereNow.countNote')}
                </Text>
              </View>
            </View>
          ) : unnamed > 0 ? (
            <Text variant="bodySm" color="textSecondary">
              {t('hereNow.others', { count: unnamed })}
            </Text>
          ) : null}

          {people.length === 0 && unnamed === 0 ? (
            <Text variant="bodySm" color="textSecondary">
              {t('hereNow.nobody')}
            </Text>
          ) : null}
        </>
      )}

      {mine ? (
        <Button label={t('hereNow.iLeft')} variant="secondary" loading={checkOut.isPending} onPress={leave} />
      ) : (
        <Button label={t('hereNow.imHere')} variant="secondary" icon="checkIn" onPress={() => setCheckingIn(true)} />
      )}

      <CheckInSheet park={park} visible={checkingIn} onClose={() => setCheckingIn(false)} />
    </View>
  );
}

/* Check-in sheet ------------------------------------------------------------------- */

export function CheckInSheet({ park, visible, onClose }: { park: ParkForHereNow; visible: boolean; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const c = useColors();
  const { session } = useAuth();
  const until = useCheckInTime();
  const checkIn = useCheckIn(session?.user.id);
  const [spot, setSpot] = useState<Spot | null>(null);
  const [endsAt, setEndsAt] = useState<string | null>(null);
  const [audience, setAudience] = useState<CheckInAudience>('followers');
  const [refused, setRefused] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [wasVisible, setWasVisible] = useState(false);

  // Each time the sheet opens, start over and check where you are once.
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) {
      setSpot(null);
      setRefused(false);
      setAttempt((n) => n + 1);
    }
  }
  const locate = () => {
    setSpot(null);
    setRefused(false);
    setAttempt((n) => n + 1);
  };
  useEffect(() => {
    if (attempt === 0) return;
    let cancelled = false;
    void locateForCheckIn(park).then((found) => {
      if (cancelled) return;
      setSpot(found);
      // A check-in made now would last 3 hours.
      setEndsAt(new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString());
    });
    return () => {
      cancelled = true;
    };
    // Only a new attempt locates again, not a park object re-created by a refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  const confirm = () => {
    if (spot?.kind !== 'here') return;
    checkIn.mutate(
      { parkId: park.id, latitude: spot.latitude, longitude: spot.longitude, audience },
      {
        onSuccess: onClose,
        onError: (err) => (isNotAtPark(err) ? setRefused(true) : Alert.alert(t('errors.generic'))),
      },
    );
  };

  const atPark = spot?.kind === 'here' && !refused;

  let status: { icon: 'checkIn' | 'pinOff' | 'info'; title: string; body: string; ok: boolean };
  if (!spot) status = { icon: 'info', title: t('hereNow.locating'), body: '', ok: false };
  else if (spot.kind === 'off')
    status = { icon: 'pinOff', title: t('hereNow.locationOff'), body: t('hereNow.locationOffBody'), ok: false };
  else if (spot.kind === 'unknown')
    status = { icon: 'pinOff', title: t('hereNow.noFix'), body: t('hereNow.noFixBody'), ok: false };
  else if (atPark)
    status = { icon: 'checkIn', title: t('hereNow.atPark', { park: park.display_name }), body: t('hereNow.checkedOnce'), ok: true };
  else
    status = {
      icon: 'pinOff',
      title: t('hereNow.away', { park: park.display_name }),
      body:
        spot.kind === 'away' && Number.isFinite(spot.metres) && !refused
          ? t('hereNow.awayBody', { distance: formatDistance(spot.metres, usesMetric(), i18n.language) })
          : t('hereNow.awayNoDistance'),
      ok: false,
    };

  return (
    <Sheet visible={visible} title={t('hereNow.sheetTitle', { park: park.display_name })} onClose={onClose}>
      <View style={styles.sheetBody}>
        <View style={[styles.status, { backgroundColor: c.surfaceRaised, borderColor: c.border }]}>
          {spot ? (
            <View
              style={[
                styles.statusIcon,
                { borderColor: c.border, backgroundColor: status.ok ? c.accent : 'transparent' },
              ]}
            >
              <Icon name={status.ok ? 'check' : status.icon} color={status.ok ? c.onAccent : c.text} size={18} />
            </View>
          ) : (
            <ActivityIndicator color={c.text} />
          )}
          <View style={styles.flex}>
            <Text variant="headline">{status.title}</Text>
            {status.body ? (
              <Text variant="bodySm" color="textSecondary">
                {status.body}
              </Text>
            ) : null}
          </View>
        </View>
        {spot?.kind === 'off' ? (
          <Button label={t('hereNow.openSettings')} variant="secondary" onPress={() => void Linking.openSettings()} />
        ) : spot && !atPark ? (
          <Button label={t('common.retry')} variant="secondary" onPress={locate} />
        ) : null}

        <Caption>{t('hereNow.whoSees')}</Caption>
        <View style={[styles.options, { borderTopColor: c.borderSubtle }]} accessibilityRole="radiogroup">
          {(
            [
              ['followers', t('hereNow.followers'), t('hereNow.followersNote')],
              ['friends', t('hereNow.friends'), t('hereNow.friendsNote')],
            ] as const
          ).map(([value, title, note]) => {
            const on = audience === value;
            return (
              <Pressable
                key={value}
                accessibilityRole="radio"
                accessibilityState={{ checked: on }}
                accessibilityLabel={`${title}, ${note}`}
                onPress={() => setAudience(value)}
                style={({ pressed }) => [
                  styles.option,
                  { borderBottomColor: c.borderSubtle, backgroundColor: on ? c.accentSubtle : 'transparent' },
                  pressed && styles.pressed,
                ]}
              >
                <CheckBox checked={on} c={c} />
                <View style={styles.flex}>
                  <Text variant="headline" style={{ color: on ? c.onAccentSubtle : c.text }}>
                    {title}
                  </Text>
                  <Text variant="caption" style={{ color: on ? c.onAccentSubtleSecondary : c.textSecondary }}>
                    {note}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.rules}>
          <View style={styles.rule}>
            <Icon name="timer" color={c.text} size={18} />
            <Text variant="bodySm" color="textSecondary" style={styles.flex}>
              {endsAt ? t('hereNow.lasts', { time: until(endsAt, park.metro?.timezone) }) : t('hereNow.lastsShort')}
            </Text>
          </View>
          <View style={styles.rule}>
            <Icon name="people" color={c.text} size={18} />
            <Text variant="bodySm" color="textSecondary" style={styles.flex}>
              {t('hereNow.countRule')}
            </Text>
          </View>
        </View>

        <Button
          label={t('hereNow.checkIn')}
          icon="checkIn"
          disabled={!atPark}
          loading={checkIn.isPending}
          onPress={confirm}
          palette={atPark ? { fill: c.accent, text: c.onAccent, border: c.onAccent } : undefined}
        />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pressed: { opacity: 0.75 },
  block: { paddingHorizontal: space[4], gap: space[2] },
  headingRow: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  loading: { marginVertical: space[3] },
  person: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: space[3], paddingHorizontal: space[3] },
  count: {
    overflow: 'hidden',
    backgroundColor: brand.ink,
    paddingHorizontal: space[4],
    paddingVertical: space[6] - 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
  },
  countNumber: {
    color: brand.paper,
    textShadowColor: brand.pink,
    textShadowOffset: { width: 3, height: 3 },
    textShadowRadius: 0,
  },
  sheetBody: { paddingHorizontal: space[4], paddingBottom: space[4], gap: space[3] },
  status: { borderWidth: stroke.rule, padding: space[3], flexDirection: 'row', alignItems: 'center', gap: space[3] },
  statusIcon: { width: 28, height: 28, borderWidth: stroke.rule, alignItems: 'center', justifyContent: 'center' },
  options: { borderTopWidth: stroke.hairline },
  option: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingHorizontal: space[2],
    borderBottomWidth: stroke.hairline,
  },
  rules: { gap: space[2] },
  rule: { flexDirection: 'row', gap: space[2], alignItems: 'flex-start' },
});
