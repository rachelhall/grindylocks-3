import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { fetchAccessRequests, fetchRequestsSeenAt, isOwner } from "@/lib/access-requests";
import { getAdmin } from "@/lib/admin";

import { RequestsView } from "./requests-view";

export const metadata: Metadata = { title: "Requests" };

/**
 * Invite requests from the grindylocks.com form (mockup: Admin · access
 * requests). Owner only: city and park admins get a 404, and the table's
 * access rules would show them nothing anyway. No email goes out when someone
 * asks; the count on the sidebar item is the alert.
 */
export default async function RequestsPage() {
  const admin = await getAdmin();
  if (!isOwner(admin)) notFound();

  const [requests, seenAt] = await Promise.all([fetchAccessRequests(), fetchRequestsSeenAt(admin.id)]);

  return (
    <main className="flex flex-1 flex-col">
      <header className="flex flex-col gap-1 px-6 pt-6">
        <h1 className="type-title">Requests</h1>
        <p className="type-body-sm text-gl-text-secondary">
          People who asked for an invite on grindylocks.com. Only you can see this page.
        </p>
      </header>
      <RequestsView requests={requests} seenAt={seenAt} />
    </main>
  );
}
