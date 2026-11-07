"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { PageLogo } from "@/components/page-logo";
import { Icon } from "@/components/ui/icon";
import {
  canUse,
  managePath,
  pageKindLine,
  type PageSection,
  SECTIONS,
  sectionsFor,
  firstSection,
  type TeamRole,
} from "@/lib/page-sections";
import { cn } from "@/lib/utils";

export type NavPage = {
  handle: string;
  name: string;
  roles: string[];
  role: TeamRole;
  city: string | null;
  logoPath: string | null;
  inboxNew: number;
};

/**
 * Your pages (mockups: Web · admin with pages, Web · page details): each page
 * the signed-in person is on the team of, with its sections under it. The
 * sections show under the page that's open, or under the only page.
 * Sections the person's role can't use show with a lock, as on the boards.
 */
export function PagesNav({ pages }: { pages: NavPage[] }) {
  const pathname = usePathname();
  const open = pathname.match(/^\/manage\/([^/]+)/)?.[1]?.toLowerCase() ?? null;

  return (
    <div className="flex flex-col gap-1 md:pt-4">
      <span className="hidden px-3 pb-1.5 type-label text-gl-text-secondary md:block">Your pages</span>
      {pages.map((page) => {
        const expanded = pages.length === 1 || page.handle.toLowerCase() === open;
        return (
          <div key={page.handle} className="flex flex-col gap-1 md:contents">
            <Link
              href={managePath(page.handle, firstSection(page.roles, page.role))}
              className="flex min-h-12 items-center gap-2.5 px-3 py-1 focus-ring hover:bg-gl-surface-raised"
            >
              <PageLogo name={page.name} path={page.logoPath} className="size-[26px] text-xs" />
              <span className="flex min-w-0 flex-col">
                <span className="truncate type-body-sm font-bold">{page.name}</span>
                <span className="hidden truncate type-caption text-gl-text-secondary md:block">
                  {pageKindLine(page.roles, page.city)}
                </span>
              </span>
            </Link>
            {expanded &&
              sectionsFor(page.roles).map((section) => (
                <SectionLink key={section} page={page} section={section} pathname={pathname} />
              ))}
          </div>
        );
      })}
    </div>
  );
}

function SectionLink({ page, section, pathname }: { page: NavPage; section: PageSection; pathname: string }) {
  const info = SECTIONS[section];
  const href = managePath(page.handle, section);
  const current = pathname.toLowerCase() === href.toLowerCase();
  const locked = !canUse(section, page.role);
  const row = "flex h-control shrink-0 items-center gap-2.5 pr-3 pl-3 type-body-sm font-medium whitespace-nowrap md:pl-[46px]";

  if (locked) {
    return (
      <span
        aria-disabled="true"
        title="Managers and the owner can change this"
        className={cn(row, "cursor-not-allowed text-gl-text-secondary")}
      >
        <Icon name={info.icon} size={18} />
        <span className="truncate">{info.label}</span>
        <Icon name="lock" size={16} className="ml-auto" />
        <span className="sr-only"> (managers and the owner)</span>
      </span>
    );
  }

  const badge = section === "inbox" ? page.inboxNew : 0;
  return (
    <Link
      href={href}
      aria-current={current ? "page" : undefined}
      className={cn(row, "focus-ring", current ? "bg-gl-accent text-gl-on-accent" : "text-gl-text hover:bg-gl-surface-raised")}
    >
      <Icon name={info.icon} size={18} />
      <span className="truncate">{info.label}</span>
      {!!badge && (
        <span className="ml-auto bg-gl-text px-[7px] py-0.5 text-xs leading-4 font-bold text-gl-surface tabular-nums">
          {badge}
          <span className="sr-only"> new</span>
        </span>
      )}
    </Link>
  );
}
