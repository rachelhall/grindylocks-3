import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import type { Database } from "@/lib/database.types";
import { env } from "@/lib/env";

/**
 * A Supabase client for Server Components and Server Functions, signed in as
 * whoever's cookies came with the request. Create one per request; never
 * share one between requests.
 *
 * Server Components can't write cookies, so a token refresh there is
 * dropped; that's fine, because the proxy (src/proxy.ts) refreshes the
 * session before the page renders. Server Functions can write them.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(env.supabaseUrl, env.supabasePublishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
        } catch {
          // Called from a Server Component: the proxy handles the refresh.
        }
      },
    },
  });
}
