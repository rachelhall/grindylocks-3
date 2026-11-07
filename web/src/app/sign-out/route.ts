import { type NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

/**
 * Signs out and goes to sign-in. The admin layout sends signed-in members
 * with nothing to run here (no admin role, no page team) through this, since
 * a page can't clear cookies while it renders; sign-in then says why.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "local" });
  const url = request.nextUrl.clone();
  url.pathname = "/sign-in";
  url.search = request.nextUrl.searchParams.get("reason") === "no-access" ? "?reason=no-access" : "";
  return NextResponse.redirect(url);
}
