import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { FormScreen } from '@/components/screen';
import { Button, StepHeader } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { ONBOARDING_STEPS, useOnboarding } from '@/lib/onboarding';
import { Sentry } from '@/lib/sentry';
import { supabase } from '@/lib/supabase';
import { space, Text, useColors } from '@/theme';

/**
 * The regulars-list notice, so nobody is listed without knowing. Either
 * button finishes onboarding; the second also hides them from regulars lists.
 */
export default function RegularsStep() {
  const { t } = useTranslation();
  const c = useColors();
  const { session, profile, refreshProfile } = useAuth();
  const { announce, announceAsked } = useOnboarding();
  const [parkName, setParkName] = useState<string | null>(null);
  const [saving, setSaving] = useState<'show' | 'hide' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const homeParkId = profile?.home_park_id ?? null;

  useEffect(() => {
    if (!homeParkId) return;
    supabase
      .from('parks')
      .select('display_name')
      .eq('id', homeParkId)
      .maybeSingle()
      .then(({ data }) => setParkName(data?.display_name ?? null));
  }, [homeParkId]);

  async function finish(hide: boolean) {
    if (!session || !profile?.home_metro_area_id) return;
    setSaving(hide ? 'hide' : 'show');
    setError(null);
    const { error: saveError } = await supabase
      .from('profiles')
      .update({ hide_from_regulars: hide, onboarded_at: new Date().toISOString() })
      .eq('id', session.user.id);
    if (saveError) {
      setSaving(null);
      setError(t('errors.generic'));
      return;
    }

    // Only announce if they saw the toggle in this run and left it on.
    if (announceAsked && announce) {
      const { error: announceError } = await supabase.from('announcements').insert({
        user_id: session.user.id,
        kind: 'joined',
        metro_area_id: profile.home_metro_area_id,
        park_id: homeParkId,
      });
      // Not worth blocking the member over; they've joined either way.
      if (announceError) Sentry.captureException(announceError);
    }

    // Once onboarded_at is set, the root layout switches to the app.
    await refreshProfile();
  }

  return (
    <FormScreen
      header={<StepHeader step={4} total={ONBOARDING_STEPS} canGoBack={router.canGoBack()} />}
      footer={
        <>
          {error ? (
            <Text variant="bodySm" color="statusClosed" accessibilityLiveRegion="polite">
              {error}
            </Text>
          ) : null}
          <Button
            label={t('onboarding.regulars.gotIt')}
            onPress={() => finish(false)}
            loading={saving === 'show'}
            disabled={saving !== null}
          />
          <Button
            variant="tertiary"
            label={t('onboarding.regulars.hideMe')}
            onPress={() => finish(true)}
            loading={saving === 'hide'}
            disabled={saving !== null}
          />
        </>
      }
    >
      <View style={styles.intro}>
        <Text variant="display" accessibilityRole="header">
          {t('onboarding.regulars.title')}
        </Text>
        <Text variant="body" color="textSecondary">
          {t('onboarding.regulars.body')}
        </Text>
      </View>

      {parkName && profile?.username ? (
        <View style={[styles.preview, { backgroundColor: c.surfaceRaised }]}>
          <Text variant="label" color="textSecondary">
            {t('onboarding.regulars.listLabel', { park: parkName })}
          </Text>
          <View style={styles.person}>
            <View style={[styles.avatar, { backgroundColor: c.surfaceSunk }]}>
              <Text variant="headline">
                {profile.username.slice(0, 2).toUpperCase()}
              </Text>
            </View>
            <Text variant="headline">
              {profile.username}
              <Text variant="headline" color="textSecondary">{` ${t('onboarding.regulars.you')}`}</Text>
            </Text>
          </View>
        </View>
      ) : null}

      <View style={styles.points}>
        {(['point1', 'point2', 'point3'] as const).map((key) => (
          <View key={key} style={styles.point}>
            <View style={[styles.bullet, { backgroundColor: c.text }]} />
            <Text variant="body" style={styles.pointText}>
              {t(`onboarding.regulars.${key}`)}
            </Text>
          </View>
        ))}
      </View>
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  intro: { gap: space[3] },
  preview: { padding: space[4], gap: space[3] },
  person: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  avatar: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  points: { gap: space[3] },
  point: { flexDirection: 'row', gap: space[3] },
  bullet: { width: 8, height: 8, marginTop: 8 },
  pointText: { flex: 1 },
});
