import { createContext, type ReactNode, useCallback, useContext, useState } from 'react';

import { announceArrival } from './announcements';
import { useAuth } from './auth';
import { supabase } from './supabase';

/** Steps shown in the progress bar: age, username, city, regulars. */
export const ONBOARDING_STEPS = 4;

/** An owner joining through a page without a logo gets a fifth step: the logo. */
export function useOnboardingSteps(): number {
  const { pageJoin } = useAuth();
  return pageJoin?.needsLogo ? ONBOARDING_STEPS + 1 : ONBOARDING_STEPS;
}

/**
 * Choices made during onboarding that aren't saved on the profile.
 *
 * The "say hi" announcement only goes out when onboarding finishes, and only
 * if the toggle was left on. It's kept in memory on purpose: if the app is
 * closed partway, the choice is lost and nothing is announced, which is the
 * safe way round (the brief says nothing goes out unless they leave it on).
 */
type OnboardingChoices = {
  announce: boolean;
  setAnnounce: (value: boolean) => void;
  /** Set when the toggle was shown, so a resumed flow doesn't announce. */
  announceAsked: boolean;
  setAnnounceAsked: (value: boolean) => void;
};

const OnboardingContext = createContext<OnboardingChoices | null>(null);

export function OnboardingProvider({ children }: { children: ReactNode }) {
  const [announce, setAnnounce] = useState(true);
  const [announceAsked, setAnnounceAsked] = useState(false);
  return (
    <OnboardingContext.Provider value={{ announce, setAnnounce, announceAsked, setAnnounceAsked }}>
      {children}
    </OnboardingContext.Provider>
  );
}

export function useOnboarding(): OnboardingChoices {
  const value = useContext(OnboardingContext);
  if (!value) throw new Error('useOnboarding must be used inside <OnboardingProvider>');
  return value;
}

/**
 * The last step: saves the regulars choice and onboarded_at, then sends the
 * "say hi" announcement if they saw the toggle and left it on. Once
 * onboarded_at is set, the root layout switches to the app. Returns false
 * when saving failed. Used by the regulars step, or by the logo step when
 * an owner joining through a page still has a logo to add.
 */
export function useFinishOnboarding() {
  const { session, profile, refreshProfile } = useAuth();
  const { announce, announceAsked } = useOnboarding();
  return useCallback(
    async (hide: boolean): Promise<boolean> => {
      if (!session || !profile?.home_metro_area_id) return false;
      const { error } = await supabase
        .from('profiles')
        .update({ hide_from_regulars: hide, onboarded_at: new Date().toISOString() })
        .eq('id', session.user.id);
      if (error) return false;
      if (announceAsked && announce) {
        await announceArrival(session.user.id, profile.home_metro_area_id, profile.home_park_id ?? null);
      }
      await refreshProfile();
      return true;
    },
    [session, profile, refreshProfile, announce, announceAsked],
  );
}
