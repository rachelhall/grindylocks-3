import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

import type { Database } from "@/lib/database.types";
import { env } from "@/lib/env";

/**
 * Refresh the Supabase session on every request and report whether someone is
 * signed in. Any refreshed cookies (and the no-cache headers that come with
 * them) are copied onto whatever response the proxy returns.
 *
 * This is only the optimistic check: whether that person holds an admin role
 * is checked on the server when the page renders (src/lib/admin.ts), and the
 * database's access rules apply to every read and write regardless.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const pending: { cookies: Parameters<typeof response.cookies.set>[]; headers: Record<string, string> } = {
    cookies: [],
    headers: {},
  };

  const supabase = createServerClient<Database>(env.supabaseUrl, env.supabasePublishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
          pending.cookies.push([name, value, options]);
        }
        for (const [key, value] of Object.entries(headers)) {
          response.headers.set(key, value);
          pending.headers[key] = value;
        }
      },
    },
  });

  // Don't put code between creating the client and getClaims(): this is the
  // call that refreshes an expired session.
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims?.sub);

  /** Carry the refreshed cookies over to a redirect instead of `next()`. */
  function withSession(res: NextResponse) {
    for (const args of pending.cookies) res.cookies.set(...args);
    for (const [key, value] of Object.entries(pending.headers)) res.headers.set(key, value);
    return res;
  }

  return { response, signedIn, withSession };
}
