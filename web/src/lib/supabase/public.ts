import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/database.types";
import { env } from "@/lib/env";

/**
 * A signed-out Supabase client for the public marketing page. It never reads
 * or writes cookies, so a visitor who happens to be signed in to the admin
 * still asks as a stranger. With the publishable key, the only thing it can
 * do there is call `request_access()`.
 */
export function createPublicClient() {
  return createSupabaseClient<Database>(env.supabaseUrl, env.supabasePublishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
