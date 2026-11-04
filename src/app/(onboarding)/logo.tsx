import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Alert } from 'react-native';

import { PageLogoForm } from '@/components/page-logo';
import { StepHeader } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { useFinishOnboarding, useOnboardingSteps } from '@/lib/onboarding';

/**
 * The last onboarding step for an owner joining through a page invite whose
 * page has no logo yet (Onboard-Logo). Either button finishes onboarding
 * with the regulars choice made on the step before; Skip keeps the page
 * UNOFFICIAL until a logo is added.
 */
export default function LogoStep() {
  const { t } = useTranslation();
  const { pageJoin } = useAuth();
  const steps = useOnboardingSteps();
  const finish = useFinishOnboarding();
  const { hide } = useLocalSearchParams<{ hide?: string }>();

  if (!pageJoin) return null;
  return (
    <PageLogoForm
      page={{ id: pageJoin.pageId, displayName: pageJoin.displayName, roles: pageJoin.roles, city: pageJoin.city }}
      header={<StepHeader step={steps} total={steps} canGoBack={router.canGoBack()} />}
      onDone={async () => {
        if (!(await finish(hide === '1'))) Alert.alert(t('errors.generic'));
      }}
    />
  );
}
