import { type AuthError, isAuthApiError } from '@supabase/supabase-js';

/** A loose check, just to catch typos before asking Supabase for a code. */
export function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/**
 * Options for asking Supabase for a sign-in code. Without an invite only
 * existing members get one. With an invite, a new account may be created;
 * the code rides along as user metadata for the before_user_created hook
 * (and redeem_my_invite() later). Existing members who open someone's invite
 * just sign in, and the code is ignored.
 */
export function otpOptions(invite?: string) {
  return invite
    ? { shouldCreateUser: true, data: { invite_code: invite.toUpperCase().replace(/[^A-Z0-9]/g, '') } }
    : { shouldCreateUser: false };
}

/**
 * Map a Supabase Auth error to a translation key.
 * See https://supabase.com/docs/guides/auth/debugging/error-codes
 */
export function authErrorKey(error: AuthError, withInvite = false) {
  const code = isAuthApiError(error) ? error.code : undefined;
  // The sign-up hook turned the invite down (used, expired or cancelled).
  if (withInvite && /invite_(invalid|required)/.test(error.message)) return 'auth.invite.invalid' as const;
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
