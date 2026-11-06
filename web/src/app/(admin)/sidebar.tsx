import { Suspense } from "react";

import { Button } from "@/components/ui/button";
import { Wordmark } from "@/components/wordmark";
import { countNotInvited, isOwner } from "@/lib/access-requests";
import { getViewer, roleLabel, type Viewer } from "@/lib/admin";
import { countFlaggedPages } from "@/lib/brands";
import { teamRoleLabel } from "@/lib/page-sections";
import { countQueue } from "@/lib/queue";

import { signOut } from "../sign-in/actions";
import { NavLink } from "./nav-link";
import { PagesNav } from "./pages-nav";

/**
 * The sidebar from design/web.md: wordmark with the ADMIN tape (PAGES for
 * people who only run pages, Nov 6), one item per
 * section that exists (Queue, with a count of what's waiting; Parks and Roles
 * come later), and
 * the signed-in admin with Sign out at the bottom. Under 768px it's a top bar.
 * Requests (invite requests from grindylocks.com) shows for the owner only,
 * with the count of requests not yet invited, and so do Pages (every brand
 * and shop page with Rachel's page tools; no badge) and Page blocks, with
 * the count of flagged pages (more than 5 blocks in 7 days). Admin items show
 * only to role holders; Your pages shows to anyone on a page's team, admins
 * included (mockups: Web · admin with pages, Web · page details).
 */
export function Sidebar() {
  return (
    <aside
      className={[
        "flex shrink-0 flex-wrap items-center gap-x-6 gap-y-3 border-gl-border bg-gl-surface px-4 py-3",
        "border-b-2 md:sticky md:top-0 md:h-dvh md:w-sidebar md:flex-col md:flex-nowrap md:items-stretch md:gap-8 md:border-r-2 md:border-b-0 md:py-6",
      ].join(" ")}
    >
      <Suspense fallback={<Wordmark />}>
        <TapedWordmark />
      </Suspense>
      <nav
        aria-label="Main"
        className="order-last flex basis-full gap-1 overflow-x-auto md:order-none md:flex-1 md:basis-auto md:flex-col md:overflow-y-auto"
      >
        <Suspense fallback={null}>
          <AdminLinks />
        </Suspense>
        <Suspense fallback={null}>
          <YourPages />
        </Suspense>
      </nav>
      <Suspense fallback={<div className="ml-auto h-10 md:ml-0 md:h-[102px]" />}>
        <SignedIn />
      </Suspense>
    </aside>
  );
}

async function TapedWordmark() {
  const viewer = await getViewer();
  return <Wordmark tape={viewer && !viewer.admin ? "Pages" : "Admin"} />;
}

/** Queue (with how many things are waiting in the admin's scope), then the owner's own items. */
async function AdminLinks() {
  const viewer = await getViewer();
  if (!viewer?.admin) return null;
  const waiting = await countQueue();
  return (
    <>
      <NavLink href="/queue" icon="inbox" badge={waiting} badgeLabel="waiting">
        Queue
      </NavLink>
      {isOwner(viewer.admin) && <OwnerLinks />}
    </>
  );
}

async function YourPages() {
  const viewer = await getViewer();
  if (!viewer?.pages.length) return null;
  return (
    <PagesNav
      pages={viewer.pages.map((p) => ({
        handle: p.handle,
        name: p.name,
        roles: p.roles,
        role: p.role,
        city: p.city,
        logoPath: p.logoPath,
        inboxNew: p.inboxNew,
      }))}
    />
  );
}

async function OwnerLinks() {
  const [waiting, flagged] = await Promise.all([countNotInvited(), countFlaggedPages()]);

  return (
    <>
      <NavLink href="/requests" icon="person_add" badge={waiting} badgeLabel="not invited">
        Requests
      </NavLink>
      <NavLink href="/pages" icon="storefront">
        Pages
      </NavLink>
      <NavLink href="/page-blocks" icon="block" badge={flagged} badgeLabel={flagged === 1 ? "page flagged" : "pages flagged"}>
        Page blocks
      </NavLink>
    </>
  );
}

/** "manager at 8SET", "Owner of 8SET", "On 2 page teams". */
function teamLine(viewer: Viewer): string | null {
  const [first, ...rest] = viewer.pages;
  if (!first) return null;
  if (rest.length) return `On ${viewer.pages.length} page teams`;
  return first.role === "owner" ? `Owner of ${first.name}` : `${teamRoleLabel[first.role]} at ${first.name}`;
}

async function SignedIn() {
  const viewer = await getViewer();
  if (!viewer) return null;
  const { admin } = viewer;
  const name = viewer.username ? `@${viewer.username}` : "No username yet";
  const team = teamLine(viewer);

  return (
    <div className="ml-auto flex items-center gap-3 md:ml-0 md:flex-col md:items-stretch md:gap-2.5 md:border-t md:border-gl-border-subtle md:pt-4">
      <div className="flex items-center gap-2.5">
        <span
          aria-hidden="true"
          title={name}
          className="flex size-9 shrink-0 items-center justify-center bg-gl-text font-display text-base text-gl-accent"
        >
          {(viewer.username ?? "?").charAt(0).toUpperCase()}
        </span>
        <span className="sr-only flex min-w-0 flex-col items-start gap-1 sm:not-sr-only">
          <span className="max-w-full truncate type-body-sm font-semibold">{name}</span>
          {admin ? (
            <span className="type-caption text-gl-text-secondary">
              <span className="bg-gl-role px-1.5 py-px text-[11px] leading-[14px] font-semibold tracking-[0.06em] text-gl-on-role uppercase">
                {roleLabel[admin.role]}
              </span>
              {team && ` · ${team.charAt(0).toLowerCase()}${team.slice(1)}`}
            </span>
          ) : (
            <span className="type-caption text-gl-text-secondary">{team}</span>
          )}
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
