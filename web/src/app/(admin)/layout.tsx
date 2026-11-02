import { redirect } from "next/navigation";
import { Suspense } from "react";

import { getAdmin } from "@/lib/admin";

import { Sidebar } from "./sidebar";

/**
 * Everything behind sign-in: the sidebar (a top bar under 768px) beside the
 * page. The frame prerenders; the admin check and the signed-in person
 * stream in behind Suspense, as Cache Components requires for cookie reads.
 */
export default function AdminLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Suspense fallback={<PageFallback />}>
          <RequireAdmin>{children}</RequireAdmin>
        </Suspense>
      </div>
    </div>
  );
}

/**
 * Only role holders see admin pages. The proxy already sent signed-out
 * visitors to sign-in, so anyone left without a role is a member: send them
 * back with a note. This guards rendering only; every read and write still
 * goes through the database's access rules with the admin's own session.
 */
async function RequireAdmin({ children }: { children: React.ReactNode }) {
  const admin = await getAdmin();
  if (!admin) redirect("/sign-in?reason=not-admin");
  return children;
}

function PageFallback() {
  return <div aria-busy="true" className="flex-1" />;
}
