import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AnnounceCard, HomePicker } from '@/components/home-picker';
import { FormScreen } from '@/components/screen';
import { Button, StepHeader } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { useOnboarding, useOnboardingSteps } from '@/lib/onboarding';
import { pageKind } from '@/lib/pages';
import { useDirectory } from '@/lib/parks';
import { supabase } from '@/lib/supabase';
import { brand, space, Text } from '@/theme';

/**
 * Home city (required) and home park (optional). Also asks whether to
 * announce the new member to that city.
 *
 * Shop staff joining through a page (Onboard-City-Shop) start with the
 * shop's city filled in, marked FROM 8SET; brand staff pick their own.
 */
export default function CityStep() {
  const { t } = useTranslation();
  const { session, profile, refreshProfile, pageJoin } = useAuth();
  const steps = useOnboardingSteps();
  const shopMetro = pageJoin && pageKind(pageJoin) === 'shop' ? pageJoin.metroAreaId : null;
  const { announce, setAnnounce, setAnnounceAsked } = useOnboarding();
  const directory = useDirectory();

  const [home, setHome] = useState({
    metroId: profile?.home_metro_area_id ?? shopMetro,
    parkId: profile?.home_park_id ?? null,
  });
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const metro = directory.data?.metros.find((m) => m.id === home.metroId) ?? null;

  async function save() {
    setShowErrors(true);
    setSaveError(null);
    if (!session || !home.metroId) return;
    setSaving(true);
    const { error } = await supabase
      .from('profiles')
      .update({ home_metro_area_id: home.metroId, home_park_id: home.parkId })
      .eq('id', session.user.id);
    if (error) {
      setSaving(false);
      setSaveError(t('errors.generic'));
      return;
    }
    setAnnounceAsked(true);
    await refreshProfile();
    setSaving(false);
    router.push('/regulars');
  }

  return (
    <FormScreen
      header={<StepHeader step={3} total={steps} canGoBack={router.canGoBack()} />}
      footer={
        <>
          {saveError ? (
            <Text variant="bodySm" color="statusClosed" accessibilityLiveRegion="polite">
              {saveError}
            </Text>
          ) : null}
          <Button label={t('common.continue')} onPress={save} loading={saving} disabled={!directory.data} />
        </>
      }
    >
      <View style={styles.intro}>
        <Text variant="display" accessibilityRole="header">
          {t('onboarding.city.title')}
        </Text>
        <Text variant="body" color="textSecondary">
          {shopMetro ? t('onboarding.page.cityFromShop', { name: pageJoin?.displayName ?? '' }) : t('onboarding.city.body')}
        </Text>
      </View>

      {shopMetro && home.metroId === shopMetro ? (
        <View style={styles.fromTape}>
          <Text variant="label" style={styles.fromText}>
            {t('onboarding.page.from', { name: pageJoin?.displayName ?? '' }).toUpperCase()}
          </Text>
        </View>
      ) : null}

      <HomePicker metroId={home.metroId} parkId={home.parkId} onChange={setHome} showErrors={showErrors} />

      {/* "Someone new" announcement, on by default */}
      {metro ? <AnnounceCard city={metro.name} value={announce} onChange={setAnnounce} /> : null}
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  intro: { gap: space[3] },
  fromTape: { alignSelf: 'flex-start', backgroundColor: brand.pink, paddingHorizontal: space[2], paddingVertical: 2, transform: [{ rotate: '-2deg' }] },
  fromText: { color: brand.ink },
});
