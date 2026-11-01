/**
 * Public, client-side config. Everything here ships inside the app bundle, so
 * only values that are safe to expose belong here: the Supabase URL and
 * publishable key (row-level security protects the data) and the Sentry DSN.
 * Never put a service-role key or other secret in an EXPO_PUBLIC_ variable.
 */
function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing ${name}. Copy .env.example to .env and fill it in.`);
  }
  return value;
}

export const env = {
  supabaseUrl: required('EXPO_PUBLIC_SUPABASE_URL', process.env.EXPO_PUBLIC_SUPABASE_URL),
  supabasePublishableKey: required(
    'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  ),
  /** Optional: Sentry stays off until a DSN is set. */
  sentryDsn: process.env.EXPO_PUBLIC_SENTRY_DSN || undefined,
  /**
   * Optional: the Cloudflare Stream customer code (the part after
   * "customer-" in Stream's playback URLs). Clips don't play until it's set.
   */
  streamCustomerCode: process.env.EXPO_PUBLIC_CLOUDFLARE_STREAM_CUSTOMER_CODE || undefined,
};
