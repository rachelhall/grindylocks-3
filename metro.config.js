// Sentry's Metro config wraps Expo's default and adds debug IDs to bundles,
// so crash reports map back to the original TypeScript.
const path = require('node:path');

const { getSentryExpoConfig } = require('@sentry/react-native/metro');

const config = getSentryExpoConfig(__dirname);

// The web admin in web/ is its own npm project (Next.js). Keep Metro from
// crawling it or its node_modules.
const webAdmin = new RegExp(`^${path.join(__dirname, 'web').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(/.*)?$`);
const existing = config.resolver.blockList;
config.resolver.blockList = [...(Array.isArray(existing) ? existing : existing ? [existing] : []), webAdmin];

module.exports = config;
