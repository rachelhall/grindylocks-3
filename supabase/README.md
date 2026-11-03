# Supabase

Project `grindylocks` (ref `ytfdgacofenkehnbbhsc`, us-east-1).

- `migrations/`: schema changes from Nov 1 on. The earlier ones
  (`initial_schema`, `access_rules`, `lock_trigger_functions`, `confirm_age`)
  were applied straight to the project and live in its migration history.
  Migrations are additive: new columns, tables, functions and policies;
  existing ones aren't dropped.
- `functions/`: Edge Functions (Deno). `_shared/stream.ts` is the only code
  that talks to Cloudflare Stream.
  - `stream-upload`: one-time Stream upload URL for a video slide (creates
    the slide row the first time).
  - `stream-status`: asks Stream where a clip is and saves it on the slide.
  - `stream-webhook`: Stream calls this when a clip is ready or fails.
    Deployed with JWT verification off; it checks Stream's signature.
  - `stream-token`: signed playback tokens (a few hours) for clips the
    caller can see. Every clip requires one (`requireSignedURLs`), the way
    post photos need signed URLs, so copied links stop working and private
    accounts' clips stay private. Without the signing key it answers
    `signed: false` and the app falls back to plain video IDs.
  - `stream-sign-existing`: one-off, owner only. Makes clips uploaded before
    signing was switched on require tokens. Delete it once it has run.
  - `push-send`: sends waiting push notifications through Expo's push
    service. The database pings it (pg_net); JWT verification is off
    because it only drains the queue. Needs no secrets.
  - `export-data`: "Get a copy of my data". Emails the member a JSON file
    from `export_my_data()` (once a day) through Resend. JWT verification on.
  - `delete-account`: runs `delete_my_account()` as the member, then removes
    their files and Stream clips and their sign-in. JWT verification on.
  - `review-sign-in`: App Review access. Lets the one demo address
    (`REVIEW_EMAIL`) sign in with a fixed code (`REVIEW_CODE`) instead of an
    emailed one; locks for an hour after 10 wrong codes. JWT verification
    off. See "App Review access" below.

## Secrets the functions need (Edge Functions → Secrets)

| Name | What |
| --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID |
| `CLOUDFLARE_STREAM_API_TOKEN` | API token with Stream: Edit |
| `CLOUDFLARE_STREAM_WEBHOOK_SECRET` | the `secret` returned when the Stream webhook is created |
| `STREAM_SIGNING_KEY_ID` | Stream signing key ID (`scripts/stream-signing-key.sh` sets both) |
| `STREAM_SIGNING_KEY_JWK` | the base64 `jwk` Stream returns with that key |
| `RESEND_API_KEY` | Resend API key, for export-data's email; the same Resend account as the auth emails |
| `REVIEW_EMAIL` | `review@grindylocks.com`, the App Review demo account (review-sign-in) |
| `REVIEW_CODE` | its fixed sign-in code, 10 digits (review-sign-in). Delete it to switch reviewer sign-in off; change it to rotate |

Until the Cloudflare ones are set the video functions answer 503
`video_not_configured` and the app says clip uploads aren't switched on yet. Photos don't need any of this.

The app also needs `EXPO_PUBLIC_CLOUDFLARE_STREAM_CUSTOMER_CODE` in `.env`
to play clips.

## Storage buckets

- `post-media` (private): post photos, `<user>/<post>/<slide>.jpg`.
- `avatars` (private): profile photos, `<user>/<random id>.jpg`, 512 px
  JPEG. Any signed-in member can read one unless either of you has blocked
  the other; only the owner can write in their folder. The app asks for
  signed URLs.

## Auth email templates (Authentication → Emails)

Sign-in and email changes both use 6-digit codes, never links, so every
template the app relies on must include `{{ .Token }}`:

- **Magic Link** (sign-in code): already in use.
- **Change Email Address** (Settings → Email): the app verifies with
  `verifyOtp({ type: 'email_change' })`. Suggested body:

  ```html
  <h2>Change your Grindylocks email</h2>
  <p>Enter this code in the app to switch your sign-in email to {{ .NewEmail }}:</p>
  <p style="font-size: 28px; letter-spacing: 6px"><strong>{{ .Token }}</strong></p>
  <p>If you didn't ask for this, ignore this email and nothing changes.</p>
  ```

If **Secure email change** is on (Authentication → Providers → Email), a
code goes to the current address too, and the change only happens once both
are entered. The app handles that (it asks for the second code), but each
code is sent with the same template, so the wording has to make sense for
both addresses.

## Invite-only sign-up (migration `invites_follows_blocks`)

New accounts need an invite code. The app sends it as user metadata when it
asks for a sign-in code; the **Before User Created** hook checks it and
claims it for that email. Existing members sign in as before.

Turn it on in this order, so there's never a moment when anyone can sign up:

1. Apply the migration.
2. **Authentication → Hooks → Before User Created**: add a Postgres hook,
   schema `public`, function `before_user_created`.
3. **Authentication → Sign In / Providers**: turn **Allow new users to sign
   up** back on. With the hook on, only someone with a valid, unclaimed
   invite gets an account.

The hook also refuses accounts added by hand with **Add user** in the
dashboard (they have no invite). To add a tester, make an invite in the app
(You → Invites) and send them the code instead.

Codes are claimed by the first email that signs up with them. If someone
starts with one email and never finishes, the code stays tied to that email:
cancel the link in the app (the invite comes back) and make a new one.

## Posting and feeds (migration `posting_feeds`)

Adds slide tag checks, `set_slide_tags()`, `remove_my_filmer_credit()`, the
feed functions (`feed_following`, `feed_nearby`, `obstacle_posts`,
`tagged_posts`, `filmed_posts`), `park_regulars_list()`, and a trigger that
takes a post's metro area from its park. Additive only.

1. Run `tests/posting_feeds_check.sql` in the SQL editor first. It applies the
   migration and runs the checks inside one transaction, then ends with an
   error that carries the results (`RESULTS [...]`), so nothing is kept. Every
   row should say `"ok": true`.
2. Apply the migration.
3. Regenerate the database types (`npm run db:types`) and put back the
   `| null`s the generator drops (listed in the main README).

Applied Nov 1 (as `posting_feeds`); types regenerated the same day.

## Likes, comments and notifications (migration `engagement`)

Adds comment checks (no editing, 1–1000 characters, valid replies),
erasing a deleted comment's text, the notification triggers
(comments, replies, @mentions, tags and filmer credit), `post_comments()`,
the `comment_count` and `liked_by_me` computed fields on posts,
`my_notifications()`, `notifications_unread()` and
`mark_notifications_seen()`. Additive only.

1. Run `tests/engagement_check.sql` in the SQL editor first (rolled back,
   like the posting check). Every row should say `"ok": true`.
2. Apply the migration.
3. Regenerate the database types and put back the `| null`s the generator
   drops (listed in the main README).

## Push notifications (migration `push`)

Adds pg_net, private tables for phones (`push_devices`), switches
(`push_settings`) and the outbox, triggers that queue a push for every new
notification and every "say hi" or visiting announcement (only for members
with a phone registered), `register_push_device()`,
`unregister_push_device()`, `my_push_settings()`, `set_push_setting()`,
and `push_claim()` / `push_done()` for the `push-send` function (service
role only). Additive only.

1. Run `tests/push_check.sql` first (rolled back). Every row should say
   `"ok": true`.
2. Apply the migration, then deploy `push-send` (JWT verification off).
   Apply before merging: the app calls the new functions as soon as it runs.
3. The sentences come from the app's translation files. After changing a
   `notifications.*` string, run `node scripts/build-push-strings.mjs` and
   redeploy `push-send` (`npm run check:i18n` fails until you do).

Where the database pings `push-send` lives in `private.push_config`.
Delivery on iOS goes through Expo, which needs the app's APNs key: EAS
creates one on the first build after `expo-notifications` is added (answer
yes when it asks to set up push notifications). Android needs FCM
credentials uploaded to EAS before Android pushes work.

## Roles and safety (migration `moderation`)

Adds moderation notices and the moderation log (`moderation_actions`),
`private.end_roles()`, member reports (`file_report()`, and
`report_park_info()` with an optional photo in the private `report-photos`
bucket), the moderation queue and report detail, `moderate_reports()`
(dismiss, keep hidden, warn, suspend 1/7/30 days, escalate, ban),
`review_park_info()`, `review_obstacle()`, `set_park_verified()`,
`my_restriction()`, and the members' own `delete_my_account()` and
`export_my_data()`. Additive only.

Checked with `tests/moderation_check.sql` (76 checks, rolled back) and
applied Nov 2.

The two account functions need deploying, from the repo root:

1. Set `RESEND_API_KEY` (Edge Functions → Secrets). Until it's set,
   `export-data` answers 503 `email_not_configured` without using up the
   member's daily export.
2. `supabase functions deploy export-data`
3. `supabase functions deploy delete-account`

Both keep JWT verification on (the caller is a signed-in member).

## App Review access (migration `review_sign_in`)

Apple's reviewers can't read our emailed codes, so the demo account
`review@grindylocks.com` signs in with a fixed code through the
`review-sign-in` function. The app knows the address (`src/lib/review-sign-in.ts`)
and, for it only, sends the typed code to the function instead of emailing
one. The function makes a real one-time code with the secret key and the app
signs in with it as usual, so the session is an ordinary code sign-in
(Delete account works too). Every other address is unchanged. The address
needs no mailbox: nothing is ever sent to it.

Setting it up:

1. Apply the migration (the lockout table and its two functions, service
   role only).
2. Set `REVIEW_EMAIL` and `REVIEW_CODE` (Edge Functions → Secrets).
3. `supabase functions deploy review-sign-in --no-verify-jwt`
4. Make an invite in the app, then create the account:
   `node scripts/create-review-account.mjs <invite code>` (see the script's
   header for the secret key).
5. Sign in as `review@grindylocks.com` with the fixed code and finish
   onboarding.

Switch it off by deleting `REVIEW_CODE` (the function answers 404
`not_enabled` and the app shows "wrong code"). Rotate by changing it, then
update App Store Connect. If a reviewer deletes the account, repeat steps 4
and 5.

Migration applied, secrets set and `review-sign-in` deployed Nov 3 (a wrong-code test answered 401 `wrong_code`).
