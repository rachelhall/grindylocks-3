import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { FormScreen } from '@/components/screen';
import { Button, ChoiceCard, StepHeader, TextField } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import type { Database } from '@/lib/database.types';
import { ONBOARDING_STEPS } from '@/lib/onboarding';
import { supabase } from '@/lib/supabase';
import { fontFamily, space, stroke, Text, useColors } from '@/theme';

type Discipline = Database['public']['Enums']['discipline'];

/** Signup offers these three; BMX and scooter exist only for park sessions. */
const SIGNUP_DISCIPLINES = ['inline', 'quad', 'skateboard'] as const satisfies readonly Discipline[];

// Matches the profiles_username_check constraint.
const USERNAME_PATTERN = /^[a-zA-Z0-9_.]{2,30}$/;

type Availability = 'idle' | 'checking' | 'free' | 'taken' | 'invalid';

export default function UsernameStep() {
  const { t } = useTranslation();
  const c = useColors();
  const { session, profile, refreshProfile } = useAuth();
  const [username, setUsername] = useState(profile?.username ?? '');
  const [disciplines, setDisciplines] = useState<Discipline[]>(profile?.disciplines ?? []);
  // The last name the server checked, and whether it was taken.
  const [checked, setChecked] = useState<{ name: string; taken: boolean } | null>(
    profile?.username ? { name: profile.username, taken: false } : null,
  );
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const myId = session?.user.id;
  const name = username.trim();

  const valid = USERNAME_PATTERN.test(name);
  const availability: Availability = !name
    ? 'idle'
    : !valid
      ? 'invalid'
      : checked?.name.toLowerCase() === name.toLowerCase()
        ? checked.taken
          ? 'taken'
          : 'free'
        : 'checking';

  // Check the name is free, after the person stops typing for a moment.
  useEffect(() => {
    if (!valid) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      // username is citext, so this match ignores case.
      const { data, error } = await supabase
        .from('profiles')
        .select('id')
        .eq('username', name)
        .neq('id', myId ?? '')
        .limit(1);
      if (cancelled || error) return;
      setChecked({ name, taken: data.length > 0 });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [name, valid, myId]);

  function toggle(d: Discipline) {
    setDisciplines((current) => (current.includes(d) ? current.filter((x) => x !== d) : [...current, d]));
  }

  async function save() {
    setShowErrors(true);
    setSaveError(null);
    if (!myId || availability !== 'free' || disciplines.length === 0) return;
    setSaving(true);
    const { error } = await supabase
      .from('profiles')
      .update({ username: name, disciplines })
      .eq('id', myId);
    if (error) {
      setSaving(false);
      // 23505: someone took the name between the check and the save.
      if (error.code === '23505') setChecked({ name, taken: true });
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
      header={<StepHeader step={2} total={ONBOARDING_STEPS} canGoBack={router.canGoBack()} />}
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
          <Text variant="bodySm" color="textSecondary">{`  ${t('onboarding.username.pickAll')}`}</Text>
        </Text>
        {SIGNUP_DISCIPLINES.map((d) => (
          <ChoiceCard
            key={d}
            title={t(`onboarding.username.${d}`)}
            subtitle={t(`onboarding.username.${d}Sub`)}
            checked={disciplines.includes(d)}
            onToggle={() => toggle(d)}
          />
        ))}
        {showErrors && disciplines.length === 0 ? (
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
});
