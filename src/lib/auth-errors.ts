import { type AuthError, isAuthApiError } from '@supabase/supabase-js';

/** A loose check, just to catch typos before asking Supabase for a code. */
export function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/**
 * Map a Supabase Auth error to a translation key.
 * See https://supabase.com/docs/guides/auth/debugging/error-codes
 */
export function authErrorKey(error: AuthError) {
  const code = isAuthApiError(error) ? error.code : undefined;
  switch (code) {
    // Sign-ups are off, so asking for a code for an unknown address fails.
    case 'otp_disabled':
    case 'signup_disabled':
    case 'user_not_found':
      return 'auth.email.notMember' as const;
    case 'otp_expired':
      return 'auth.code.wrong' as const;
    case 'over_email_send_rate_limit':
    case 'over_request_rate_limit':
      return 'auth.email.rateLimited' as const;
  }
  if (error.status === 429) return 'auth.email.rateLimited' as const;
  if (error.name === 'AuthRetryableFetchError') return 'errors.network' as const;
  return 'errors.generic' as const;
}
