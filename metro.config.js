// Sentry's Metro config wraps Expo's default and adds debug IDs to bundles,
// so crash reports map back to the original TypeScript.
const { getSentryExpoConfig } = require('@sentry/react-native/metro');

module.exports = getSentryExpoConfig(__dirname);
