// POST /functions/v1/review-sign-in   { email, code }
//
// App Review access. Grindylocks has no passwords, and an Apple reviewer
// can't read the sign-in code we email. This lets one demo account sign in
// with a fixed code instead:
//
//   - REVIEW_EMAIL: the demo address (review@grindylocks.com)
//   - REVIEW_CODE:  the fixed code, digits only (10 recommended)
//
// Both live in Edge Functions › Secrets, never in the repo. Without either
// one the function answers 404 not_enabled, so deleting REVIEW_CODE turns
// reviewer sign-in off; changing it rotates the code.
//
// When the email and code match, it makes a one-time sign-in code for that
// account with the secret key (generateLink, which sends no email) and
// returns it. The app then signs in with the usual
// verifyOtp({ type: 'email' }), so the session is an ordinary code sign-in,
// the same as a member's (delete_my_account() accepts it, for example).
//
// It never creates an account: generateLink for an unknown address would
// have to get past the before_user_created invite check, and it only ever
// runs for REVIEW_EMAIL anyway. Every other address gets the same
// "wrong code" answer.
//
// After 10 wrong codes in an hour it stops checking for the rest of the hour
// (review_sign_in_locked(), migration review_sign_in).
//
// Deployed with JWT verification off: the caller isn't signed in yet.
//
// Replies { otp } or { error } with:
//   400 bad_request, 401 wrong_code, 404 not_enabled, 429 locked,
//   500 sign_in_failed.

import { adminClient, corsHeaders, json } from '../_shared/stream.ts';

const enc = new TextEncoder();

/** Compares two strings in constant time (for strings of the same length). */
async function sameSecret(a: string, b: string): Promise<boolean> {
  // Hash both so the comparison doesn't leak the length either.
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b)),
  ]);
  const x = new Uint8Array(ha);
  const y = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'bad_request' }, 400);

  const reviewEmail = Deno.env.get('REVIEW_EMAIL')?.trim().toLowerCase();
  const reviewCode = Deno.env.get('REVIEW_CODE')?.trim();
  if (!reviewEmail || !reviewCode) return json({ error: 'not_enabled' }, 404);

  let email = '';
  let code = '';
  try {
    const body = await req.json();
    email = String(body?.email ?? '').trim().toLowerCase();
    code = String(body?.code ?? '').replace(/\D/g, '');
  } catch {
    return json({ error: 'bad_request' }, 400);
  }
  if (!email || !code) return json({ error: 'bad_request' }, 400);

  const admin = adminClient();

  const { data: locked, error: lockError } = await admin.rpc('review_sign_in_locked');
  if (lockError) {
    console.error('review_sign_in_locked failed', lockError);
    return json({ error: 'sign_in_failed' }, 500);
  }
  if (locked) return json({ error: 'locked' }, 429);

  const emailOk = email === reviewEmail;
  const codeOk = await sameSecret(code, reviewCode);
  if (!emailOk || !codeOk) {
    const { error } = await admin.rpc('review_sign_in_failed');
    if (error) console.error('review_sign_in_failed failed', error);
    return json({ error: 'wrong_code' }, 401);
  }

  const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email: reviewEmail });
  const otp = data?.properties?.email_otp;
  if (error || !otp) {
    console.error('generateLink failed', error);
    return json({ error: 'sign_in_failed' }, 500);
  }

  return json({ otp });
});
