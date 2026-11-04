import { Suspense } from "react";

import { Button } from "@/components/ui/button";
import { Wordmark } from "@/components/wordmark";
import { countNotInvited, isOwner } from "@/lib/access-requests";
import { getAdmin, roleLabel } from "@/lib/admin";
import { countFlaggedPages } from "@/lib/brands";
import { countQueue } from "@/lib/queue";

import { signOut } from "../sign-in/actions";
import { NavLink } from "./nav-link";

/**
 * The sidebar from design/web.md: wordmark with the ADMIN tape, one item per
 * section that exists (Queue, with a count of what's waiting; Parks and Roles
 * come later), and
 * the signed-in admin with Sign out at the bottom. Under 768px it's a top bar.
 * Requests (invite requests from grindylocks.com) shows for the owner only,
 * with the count of requests not yet invited, and so does Page blocks, with
 * the count of flagged pages (more than 5 blocks in 7 days).
 */
export function Sidebar() {
  return (
    <aside
      className={[
        "flex shrink-0 flex-wrap items-center gap-x-6 gap-y-3 border-gl-border bg-gl-surface px-4 py-3",
        "border-b-2 md:sticky md:top-0 md:h-dvh md:w-sidebar md:flex-col md:flex-nowrap md:items-stretch md:gap-8 md:border-r-2 md:border-b-0 md:py-6",
      ].join(" ")}
    >
      <Wordmark />
      <nav aria-label="Admin" className="order-last flex basis-full gap-1 md:order-none md:flex-1 md:basis-auto md:flex-col">
        <Suspense
          fallback={
            <NavLink href="/queue" icon="inbox">
              Queue
            </NavLink>
          }
        >
          <QueueLink />
        </Suspense>
        <Suspense fallback={null}>
          <OwnerLinks />
        </Suspense>
      </nav>
      <Suspense fallback={<div className="ml-auto h-10 md:ml-0 md:h-[102px]" />}>
        <SignedIn />
      </Suspense>
    </aside>
  );
}

/** Queue, with how many things are waiting in the admin's scope. */
async function QueueLink() {
  const waiting = (await getAdmin()) ? await countQueue() : 0;
  return (
    <NavLink href="/queue" icon="inbox" badge={waiting} badgeLabel="waiting">
      Queue
    </NavLink>
  );
}

async function OwnerLinks() {
  if (!isOwner(await getAdmin())) return null;
  const [waiting, flagged] = await Promise.all([countNotInvited(), countFlaggedPages()]);

  return (
    <>
      <NavLink href="/requests" icon="person_add" badge={waiting} badgeLabel="not invited">
        Requests
      </NavLink>
      <NavLink href="/page-blocks" icon="block" badge={flagged} badgeLabel={flagged === 1 ? "page flagged" : "pages flagged"}>
        Page blocks
      </NavLink>
    </>
  );
}

async function SignedIn() {
  const admin = await getAdmin();
  if (!admin) return null;
  const name = admin.username ? `@${admin.username}` : "No username yet";

  return (
    <div className="ml-auto flex items-center gap-3 md:ml-0 md:flex-col md:items-stretch md:gap-2.5 md:border-t md:border-gl-border-subtle md:pt-4">
      <div className="flex items-center gap-2.5">
        <span
          aria-hidden="true"
          title={name}
          className="flex size-9 shrink-0 items-center justify-center bg-gl-text font-display text-base text-gl-accent"
        >
          {(admin.username ?? "?").charAt(0).toUpperCase()}
        </span>
        <span className="sr-only flex min-w-0 flex-col items-start gap-1 sm:not-sr-only">
          <span className="max-w-full truncate type-body-sm font-semibold">{name}</span>
          <span className="bg-gl-role px-1.5 py-px text-[11px] leading-[14px] font-semibold tracking-[0.06em] text-gl-on-role uppercase">
            {roleLabel[admin.role]}
          </span>
        </span>
      </div>
      <form action={signOut}>
        <Button type="submit" variant="outline" className="w-full justify-start">
          Sign out
        </Button>
      </form>
    </div>
  );
}
