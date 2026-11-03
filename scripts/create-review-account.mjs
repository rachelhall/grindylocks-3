#!/usr/bin/env node
// Creates the App Review demo account (review@grindylocks.com), once.
//
// The before_user_created hook only lets accounts in with an invite, so make
// one in the app first (You → Invites) and pass its code:
//
//   read -s SUPABASE_SECRET_KEY && export SUPABASE_SECRET_KEY
//   node scripts/create-review-account.mjs ABCD-2345
//
// SUPABASE_SECRET_KEY is the project's secret key (Project Settings → API
// Keys). `read -s` keeps it out of your shell history; it's never saved.
//
// Then sign in as review@grindylocks.com in the app with the fixed code
// (the REVIEW_CODE secret of the review-sign-in function) and finish
// onboarding, so the reviewer lands in the app. If a reviewer deletes the
// account, run this again with a new invite.
import { createClient } from '@supabase/supabase-js';

const EMAIL = 'review@grindylocks.com';
const URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? 'https://ytfdgacofenkehnbbhsc.supabase.co';
const key = process.env.SUPABASE_SECRET_KEY;
const invite = (process.argv[2] ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

if (!key) {
  console.error('Set SUPABASE_SECRET_KEY first (see the top of this file).');
  process.exit(1);
}
if (invite.length !== 8) {
  console.error('Pass an unused invite code, e.g. node scripts/create-review-account.mjs ABCD-2345');
  process.exit(1);
}

const admin = createClient(URL, key, { auth: { persistSession: false, autoRefreshToken: false } });

const { data, error } = await admin.auth.admin.createUser({
  email: EMAIL,
  email_confirm: true,
  user_metadata: { invite_code: invite },
});

if (error) {
  if (/already|exists|registered/i.test(error.message)) {
    console.log(`${EMAIL} already has an account. Nothing to do.`);
    process.exit(0);
  }
  console.error(`Couldn't create ${EMAIL}: ${error.message}`);
  process.exit(1);
}

console.log(`Created ${EMAIL} (${data.user.id}) with invite ${invite}.`);
console.log('Next: sign in as that address in the app with the fixed code and finish onboarding.');
