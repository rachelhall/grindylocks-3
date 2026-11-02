import { type NextRequest, NextResponse } from "next/server";

import { updateSession } from "@/lib/supabase/proxy";

/**
 * Keeps the Supabase session fresh and sends signed-out visitors to sign-in.
 * Whether a signed-in person is an admin is checked when the page renders
 * (src/lib/admin.ts); Server Functions check again themselves.
 */
export async function proxy(request: NextRequest) {
  const { response, signedIn, withSession } = await updateSession(request);
  const { pathname, searchParams } = request.nextUrl;
  const onSignIn = pathname === "/sign-in";

  if (!signedIn && !onSignIn) {
    const url = request.nextUrl.clone();
    url.pathname = "/sign-in";
    url.search = "";
    return withSession(NextResponse.redirect(url));
  }

  // Already signed in: skip the form. A `reason` means the queue sent them
  // back (not an admin), so let the page explain instead of looping.
  if (signedIn && onSignIn && !searchParams.has("reason")) {
    const url = request.nextUrl.clone();
    url.pathname = "/queue";
    url.search = "";
    return withSession(NextResponse.redirect(url));
  }

  return response;
}

export const config = {
  // Everything except Next's own files and static assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)"],
};
