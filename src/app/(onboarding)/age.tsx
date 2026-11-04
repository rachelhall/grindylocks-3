import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { FormScreen } from '@/components/screen';
import { Button, StepHeader } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { redeemMyPageInvite } from '@/lib/claims';
import { useOnboardingSteps } from '@/lib/onboarding';
import { Sentry } from '@/lib/sentry';
import { redeemMyInvite } from '@/lib/social';
import { supabase } from '@/lib/supabase';
import { Text } from '@/theme';

/**
 * Age gate (minimum age 16). Only the fact that someone confirmed, and when,
 * is stored — never a birthdate. Saying yes creates the profile row, then
 * redeems the invite the account was created with.
 */
export default function AgeStep() {
  const { t } = useTranslation();
  const { session, refreshProfile, signOut } = useAuth();
  const steps = useOnboardingSteps();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tooYoung, setTooYoung] = useState(false);

  async function confirm() {
    if (!session) return;
    setSaving(true);
    setError(null);
    // A server function stamps the time and creates the profile row, since
    // members can't read or write age_confirmed_at directly.
    const { error: saveError } = await supabase.rpc('confirm_age');
    if (saveError) {
      setSaving(false);
      setError(t('errors.generic'));
      return;
    }
    // Now there's a profile, mark the invite used, follow the inviter and
    // tell them. Does nothing for accounts made without an invite, and is
    // safe to repeat. A failure here doesn't hold up onboarding.
    await redeemMyInvite().catch((e: unknown) => Sentry.captureException(e));
    // Or, for an account made with an emailed page invite, join the page.
    await redeemMyPageInvite().catch((e: unknown) => Sentry.captureException(e));
    await refreshProfile();
    setSaving(false);
    router.push('/username');
  }

  if (tooYoung) {
    return (
      <FormScreen
        footer={<Button label={t('onboarding.age.otherAccount')} variant="secondary" onPress={signOut} />}
      >
        <Text variant="display" accessibilityRole="header">
          {t('onboarding.age.tooYoungTitle')}
        </Text>
        <Text variant="body" color="textSecondary">
          {t('onboarding.age.tooYoungBody')}
        </Text>
      </FormScreen>
    );
  }

  return (
    <FormScreen
      header={<StepHeader step={1} total={steps} canGoBack={false} />}
      footer={
        <>
          <Button label={t('onboarding.age.yes')} onPress={confirm} loading={saving} />
          <Button label={t('onboarding.age.no')} variant="secondary" onPress={() => setTooYoung(true)} />
          <Button label={t('onboarding.age.otherAccount')} variant="tertiary" onPress={signOut} />
        </>
      }
    >
      <Text variant="display" accessibilityRole="header">
        {t('onboarding.age.title')}
      </Text>
      <Text variant="body" color="textSecondary">
        {t('onboarding.age.body')}
      </Text>
      {error ? (
        <Text variant="bodySm" color="statusClosed" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </FormScreen>
  );
}
