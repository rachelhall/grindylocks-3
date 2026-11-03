import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * app.json holds the config; this only adds values that come from the
 * environment (EAS environment variables or a local .env), so they stay out
 * of the repo.
 *
 * GOOGLE_MAPS_ANDROID_API_KEY: Android's map tiles come from Google Maps,
 * which needs a key (restricted to com.grindylocks.app). iOS uses Apple Maps
 * and needs nothing.
 *
 * GOOGLE_SERVICES_JSON: Firebase's google-services.json, which Android needs
 * for push (FCM). Cloud builds get it from the EAS file variable of that
 * name; local builds (`eas build --local`, `expo run:android`) use the
 * git-ignored copy at the repo root. Without either, Android builds still
 * work but can't get push tokens.
 */
// app.config runs in Node, but the app's tsconfig has no Node types.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { existsSync } = require('fs') as { existsSync: (path: string) => boolean };

const googleServicesFile =
  process.env.GOOGLE_SERVICES_JSON ?? (existsSync('./google-services.json') ? './google-services.json' : undefined);

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...(config as ExpoConfig),
  android: {
    ...config.android,
    ...(googleServicesFile ? { googleServicesFile } : {}),
  },
  plugins: [
    ...(config.plugins ?? []),
    ['react-native-maps', { androidGoogleMapsApiKey: process.env.GOOGLE_MAPS_ANDROID_API_KEY }],
  ],
});
