import { createContext, type ReactNode, useContext, useState } from 'react';

/** Steps shown in the progress bar: age, username, city, regulars. */
export const ONBOARDING_STEPS = 4;

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
