/**
 * App Review access. An Apple reviewer can't read the code we email, so one
 * demo address signs in with a fixed code instead, checked by the
 * review-sign-in Edge Function (see its header for the secrets, the lockout
 * and how to turn it off).
 *
 * For that address the sign-in screens don't email a code; the code typed in
 * goes to the function, which answers with a real one-time code, and the app
 * signs in with it the usual way. So the session is an ordinary code sign-in,
 * and Delete account works the same as for anyone.
 *
 * The address isn't a secret; the code is, and it lives only in the
 * function's secrets. Every other address signs in exactly as before.
 */
import { authErrorKey } from './auth-errors';
import { functionErrorCode } from './account';
import { supabase } from './supabase';

export const REVIEW_EMAIL = 'review@grindylocks.com';

export function isReviewEmail(email: string | null | undefined): boolean {
  return (email ?? '').trim().toLowerCase() === REVIEW_EMAIL;
}

type SignInErrorKey = ReturnType<typeof authErrorKey>;

/**
 * Signs the demo account in with its fixed code. Resolves to a translation
 * key for the error, or null once signed in.
 */
export async function reviewSignIn(code: string): Promise<SignInErrorKey | null> {
  const { data, error } = await supabase.functions.invoke<{ otp?: string }>('review-sign-in', {
    body: { email: REVIEW_EMAIL, code },
  });
  if (error) {
    switch (await functionErrorCode(error)) {
      // Switched off reads the same as a wrong code.
      case 'wrong_code':
      case 'not_enabled':
        return 'auth.code.wrong';
      case 'locked':
        return 'auth.email.rateLimited';
      case 'network':
        return 'errors.network';
      default:
        return 'errors.generic';
    }
  }
  if (!data?.otp) return 'errors.generic';

  const { error: verifyError } = await supabase.auth.verifyOtp({ email: REVIEW_EMAIL, token: data.otp, type: 'email' });
  return verifyError ? authErrorKey(verifyError) : null;
}
