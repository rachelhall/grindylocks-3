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

## Checks

```sh
npm run typecheck
npm run lint
npm run check:i18n   # es, da and de have exactly the keys en has
npx expo-doctor
```

## Layout

```
src/
  app/            Expo Router screens (every file is a route)
  i18n/           i18next setup; locales/en.json is the source of truth
  lib/
    supabase.ts   Supabase client, session encrypted with a SecureStore key
    database.types.ts  generated; refresh with `npm run db:types` after migrations
    env.ts        public EXPO_PUBLIC_ config
    sentry.ts     crash reporting (off until EXPO_PUBLIC_SENTRY_DSN is set)
  theme/          design system tokens and the <Text> component
```

## Conventions

- **Theme:** use semantic colors from `useColors()` (`surface`, `text`, `accent`…), never raw hex. No rounded corners, no shadows; depth is a 2px `border` outline. Tappable things are at least 48px.
- **Text:** use `<Text variant="...">` from `@/theme`; display styles and labels are uppercased automatically.
- **Translations:** every user-facing string goes through `t()`. Add the key to `en.json` first, then the other three. Trick names are never translated; captions and comments stay as written.
- **Units:** store metric, display by locale (`usesMetric()`).
- **Secrets:** only public values go in `EXPO_PUBLIC_` variables. The service-role key never ships in the app.
- **Packages:** install with `npx expo install` so versions match the SDK.
