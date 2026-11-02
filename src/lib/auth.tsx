import type { Session } from '@supabase/supabase-js';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react';

import type { Database } from './database.types';
import { forgetThisPhone } from './push';
import { supabase } from './supabase';

type Discipline = Database['public']['Enums']['discipline'];

/** The signed-in member's own profile: only the columns onboarding needs. */
export type MyProfile = {
  id: string;
  username: string | null;
  disciplines: Discipline[];
  home_metro_area_id: string | null;
  home_park_id: string | null;
  onboarded_at: string | null;
};

/** Where an unfinished member picks up onboarding. */
export type OnboardingStep = 'age' | 'username' | 'city' | 'regulars';

type AuthState = {
  /** False until the stored session (and, if signed in, the profile) has loaded. */
  ready: boolean;
  session: Session | null;
  /** Null when signed out, or signed in before onboarding created the row. */
  profile: MyProfile | null;
  /** age_confirmed_at isn't readable from profiles, so it comes from my_account(). */
  ageConfirmed: boolean;
  /** Set when the profile couldn't be loaded (usually no connection). */
  profileError: boolean;
  onboarded: boolean;
  onboardingStep: OnboardingStep;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

const PROFILE_COLUMNS =
  'id, username, disciplines, home_metro_area_id, home_park_id, onboarded_at' as const;

function stepFor(profile: MyProfile | null, ageConfirmed: boolean): OnboardingStep {
  if (!profile || !ageConfirmed) return 'age';
  if (!profile.username || profile.disciplines.length === 0) return 'username';
  if (!profile.home_metro_area_id) return 'city';
  return 'regulars';
}

type LoadedProfile = {
  uid: string;
  profile: MyProfile | null;
  ageConfirmed: boolean;
  error: boolean;
};

async function fetchProfile(uid: string): Promise<LoadedProfile> {
  const [profileRes, accountRes] = await Promise.all([
    supabase.from('profiles').select(PROFILE_COLUMNS).eq('id', uid).maybeSingle(),
    supabase.rpc('my_account'),
  ]);
  if (profileRes.error || accountRes.error) {
    return { uid, profile: null, ageConfirmed: false, error: true };
  }
  return {
    uid,
    profile: profileRes.data,
    ageConfirmed: Boolean(accountRes.data?.[0]?.age_confirmed_at),
    error: false,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [sessionChecked, setSessionChecked] = useState(false);
  // Profile results are tagged with the user they belong to, so a stale
  // result never leaks across a sign-out or a switch of account.
  const [loaded, setLoaded] = useState<LoadedProfile | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setSessionChecked(true);
    });
    // Don't call other supabase methods inside this callback: supabase-js
    // holds a lock while it runs. Profile loading happens in the effect below.
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      setSessionChecked(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const userId = session?.user.id ?? null;

  // Errors keep whatever profile was already loaded for this user.
  const applyLoaded = useCallback((result: LoadedProfile) => {
    setLoaded((prev) =>
      result.error && prev?.uid === result.uid
        ? { ...prev, error: true }
        : result,
    );
  }, []);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    fetchProfile(userId).then((result) => {
      if (!cancelled) applyLoaded(result);
    });
    return () => {
      cancelled = true;
    };
  }, [userId, applyLoaded]);

  const refreshProfile = useCallback(async () => {
    if (userId) applyLoaded(await fetchProfile(userId));
  }, [userId, applyLoaded]);

  const signOut = useCallback(async () => {
    // While still signed in: stop pushes for this member reaching this phone.
    await forgetThisPhone().catch(() => undefined);
    await supabase.auth.signOut();
  }, []);

  const current = userId && loaded?.uid === userId ? loaded : null;
  const profile = current?.profile ?? null;
  const ageConfirmed = current?.ageConfirmed ?? false;
  const profileError = current?.error ?? false;
  const ready = sessionChecked && (!userId || current !== null);
  const onboarded = Boolean(profile?.onboarded_at);

  return (
    <AuthContext.Provider
      value={{
        ready,
        session,
        profile,
        ageConfirmed,
        profileError,
        onboarded,
        onboardingStep: stepFor(profile, ageConfirmed),
        refreshProfile,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>');
  return value;
}
