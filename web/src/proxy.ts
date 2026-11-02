import { type NextRequest, NextResponse } from "next/server";

import { ADMIN_ORIGIN, isMarketingHost, isWwwHost, MARKETING_HOST, SITE_PATH } from "@/lib/hosts";
import { updateSession } from "@/lib/supabase/proxy";

/**
 * Two jobs:
 * - On grindylocks.com, serve the public marketing page at `/` and send
 *   anything else to the admin's own domain. No session is touched there.
 * - Everywhere else (the admin): keep the Supabase session fresh and send
 *   signed-out visitors to sign-in. Whether a signed-in person is an admin is
 *   checked when the page renders (src/lib/admin.ts); Server Functions check
 *   again themselves.
 */
export async function proxy(request: NextRequest) {
  const host = request.headers.get("host");
  const { pathname, search, searchParams } = request.nextUrl;

  if (isMarketingHost(host)) {
    // www → the bare domain, path and all.
    if (isWwwHost(host)) {
      return NextResponse.redirect(`https://${MARKETING_HOST}${pathname}${search}`, 308);
    }
    if (pathname === "/") {
      const url = request.nextUrl.clone();
      url.pathname = SITE_PATH;
      return NextResponse.rewrite(url);
    }
    // The page's own address inside the app: show it at `/` instead.
    if (pathname === SITE_PATH) {
      return NextResponse.redirect(`https://${MARKETING_HOST}/${search}`, 308);
    }
    // Admin paths (sign-in, queue, …) live on the admin's domain.
    return NextResponse.redirect(`${ADMIN_ORIGIN}${pathname}${search}`, 307);
  }

  // The marketing page is public on admin hosts too, for previews.
  if (pathname === SITE_PATH) return NextResponse.next();

  const { response, signedIn, withSession } = await updateSession(request);
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
