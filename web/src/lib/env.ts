/**
 * Public config. NEXT_PUBLIC_ values are inlined into the browser bundle, so
 * only the Supabase URL and publishable key belong here (row-level security
 * protects the data). There is no service-role key in the web admin, ever.
 */
function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing ${name}. Copy web/.env.example to web/.env.local and fill it in.`);
  }
  return value;
}

// Each variable is read by its full name so Next can inline it.
export const env = {
  supabaseUrl: required("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL),
  supabasePublishableKey: required(
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  ),
};
