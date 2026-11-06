import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

/** What a page card needs; PageSummary from lib/brands fits. */
export type PageCardPage = {
  name: string;
  handle: string;
  roles: string[];
  state: string;
  city: string | null;
  country: string | null;
  website: string | null;
  hasLogo: boolean;
  frozen: boolean;
  suspended: boolean;
  followers: number;
  team: { username: string | null; role: string }[];
};

const stampLabel: Record<string, string> = {
  unofficial: "UNOFFICIAL",
  name_only: "UNOFFICIAL",
  out_of_business: "RETIRED",
  closed: "CLOSED",
  inactive: "NO LONGER ACTIVE",
};

export function pageType(roles: string[]): string {
  if (roles.includes("shop")) return roles.includes("brand") ? "Shop and brand" : "Shop";
  return roles.includes("brand") ? "Brand" : "Organizer";
}

/**
 * The page's state stamp as the app draws it: OFFICIAL in pink tape (a
 * managed page with a logo), every other state as a paper outline.
 */
export function PageStamp({ state, hasLogo }: { state: string; hasLogo: boolean }) {
  const official = state === "managed" && hasLogo;
  return (
    <span
      className={cn(
        "inline-block -rotate-2 border-2 border-gl-border px-1.5 py-px text-[11px] leading-[14px] font-bold tracking-[0.08em]",
        official ? "bg-gl-accent text-gl-on-accent" : "bg-gl-surface",
      )}
    >
      {official ? "OFFICIAL" : (stampLabel[state] ?? (state === "managed" ? "MANAGED · NO LOGO" : state.toUpperCase()))}
    </span>
  );
}

/** The ink first-letter tile the app uses for pages without a logo. */
export function PageTile({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("flex size-9 shrink-0 items-center justify-center bg-gl-ink font-display text-base text-gl-paper", className)}
    >
      {name.charAt(0).toUpperCase()}
    </span>
  );
}

/** THE PAGE section of a pane: name, type and place, stamp, then the facts. */
export function PageCard({ page, children }: { page: PageCardPage; children?: React.ReactNode }) {
  const place = page.city ?? page.country;
  const rows: [string, React.ReactNode][] = [
    ["Handle", `@${page.handle}`],
    [
      "Website",
      page.website ? (
        <a
          href={/^https?:\/\//.test(page.website) ? page.website : `https://${page.website}`}
          target="_blank"
          rel="noreferrer"
          className="font-semibold text-gl-accent-text underline focus-ring"
        >
          {page.website.replace(/^https?:\/\//, "")}
        </a>
      ) : (
        <span className="text-gl-text-secondary">None listed</span>
      ),
    ],
    ["Followers", page.followers.toLocaleString("en-US")],
    [
      "Team",
      page.team.length ? (
        page.team.map((m) => `@${m.username ?? "deleted user"} (${m.role})`).join(", ")
      ) : (
        <span className="text-gl-text-secondary">Nobody yet</span>
      ),
    ],
  ];
  return (
    <div className="flex flex-col gap-3 border-2 border-gl-border bg-gl-surface-raised p-3">
      <div className="flex items-center gap-3">
        <PageTile name={page.name} />
        <div className="flex min-w-0 flex-col gap-1">
          <span className="type-body font-semibold">{page.name}</span>
          <span className="type-label text-gl-text-secondary">
            {[pageType(page.roles), place].filter(Boolean).join(" · ").toUpperCase()}
          </span>
        </div>
        <span className="ml-auto">
          <PageStamp state={page.state} hasLogo={page.hasLogo} />
        </span>
      </div>
      {(page.frozen || page.suspended) && (
        <WarningNote>
          {page.suspended ? "This page is suspended." : "This page is frozen while a dispute is open."}
        </WarningNote>
      )}
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 type-body-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-gl-text-secondary">{k}</dt>
            <dd className="min-w-0 break-words">{v}</dd>
          </div>
        ))}
      </dl>
      {children}
    </div>
  );
}

/**
 * A warning in the web admin: the `warning` token's outline and icon (it was
 * an ink outline until the token existed). The words carry the meaning; the
 * color only adds to it.
 */
export function WarningNote({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div role="note" className={cn("flex items-start gap-2.5 border-2 border-gl-warning p-3 type-body-sm", className)}>
      <Icon name="warning" className="mt-px shrink-0 text-gl-warning" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** A neutral note box (ink outline), for information that isn't a warning. */
export function InfoNote({ icon = "info", children }: { icon?: string; children: React.ReactNode }) {
  return (
    <div role="note" className="flex items-start gap-2.5 border-2 border-gl-border bg-gl-surface-raised p-3 type-body-sm">
      <Icon name={icon} className="mt-px shrink-0" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
