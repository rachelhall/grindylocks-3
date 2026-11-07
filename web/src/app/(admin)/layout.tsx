import { redirect } from "next/navigation";
import { Suspense } from "react";

import { getViewer } from "@/lib/admin";

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
          <RequireViewer>{children}</RequireViewer>
        </Suspense>
      </div>
    </div>
  );
}

/**
 * Role holders and page teams get in (Nov 6). The proxy already sent
 * signed-out visitors to sign-in, so anyone left is a member with neither:
 * sign them out and explain. Admin pages check the role again themselves,
 * and page sections check the person's place on that page's team. This
 * guards rendering only; every read and write still goes through the
 * database's access rules with the person's own session.
 */
async function RequireViewer({ children }: { children: React.ReactNode }) {
  const viewer = await getViewer();
  if (!viewer) redirect("/sign-out?reason=no-access");
  return children;
}

function PageFallback() {
  return <div aria-busy="true" className="flex-1" />;
}
