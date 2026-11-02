# Grindylocks

Skate park directory and social app for bladers, quad skaters and skateboarders. iOS and Android, built with Expo (SDK 57) and Supabase.

Product context lives in the Grindylocks Claude project (Project Brief, Roadmap, Product Decisions). Visual rules live in the Grindylocks design system.

## Setup

```sh
npm install
cp .env.example .env   # public Supabase URL and publishable key are pre-filled
```

## Running the app

The app runs as a **development build**, not in Expo Go: uploads, video compression, Google sign-in and native crash reporting all need native modules Expo Go doesn't have.

Build and install the dev build once, then rebuild only when you add a package with native code or change `app.json`:

```sh
npm run ios       # builds with Xcode, installs on the simulator or a plugged-in iPhone
npm run android   # builds with Android Studio's SDK, installs on an emulator or device
# or build in the cloud instead:
npx eas-cli@latest build --profile development --platform ios
```

Day to day, just start the dev server and open the installed app:

```sh
npm start
```

## Real iPhone and TestFlight

Both need the Apple Developer Program; EAS creates the certificates and profiles on the first build.

**Development build on your phone:** register the phone once (`npx eas-cli@latest device:create`, then open the link on the phone and install the profile), turn on Developer Mode (Settings › Privacy & Security), then build with `--profile development` and install from the build page. `npm start` serves the JS as usual; the phone needs to be on the same Wi-Fi. Registering another phone means a new development build.

**TestFlight:** the `production` profile builds in the cloud, where `.env` isn't uploaded (it's git-ignored), so every `EXPO_PUBLIC_` value must also be an EAS environment variable in the `production` environment, plus `SENTRY_AUTH_TOKEN` (sensitive) for source maps. Then:

```sh
npx eas-cli@latest build --profile production --platform ios --auto-submit
```

The first run asks for your Apple ID and creates the app in App Store Connect. `usesNonExemptEncryption` is false in `app.json`, so builds skip the export compliance question. Add testers under TestFlight in App Store Connect; internal testers need no review.

## Checks

```sh
npm run typecheck
npm run lint
npm run check:i18n   # es, da and de have exactly the keys en has
npx expo-doctor
```

## Maps and video

- **iOS** maps use Apple Maps; nothing to set up.
- **Android** maps need a Google Maps key: set `GOOGLE_MAPS_ANDROID_API_KEY` as an EAS environment variable (read by `app.config.ts`), then make a new development build.
- **Clips** upload to Cloudflare Stream through the Edge Functions in `supabase/functions` (see `supabase/README.md` for their secrets). To play them, set `EXPO_PUBLIC_CLOUDFLARE_STREAM_CUSTOMER_CODE` in `.env`.

## Layout

```
src/
  app/            Expo Router screens (every file is a route)
    (auth)/       welcome, email sign-in and the invite screen
    (onboarding)/ age, username, city, regulars notice
    (app)/        the signed-in app: (tabs)/ (home, map, messages, search, you),
                  new-post, post/[id], park/[slug]/ (the park page and its photos),
                  profile/[username], edit-profile, say-hi, invites, notifications,
                  settings/ (index, email, credits, blocked)
  i18n/           i18next setup; locales/en.json is the source of truth
  lib/
    media.ts      picking, compressing and showing photos and clips
    uploads.ts    the persisted background upload queue; createPost()
    parks.ts      park directory data; hours.ts is open-now and sunrise/sunset
    profiles.ts   profiles, the posts grid, profile photos, Edit profile and Settings saves
    username.ts   the live free/taken username check (onboarding and Edit profile)
    social.ts     invites, following (and requests) and blocking
    engagement.ts likes (hidden), comments and notifications
    query.ts      TanStack Query client, cache keys and freshness
    config.ts     support email and privacy policy URL (placeholders for now)
    park-photos.ts  park photos: gallery reads, uploads, reorder and remove
    supabase.ts   Supabase client, session encrypted with a SecureStore key
    database.types.ts  generated; refresh with `npm run db:types` after migrations,
                       then put back the `| null`s the generator drops: search_people's follow_status,
                       home_metro_name and home_park_name; avatar_path on my_blocked_accounts and
                       my_follow_requests; my_invites' used_at and used_by_username; redeem_my_invite's return;
                       post_comments' author_id, username, avatar_path, body, parent_id and reply_to_username;
                       my_notifications' comment_body, comment_id, post_id, park_slug, park_name and metro_name
    posts.ts      feeds, post detail, profile Tagged/Filmed tabs, regulars, tagging and post edits
    post-draft.tsx  the New post flow's shared draft (media, park, per-slide tags, caption)
    env.ts        public EXPO_PUBLIC_ config
    sentry.ts     crash reporting (off until EXPO_PUBLIC_SENTRY_DSN is set)
  theme/          design system tokens and the <Text> component
locales/          translated iOS permission prompts (es, da, de)
supabase/         migrations from Nov 1 on, and Edge Functions
```

## Conventions

- **Theme:** use semantic colors from `useColors()` (`surface`, `text`, `accent`…), never raw hex. No rounded corners, no shadows; depth is a 2px `border` outline. Tappable things are at least 48px.
- **Text:** use `<Text variant="...">` from `@/theme`; display styles and labels are uppercased automatically.
- **Translations:** every user-facing string goes through `t()`. Add the key to `en.json` first, then the other three. Trick names are never translated; captions and comments stay as written.
- **Units:** store metric, display by locale (`usesMetric()`).
- **Secrets:** only public values go in `EXPO_PUBLIC_` variables. The service-role key never ships in the app.
- **Packages:** install with `npx expo install` so versions match the SDK.
