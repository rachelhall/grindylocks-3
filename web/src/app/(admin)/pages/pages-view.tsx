"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { PageStamp, PageTile, pageType, WarningNote } from "@/components/page-card";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { inTab, type PageRow, type PageTab } from "@/lib/page-tabs";
import type { PageDetail } from "@/lib/pages-admin";
import { cn } from "@/lib/utils";

import { historyLine } from "./history";
import { type Tool, ToolDialogs } from "./tools";

const TAB_LABEL: Record<PageTab, string> = {
  all: "All",
  managed: "Managed",
  unofficial: "Unofficial",
  suspended: "Suspended",
  archived: "Archived",
};

function typingOrDialog(event: KeyboardEvent): boolean {
  const el = event.target as HTMLElement | null;
  if (event.metaKey || event.ctrlKey || event.altKey) return true;
  if (el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName))) return true;
  return !!document.querySelector('[role="dialog"], [role="alertdialog"]');
}

/** "Nov 4". In UTC, so the server and the browser render the same text. */
export function day(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export function years(founded: string | null, ended: string | null): string | null {
  return founded || ended ? [founded, ended].filter(Boolean).join("–") : null;
}

/** What the State column says under the stamp. */
function stateNote(p: PageRow): string | null {
  if (p.suspendedAt) return `Since ${day(p.suspendedAt)}`;
  if (p.frozen) return "Frozen: dispute open";
  if (p.state === "out_of_business") return years(p.foundedLabel, p.endedLabel);
  if (p.state === "closed" && p.closedAt) return `Closed ${day(p.closedAt)}`;
  if (p.openClaims) return `${p.openClaims} open ${p.openClaims === 1 ? "claim" : "claims"}`;
  if (p.state === "managed" && !p.hasLogo) return "No logo yet";
  return null;
}

/**
 * The Pages list and pane (mockup: Admin-Pages). Search by name, handle and
 * old names; a type filter; All, Managed, Unofficial, Suspended and Archived.
 * The pane shows the page, its six tools and its History.
 */
export function PagesView({
  pages,
  q,
  kind,
  tab,
  openId,
  detail,
  detailMissing,
}: {
  pages: PageRow[];
  q: string;
  kind: "brand" | "shop" | null;
  tab: PageTab;
  openId: string | null;
  detail: PageDetail | null;
  detailMissing: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const rowRefs = useRef(new Map<string, HTMLAnchorElement>());
  const [query, setQuery] = useState(q);
  const [toast, setToast] = useState<string | null>(null);

  const href = useCallback(
    (next: { q?: string; kind?: string | null; tab?: PageTab; page?: string | null }) => {
      const p = new URLSearchParams();
      const nq = next.q ?? q;
      if (nq) p.set("q", nq);
      const k = next.kind === undefined ? kind : next.kind;
      if (k) p.set("type", k);
      const t = next.tab ?? tab;
      if (t !== "all") p.set("tab", t);
      const pg = next.page === undefined ? openId : next.page;
      if (pg) p.set("page", pg);
      const qs = p.toString();
      return qs ? `${pathname}?${qs}` : pathname;
    },
    [pathname, q, kind, tab, openId],
  );

  // Search as you type, a beat after the last key.
  useEffect(() => {
    if (query === q) return;
    const timer = setTimeout(() => router.replace(href({ q: query.trim(), page: null }), { scroll: false }), 250);
    return () => clearTimeout(timer);
  }, [query, q, router, href]);

  const counts = useMemo(
    () => Object.fromEntries((Object.keys(TAB_LABEL) as PageTab[]).map((t) => [t, pages.filter((p) => inTab(p, t)).length])),
    [pages],
  ) as Record<PageTab, number>;
  const rows = useMemo(() => pages.filter((p) => inTab(p, tab)), [pages, tab]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (typingOrDialog(event)) return;
      if (event.key === "Escape" && openId) {
        event.preventDefault();
        router.push(href({ page: null }), { scroll: false });
        return;
      }
      if (event.key === "/") {
        event.preventDefault();
        document.getElementById("pages-search")?.focus();
        return;
      }
      if (event.key !== "j" && event.key !== "k") return;
      if (!rows.length) return;
      event.preventDefault();
      const focused = [...rowRefs.current.entries()].find(([, el]) => el === document.activeElement)?.[0];
      const from = rows.findIndex((p) => p.id === (focused ?? openId));
      const to = from === -1 ? 0 : Math.min(rows.length - 1, Math.max(0, from + (event.key === "j" ? 1 : -1)));
      rowRefs.current.get(rows[to].id)?.focus();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rows, openId, router, href]);

  return (
    <>
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3 px-6 pt-4">
        <div className="flex min-w-60 flex-1 flex-col gap-1.5">
          <label htmlFor="pages-search" className="type-label text-gl-text-secondary">
            Search pages
          </label>
          <div className="flex h-control items-center border-2 border-gl-border bg-gl-surface-sunk focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-gl-focus">
            <Icon name="search" className="ml-2.5 text-gl-text-secondary" />
            <input
              id="pages-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Name, @handle or an old name"
              autoComplete="off"
              className="h-full min-w-0 flex-1 bg-transparent px-2.5 type-body-sm text-gl-text outline-none placeholder:text-gl-text-secondary"
            />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="pages-type" className="type-label text-gl-text-secondary">
            Type
          </label>
          <select
            id="pages-type"
            value={kind ?? ""}
            onChange={(e) => router.replace(href({ kind: e.target.value || null, page: null }), { scroll: false })}
            className="h-control min-w-44 border-2 border-gl-border bg-gl-surface-sunk px-2.5 type-body-sm text-gl-text focus-ring"
          >
            <option value="">Brands and shops</option>
            <option value="brand">Brands</option>
            <option value="shop">Shops</option>
          </select>
        </div>
      </div>

      <nav aria-label="Which pages" className="mt-4 flex gap-6 overflow-x-auto border-b-2 border-gl-border px-6">
        {(Object.keys(TAB_LABEL) as PageTab[]).map((t) => (
          <Link
            key={t}
            href={href({ tab: t, page: null })}
            scroll={false}
            aria-current={tab === t ? "page" : undefined}
            className={cn(
              "-mx-1 -mb-0.5 flex h-control shrink-0 items-center border-b-[3px] px-1 type-body-sm font-medium no-underline focus-ring",
              tab === t ? "border-gl-text font-bold text-gl-text" : "border-transparent text-gl-text-secondary hover:text-gl-text",
            )}
          >
            {TAB_LABEL[t]} · {counts[t]}
          </Link>
        ))}
      </nav>

      <div className="flex min-h-0 flex-1">
        <section aria-label="Pages" className={cn("min-w-0 flex-1 flex-col", openId ? "hidden lg:flex" : "flex")}>
          {rows.length ? (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse type-body-sm">
                <thead>
                  <tr className="border-b-2 border-gl-border text-left">
                    <th scope="col" className="h-control pr-3 pl-6 type-label text-gl-text-secondary">Page</th>
                    <th scope="col" className="h-control px-3 type-label text-gl-text-secondary">State</th>
                    <th scope="col" className="h-control px-3 type-label text-gl-text-secondary">Team</th>
                    <th scope="col" className="h-control px-3 pr-6 text-right type-label text-gl-text-secondary">Followers</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => {
                    const open = p.id === openId;
                    const note = stateNote(p);
                    return (
                      <tr
                        key={p.id}
                        className={cn(
                          "relative border-b border-gl-border-subtle hover:bg-gl-surface-raised",
                          open && "bg-gl-surface-raised outline-2 -outline-offset-2 outline-gl-border",
                        )}
                      >
                        <td className="py-2.5 pr-3 pl-6">
                          <Link
                            ref={(el) => {
                              if (el) rowRefs.current.set(p.id, el);
                              else rowRefs.current.delete(p.id);
                            }}
                            href={href({ page: p.id })}
                            scroll={false}
                            aria-current={open ? "true" : undefined}
                            className="flex items-center gap-2.5 font-semibold text-gl-text no-underline after:absolute after:inset-0 focus-ring"
                          >
                            <PageTile name={p.name} className={cn("size-8 text-sm", p.hasLogo && p.state === "managed" && "bg-gl-accent text-gl-on-accent")} />
                            <span className="flex min-w-0 flex-col">
                              <span>{p.name}</span>
                              <span className="font-normal text-gl-text-secondary">
                                {[`@${p.handle}`, pageType(p.roles), p.place].filter(Boolean).join(" · ")}
                              </span>
                              {p.matchedAlias && <span className="font-normal text-gl-text-secondary">Formerly {p.matchedAlias}</span>}
                            </span>
                          </Link>
                        </td>
                        <td className="p-3">
                          <span className="flex flex-col items-start gap-1">
                            {p.suspendedAt ? (
                              <span className="inline-block -rotate-2 border-2 border-gl-danger bg-gl-surface px-1.5 py-px text-[11px] leading-[14px] font-bold tracking-[0.08em] text-gl-danger">
                                SUSPENDED
                              </span>
                            ) : (
                              <PageStamp state={p.state} hasLogo={p.hasLogo} />
                            )}
                            {note && <span className="text-gl-text-secondary">{note}</span>}
                          </span>
                        </td>
                        <td className="p-3">
                          {p.teamCount ? (
                            <>
                              {p.teamCount}
                              {p.owner ? ` · @${p.owner} owns` : " · no owner"}
                            </>
                          ) : (
                            <span className="text-gl-text-secondary">Nobody yet</span>
                          )}
                        </td>
                        <td className="p-3 pr-6 text-right tabular-nums">{p.followers.toLocaleString("en-US")}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="px-6 py-4 type-caption text-gl-text-secondary">
                Search also finds Formerly names. / to search · j / k to move · Enter to open · Esc to close
              </p>
            </div>
          ) : (
            <p className="max-w-[60ch] px-6 py-6 type-body">
              {q ? `No page matches "${q}".` : tab === "suspended" ? "No page is suspended." : "No pages here."}
            </p>
          )}
        </section>

        {openId && (
          <aside aria-label="Details" className="flex w-full min-w-0 flex-col border-gl-border lg:w-detail lg:shrink-0 lg:border-l-2">
            <div className="flex items-center gap-2 border-b border-gl-border-subtle px-6 py-2 lg:hidden">
              <Link href={href({ page: null })} className="inline-flex h-control items-center gap-1.5 type-body-sm font-semibold focus-ring">
                <Icon name="arrow_back" />
                Back to pages
              </Link>
            </div>
            {detailMissing || !detail ? (
              <p className="p-6 type-body">This page isn&apos;t here any more. It may have been merged into another page.</p>
            ) : (
              <PagePane
                key={detail.id}
                d={detail}
                onClose={() => router.push(href({ page: null }), { scroll: false })}
                onDone={(message, gone) => {
                  setToast(message);
                  if (gone) router.replace(href({ page: gone === true ? null : gone }), { scroll: false });
                }}
              />
            )}
          </aside>
        )}
      </div>

      <div aria-live="polite" className="pointer-events-none fixed right-6 bottom-6 z-50">
        {toast && (
          <div className="pointer-events-auto flex max-w-md items-center gap-4 border-2 border-gl-border bg-gl-surface-raised px-4 py-3 type-body-sm">
            <span>{toast}</span>
            <Button variant="outline" size="icon" aria-label="Close" title="Close" onClick={() => setToast(null)}>
              <Icon name="close" />
            </Button>
          </div>
        )}
      </div>
    </>
  );
}

const TOOLS: { tool: Tool; icon: string; title: string; sub: string; danger?: boolean }[] = [
  { tool: "rename", icon: "edit", title: "Rename or handle", sub: "Old handle redirects 90 days" },
  { tool: "transfer", icon: "swap_horiz", title: "Transfer ownership", sub: "Takes effect at once" },
  { tool: "split", icon: "call_split", title: "Split off a page", sub: "Move products to a new page" },
  { tool: "suspend", icon: "pause_circle", title: "Suspend page", sub: "Read-only until you lift it", danger: true },
  { tool: "merge", icon: "merge", title: "Merge into…", sub: "Duplicates and rebrands. Can't undo", danger: true },
  { tool: "close", icon: "door_front", title: "Closed for good", sub: "Archive; you can reopen", danger: true },
];

function PagePane({
  d,
  onClose,
  onDone,
}: {
  d: PageDetail;
  onClose: () => void;
  /** A message for the toast; `gone` closes the pane (true) or opens another page (its id). */
  onDone: (message: string, gone?: true | string) => void;
}) {
  const [tool, setTool] = useState<Tool | null>(null);
  const archived = d.state === "out_of_business" || d.state === "closed";
  const kind = pageType(d.roles);
  const place = d.city ?? d.country;
  const owner = d.team.find((m) => m.role === "owner");
  const managers = d.team.filter((m) => m.role === "manager");
  const staff = d.team.filter((m) => m.role === "staff").length;
  const formerly = d.aliases.filter((a) => a.formerly && a.name !== d.name);
  const redirects = d.aliases.filter((a) => a.handle && a.redirectUntil && new Date(a.redirectUntil) > new Date());

  const why = (t: Tool): string | null => {
    if (t === "suspend" && d.state !== "managed") return "Only managed pages can be suspended.";
    if (t === "transfer" && !d.team.length) return "Nobody's on the team. Use Send claim invite.";
    if (t === "split" && !d.products) return "No products to move.";
    return null;
  };

  const rows: [string, React.ReactNode][] = [
    ["Handle", `@${d.handle}`],
    ["Roles", `${d.roles.map((r) => r.charAt(0).toUpperCase() + r.slice(1)).join(", ")}${d.products ? ` (${d.products} products)` : ""}`],
    ["Metro area", d.metro ?? <span className="text-gl-text-secondary">None</span>],
    [
      "Team",
      d.team.length ? (
        [
          owner ? `@${owner.username ?? "deleted user"} (owner)` : "No owner",
          ...managers.map((m) => `@${m.username ?? "deleted user"} (manager)`),
          staff ? `${staff} staff` : null,
        ]
          .filter(Boolean)
          .join(", ")
      ) : (
        <span className="text-gl-text-secondary">Nobody yet</span>
      ),
    ],
    ["Followers", d.followers.toLocaleString("en-US")],
    ["Partner", d.foundingPartnerAt ? "Founding partner" : <span className="text-gl-text-secondary">No</span>],
  ];
  if (formerly.length) rows.push(["Formerly", formerly.map((a) => a.name).join(", ")]);
  if (redirects.length) rows.push(["Redirects", redirects.map((a) => `@${a.handle} until ${day(a.redirectUntil!)}`).join(", ")]);

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1.5">
          <h2 className="type-headline">{d.name}</h2>
          <p className="flex flex-wrap gap-x-3 type-body-sm text-gl-text-secondary">
            {d.activeBlocks > 0 && (
              <Link href={`/page-blocks?page=${d.id}`} className="font-semibold text-gl-accent-text underline focus-ring">
                Blocks · {d.activeBlocks}
              </Link>
            )}
            <span>
              {d.pastClaims} past {d.pastClaims === 1 ? "claim" : "claims"}
              {d.openClaims ? ` · ${d.openClaims} open` : ""}
            </span>
            {d.openReports > 0 && <span>{d.openReports} open reports in the Queue</span>}
          </p>
        </div>
        <Button variant="outline" size="icon" aria-label="Close details" title="Close (Esc)" onClick={onClose}>
          <Icon name="close" />
        </Button>
      </div>

      <div className="flex flex-col gap-3 border-2 border-gl-border bg-gl-surface-raised p-3">
        <div className="flex items-center gap-3">
          <PageTile name={d.name} className={cn(d.hasLogo && d.state === "managed" && "bg-gl-accent text-gl-on-accent")} />
          <div className="flex min-w-0 flex-col gap-1">
            <span className="type-body font-semibold">{d.name}</span>
            <span className="type-label text-gl-text-secondary">
              {[kind, place, d.state === "out_of_business" ? years(d.foundedLabel, d.endedLabel) : null].filter(Boolean).join(" · ").toUpperCase()}
            </span>
          </div>
          <span className="ml-auto">
            <PageStamp state={d.state} hasLogo={d.hasLogo} />
          </span>
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 type-body-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-gl-text-secondary">{k}</dt>
              <dd className="min-w-0 break-words">{v}</dd>
            </div>
          ))}
        </dl>
      </div>

      {d.frozen && <WarningNote>Frozen while a dispute is open. Transferring ownership settles it and unfreezes the page.</WarningNote>}
      {d.needsTranslations && <WarningNote>Needs translations: the factual line is in English only.</WarningNote>}
      {d.handover && (
        <p className="type-body-sm text-gl-text-secondary">
          A hand-over to @{d.handover.username ?? "deleted user"} is waiting ({d.handover.ago}). Transferring cancels it.
        </p>
      )}

      {d.suspendedAt && (
        <div role="note" className="flex flex-col gap-3 border-2 border-gl-danger p-3 type-body-sm">
          <div className="flex items-start gap-2.5">
            <Icon name="pause_circle" className="mt-px shrink-0 text-gl-danger" />
            <div className="flex min-w-0 flex-col gap-1">
              <span className="font-semibold">Suspended since {day(d.suspendedAt)}</span>
              {d.suspendedReason && <span className="whitespace-pre-wrap">&ldquo;{d.suspendedReason}&rdquo;</span>}
            </div>
          </div>
          <Button variant="outline" className="self-start" onClick={() => setTool("lift")}>
            Lift suspension
          </Button>
        </div>
      )}

      {archived && (
        <div role="note" className="flex flex-col gap-3 border-2 border-gl-border p-3 type-body-sm">
          <div className="flex items-start gap-2.5">
            <Icon name={d.state === "closed" ? "storefront" : "archive"} className="mt-px shrink-0" />
            <span>
              {d.state === "closed"
                ? `Closed${d.closedAt ? ` since ${day(d.closedAt)}` : ""}. A read-only archive.`
                : `Retired${years(d.foundedLabel, d.endedLabel) ? ` (${years(d.foundedLabel, d.endedLabel)})` : ""}. A read-only archive.`}
            </span>
          </div>
          <Button variant="outline" className="self-start" onClick={() => setTool("reopen")}>
            Reopen
          </Button>
        </div>
      )}

      <section className="flex flex-col gap-2">
        <h3 className="type-label text-gl-text-secondary">Page tools</h3>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {TOOLS.filter((t) => !(t.tool === "suspend" && d.suspendedAt) && !(t.tool === "close" && archived)).map((t) => {
            const blocked = why(t.tool);
            return (
              <button
                key={t.tool}
                type="button"
                disabled={!!blocked}
                title={blocked ?? undefined}
                onClick={() => setTool(t.tool)}
                className={cn(
                  "flex min-h-16 items-start gap-2.5 border-2 bg-gl-surface p-3 text-left focus-ring",
                  t.danger ? "border-gl-danger" : "border-gl-border",
                  "enabled:hover:bg-gl-surface-raised disabled:cursor-not-allowed disabled:opacity-50",
                )}
              >
                <Icon name={t.icon} className={cn("mt-px shrink-0", t.danger && "text-gl-danger")} />
                <span className="flex flex-col gap-0.5">
                  <span className="type-body-sm font-semibold">{t.title}</span>
                  <span className="type-caption text-gl-text-secondary">{blocked ?? t.sub}</span>
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="type-label text-gl-text-secondary">History</h3>
        {d.history.length ? (
          <ol className="flex flex-col border-t border-gl-border-subtle">
            {d.history.map((h, i) => (
              <li key={i} className="flex gap-3 border-b border-gl-border-subtle py-2 type-body-sm">
                <time dateTime={h.at} className="w-14 shrink-0 text-gl-text-secondary tabular-nums">
                  {day(h.at)}
                </time>
                <span className="min-w-0 break-words">{historyLine(h)}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="type-body-sm text-gl-text-secondary">Nothing yet.</p>
        )}
        <p className="type-caption text-gl-text-secondary">Every page tool is logged here. Teams don&apos;t see this history.</p>
      </section>

      <ToolDialogs page={d} tool={tool} onClose={() => setTool(null)} onDone={onDone} />
    </div>
  );
}
