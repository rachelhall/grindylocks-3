import * as Sentry from '@sentry/react-native';

import { env } from './env';

/**
 * Crash reporting. Off until EXPO_PUBLIC_SENTRY_DSN is set, so local
 * development doesn't send anything. No session replay or user PII: the app
 * holds location-adjacent data (home parks, regulars), and the privacy policy
 * should be able to say crash reports carry none of it.
 */
export function initSentry() {
  Sentry.init({
    dsn: env.sentryDsn,
    enabled: Boolean(env.sentryDsn),
    sendDefaultPii: false,
    environment: __DEV__ ? 'development' : 'production',
    tracesSampleRate: __DEV__ ? 1.0 : 0.1,
  });
}

export { Sentry };
