import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { FormScreen } from '@/components/screen';
import { Button, ChoiceCard, Icon, StepHeader, TextField } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { useOnboardingSteps } from '@/lib/onboarding';
import { pageKind } from '@/lib/pages';
import { type Discipline, PROFILE_DISCIPLINES } from '@/lib/profiles';
import { supabase } from '@/lib/supabase';
import { useUsernameCheck } from '@/lib/username';
import { brand, fontFamily, space, stroke, Text, useColors } from '@/theme';

/**
 * Username and disciplines. The name is checked live as it's typed; a name
 * the member already saved (coming back to this step) counts as free.
 *
 * Someone joining through a page (Onboard-Username-Page) sees a "Joining
 * 8SET as staff" strip, and disciplines are optional: a shop's bookkeeper
 * may not skate.
 */
export default function UsernameStep() {
  const { t } = useTranslation();
  const c = useColors();
  const { session, profile, refreshProfile, pageJoin } = useAuth();
  const steps = useOnboardingSteps();
  const disciplinesOptional = Boolean(pageJoin);
  const [username, setUsername] = useState(profile?.username ?? '');
  const [disciplines, setDisciplines] = useState<Discipline[]>(profile?.disciplines ?? []);
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const myId = session?.user.id;
  const name = username.trim();
  const check = useUsernameCheck(name, profile?.username);
  const availability = check.availability === 'unchanged' ? 'free' : check.availability;

  function toggle(d: Discipline) {
    setDisciplines((current) => (current.includes(d) ? current.filter((x) => x !== d) : [...current, d]));
  }

  async function save() {
    setShowErrors(true);
    setSaveError(null);
    if (!myId || availability !== 'free' || (disciplines.length === 0 && !disciplinesOptional)) return;
    setSaving(true);
    const { error } = await supabase
      .from('profiles')
      .update({ username: name, disciplines })
      .eq('id', myId);
    if (error) {
      setSaving(false);
      // 23505: someone took the name between the check and the save.
      if (error.code === '23505') check.markTaken(name);
      else setSaveError(t('errors.generic'));
      return;
    }
    await refreshProfile();
    setSaving(false);
    router.push('/city');
  }

  const usernameError =
    availability === 'taken'
      ? t('onboarding.username.taken')
      : availability === 'invalid'
        ? t('onboarding.username.invalid')
        : showErrors && !name
          ? t('onboarding.username.invalid')
          : null;

  const badge =
    availability === 'free' ? (
      <View style={[styles.badge, { borderColor: c.statusOpen }]}>
        <Text variant="label" color="statusOpen">
          {t('onboarding.username.free')}
        </Text>
      </View>
    ) : availability === 'checking' ? (
      <Text variant="label" color="textSecondary">
        {t('onboarding.username.checking')}
      </Text>
    ) : null;

  return (
    <FormScreen
      header={<StepHeader step={2} total={steps} canGoBack={router.canGoBack()} />}
      footer={
        <>
          {saveError ? (
            <Text variant="bodySm" color="statusClosed" accessibilityLiveRegion="polite">
              {saveError}
            </Text>
          ) : null}
          <Button label={t('common.continue')} onPress={save} loading={saving} />
        </>
      }
    >
      {pageJoin ? (
        <View style={styles.joining}>
          <Icon name={pageKind(pageJoin) === 'shop' ? 'storefront' : 'badgeRole'} color={brand.paper} size={16} />
          <Text variant="bodySm" style={styles.joiningText}>
            {t('onboarding.page.joining', { name: pageJoin.displayName, role: t(`pageInvite.roleAs.${pageJoin.role}`) })}
          </Text>
        </View>
      ) : null}
      <Text variant="display" accessibilityRole="header">
        {t('onboarding.username.title')}
      </Text>
      <TextField
        label={t('onboarding.username.label')}
        prefix="@"
        value={username}
        onChangeText={(v) => setUsername(v.replace(/\s/g, ''))}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="username-new"
        textContentType="username"
        maxLength={30}
        accessory={badge}
        error={usernameError}
        hint={t('onboarding.username.hint')}
      />
      <View style={styles.group} accessibilityRole="list">
        <Text variant="bodySm" style={styles.legend}>
          {t('onboarding.username.disciplinesLegend')}
          <Text variant="bodySm" color="textSecondary">
            {`  ${disciplinesOptional ? t('common.optional') : t('onboarding.username.pickAll')}`}
          </Text>
        </Text>
        {PROFILE_DISCIPLINES.map((d) => (
          <ChoiceCard
            key={d}
            title={t(`onboarding.username.${d}`)}
            subtitle={t(`onboarding.username.${d}Sub`)}
            checked={disciplines.includes(d)}
            onToggle={() => toggle(d)}
          />
        ))}
        {disciplinesOptional ? (
          <Text variant="bodySm" color="textSecondary">
            {t('onboarding.page.noSkating')}
          </Text>
        ) : null}
        {showErrors && disciplines.length === 0 && !disciplinesOptional ? (
          <Text variant="bodySm" color="statusClosed" accessibilityLiveRegion="polite">
            {t('onboarding.username.pickOne')}
          </Text>
        ) : null}
      </View>
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  badge: { borderWidth: stroke.rule, paddingHorizontal: 6, paddingVertical: 2 },
  group: { gap: space[2] },
  legend: { fontFamily: fontFamily.sansSemiBold, marginBottom: space[1] },
  joining: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    backgroundColor: brand.ink,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  joiningText: { color: brand.paper, fontFamily: fontFamily.sansSemiBold },
});
