import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * app.json holds the config; this only adds values that come from the
 * environment (EAS environment variables or a local .env), so they stay out
 * of the repo.
 *
 * GOOGLE_MAPS_ANDROID_API_KEY: Android's map tiles come from Google Maps,
 * which needs a key (restricted to com.grindylocks.app). iOS uses Apple Maps
 * and needs nothing.
 */
export default ({ config }: ConfigContext): ExpoConfig => ({
  ...(config as ExpoConfig),
  plugins: [
    ...(config.plugins ?? []),
    ['react-native-maps', { androidGoogleMapsApiKey: process.env.GOOGLE_MAPS_ANDROID_API_KEY }],
  ],
});
