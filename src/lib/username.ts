/**
 * The live "free / taken" check for usernames, used by onboarding and Edit
 * profile. It's a live validation of what's being typed, not cached data, so
 * it runs straight against the server rather than through the query cache.
 */
import { useEffect, useState } from 'react';

import { supabase } from './supabase';

/** Matches the profiles_username_check constraint: 2–30 letters, numbers, dots, underscores. */
export const USERNAME_PATTERN = /^[a-zA-Z0-9_.]{2,30}$/;

/**
 * - idle: nothing typed
 * - invalid: breaks the format rules
 * - unchanged: the member's own current name (any capitals)
 * - checking / free / taken: the server's answer
 */
export type Availability = 'idle' | 'invalid' | 'unchanged' | 'checking' | 'free' | 'taken';

/**
 * Checks a name 400 ms after typing stops. "Taken" covers names other
 * members have, names held for 14 days after someone changed away from them,
 * and names of people blocked either way (username_available() in the
 * profile_settings migration).
 */
export function useUsernameCheck(name: string, current: string | null | undefined) {
  // The last name the server checked, and whether it was free.
  const [checked, setChecked] = useState<{ name: string; free: boolean } | null>(null);
  const valid = USERNAME_PATTERN.test(name);
  const unchanged = Boolean(current) && name.toLowerCase() === current!.toLowerCase();

  useEffect(() => {
    if (!valid || unchanged) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const { data, error } = await supabase.rpc('username_available', { name });
      if (cancelled || error) return;
      setChecked({ name, free: Boolean(data) });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [name, valid, unchanged]);

  const availability: Availability = !name
    ? 'idle'
    : !valid
      ? 'invalid'
      : unchanged
        ? 'unchanged'
        : checked?.name.toLowerCase() === name.toLowerCase()
          ? checked.free
            ? 'free'
            : 'taken'
          : 'checking';

  /** Call when a save says the name was taken after all. */
  const markTaken = (taken: string) => setChecked({ name: taken, free: false });

  return { availability, markTaken };
}
