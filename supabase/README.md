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

## Secrets the functions need (Edge Functions → Secrets)

| Name | What |
| --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID |
| `CLOUDFLARE_STREAM_API_TOKEN` | API token with Stream: Edit |
| `CLOUDFLARE_STREAM_WEBHOOK_SECRET` | the `secret` returned when the Stream webhook is created |

Until these are set the functions answer 503 `video_not_configured` and the
app says clip uploads aren't switched on yet. Photos don't need any of this.

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
