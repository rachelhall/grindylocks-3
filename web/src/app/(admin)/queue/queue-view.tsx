"use client";

import { Tabs } from "@base-ui/react/tabs";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, use, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import type { QueueItem } from "@/lib/queue";
import { fieldLabel, obstacleTypeLabel, type QueueTab, reasonLabel, stateLabel, TAB_VALUES } from "@/lib/queue-labels";
import { cn } from "@/lib/utils";

export type { QueueTab };

type TabDef = {
  value: QueueTab;
  label: string;
  kinds: QueueItem["kind"][] | null;
  empty: string;
  /** Rachel's tabs: only the owner sees them. */
  ownerOnly?: boolean;
  /** A line under the tabs, as in the mockups. */
  note?: string;
};

const tabs: TabDef[] = [
  {
    value: "all",
    label: "All",
    kinds: null,
    empty: "Nothing waiting. Reports, park and shop fixes, suggestions and claims show up here.",
  },
  {
    value: "reports",
    label: "Reports",
    kinds: ["report", "page_report"],
    empty: "No reports waiting. Reported posts, comments, people and pages show up here.",
  },
  {
    value: "park-info",
    label: "Park and shop info",
    kinds: ["park_info", "shop_fix"],
    empty: "No fixes waiting. Fixes members suggest for a park's or an unofficial shop's details show up here.",
  },
  {
    value: "obstacles",
    label: "Suggested obstacles",
    kinds: ["obstacle"],
    empty: "No suggested obstacles waiting. Obstacles members add while posting show up here.",
  },
  {
    value: "claims",
    label: "Claims",
    kinds: ["claim"],
    ownerOnly: true,
    empty: "No claims waiting. Claims sent from a page's Claim this page show up here.",
    note: "Claims are only in your queue. Approving makes the person the page's owner.",
  },
  {
    value: "suggested-brands",
    label: "Suggested brands",
    kinds: ["page_suggestion"],
    ownerOnly: true,
    empty: "No suggested brands or shops waiting. Suggestions from Search show up here.",
    note: "Suggested brands and shops are only in your queue. English only.",
  },
  {
    value: "product-suggestions",
    label: "Product suggestions",
    kinds: ["product_suggestion"],
    ownerOnly: true,
    empty: "No product suggestions waiting. Suggest a change on a Products tab shows up here.",
    note: "Product suggestions are only in your queue. They come from Suggest a change on a Products tab.",
  },
];

const fixFieldLabel: Record<string, string> = {
  hours: "hours",
  location_type: "storefront or not",
  location: "address or pin",
  brands_carried: "brands carried",
  website: "website",
  closed: "closed for good",
  other: "something else",
};

const productKindLabel: Record<string, string> = {
  missing_model: "Missing model",
  wrong_name: "Wrong name",
  wrong_year: "Wrong year",
  no_longer_made: "No longer made",
  stock_parts: "Stock parts",
  something_else: "Something else",
};

/** What a detail pane can tell the queue: the item is done, move on. */
type QueueActions = { done: (message: string) => void; close: () => void };
const QueueContext = createContext<QueueActions>({ done: () => {}, close: () => {} });
export function useQueue() {
  return use(QueueContext);
}

/** True when a key press belongs to a field or an open dialog, not to the queue. */
export function typingOrDialog(event: KeyboardEvent): boolean {
  const el = event.target as HTMLElement | null;
  if (event.metaKey || event.ctrlKey || event.altKey) return true;
  if (el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName))) return true;
  return !!document.querySelector('[role="dialog"], [role="alertdialog"]');
}

function rowTitle(item: QueueItem): { title: string; sub: string } {
  const who = item.username ? `@${item.username}` : "deleted user";
  if (item.kind === "report") {
    const times = item.reportCount > 1 ? ` ${item.reportCount} times` : "";
    const reason = reasonLabel[item.reason ?? ""] ?? "Reported";
    if (item.target === "person") return { title: `${who} reported${times}`, sub: reason };
    const thing =
      item.target === "meetup" ? "Meetup" : item.target === "meetup_comment" ? "Meetup comment" : item.target === "comment" ? "Comment" : "Post";
    // A post or comment made as a page (PR 8b) has no person: name the page.
    const by = item.page ? item.page.name : who;
    return {
      title: `${thing} reported${times}`,
      sub: item.target === "meetup" && item.label ? `${reason} · “${item.label}” · ${by}` : `${reason} · ${by}`,
    };
  }
  if (item.kind === "park_info") {
    const field = item.target === "obstacle" && item.label ? item.label : (fieldLabel[item.target as keyof typeof fieldLabel] ?? item.target);
    return { title: `Park info: ${field}`, sub: `Suggested fix · ${who}` };
  }
  if (item.kind === "claim") {
    const proof = item.target === "email" ? (item.flag ? "work email, domain matches" : "work email, domain doesn't match") : `posted code ${item.label ?? ""}`;
    return {
      title: `Claim for ${item.page?.name ?? "a page"}${item.reportCount > 1 ? ` · ${item.reportCount} open` : ""}`,
      sub: `${who} · ${item.reason ?? ""} · ${proof}`,
    };
  }
  if (item.kind === "page_suggestion") {
    return {
      title: `Suggested ${item.target}: ${item.label ?? ""}`,
      sub: item.flag && item.page ? `${who} · possible match: ${item.page.name}` : `${who} · no match`,
    };
  }
  if (item.kind === "product_suggestion") {
    return {
      title: `${productKindLabel[item.target] ?? "Suggestion"}: ${item.label ?? ""}`,
      sub: `${item.page?.name ?? ""} · ${who} · ${item.flag ? "edit value" : "mark done"}`,
    };
  }
  if (item.kind === "page_report") {
    const times = item.reportCount > 1 ? ` ${item.reportCount} times` : "";
    return { title: `${item.page?.name ?? "A page"} reported${times}`, sub: reasonLabel[item.reason ?? ""] ?? "Reported" };
  }
  if (item.kind === "shop_fix") {
    return { title: `Shop info: ${fixFieldLabel[item.target] ?? item.target}`, sub: `Suggested fix · ${who}` };
  }
  return { title: "Suggested obstacle", sub: `“${item.label ?? ""}” · ${obstacleTypeLabel(item.target).toLowerCase()}` };
}

/** The Where column: the park, or the page and its place. */
function whereCell(item: QueueItem): { main: React.ReactNode; sub: string | null } {
  if (item.kind === "page_suggestion") return { main: item.target === "shop" ? "New shop" : "New brand", sub: null };
  // A report on a page's post or comment: the park, with the page under it.
  if (item.kind === "report" && item.page) {
    const type = item.page.roles.includes("shop") ? "Shop" : "Brand";
    return {
      main: item.parkName ?? <span className="text-gl-text-secondary">No park</span>,
      sub: `${item.page.name} · ${type}`,
    };
  }
  if (item.page) {
    const type = item.page.roles.includes("shop") ? "Shop" : "Brand";
    return { main: item.page.name, sub: [type, item.page.place].filter(Boolean).join(" · ") };
  }
  return { main: item.parkName ?? <span className="text-gl-text-secondary">No park</span>, sub: item.metroName };
}

/**
 * The queue's list and detail pane, side by side from split-min (1024px) up;
 * below that an open row takes the whole page, with a way back. The URL holds
 * the tab, area and open row; this component only moves between them.
 *
 * Keyboard (design/web.md): j/k move between rows, Enter opens, Esc closes
 * the pane, ? lists the shortcuts. Action shortcuts live in the panes and
 * always open their confirmation first.
 */
export function QueueView({
  items,
  areas,
  area,
  tab,
  openKey,
  detailMissing,
  detail,
  owner,
  headerAction,
}: {
  items: QueueItem[];
  areas: { id: string; name: string }[];
  area: string | null;
  tab: QueueTab;
  openKey: string | null;
  detailMissing: boolean;
  detail: React.ReactNode;
  owner: boolean;
  /** Something for the tab's note line, like Send claim invite on Claims. */
  headerAction?: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [toast, setToast] = useState<string | null>(null);
  const [help, setHelp] = useState(false);
  const rowRefs = useRef(new Map<string, HTMLAnchorElement>());

  const shown = useMemo(() => tabs.filter((t) => owner || !t.ownerOnly), [owner]);
  const counts = useMemo(() => {
    const c = Object.fromEntries(TAB_VALUES.map((v) => [v, 0])) as Record<QueueTab, number>;
    c.all = items.length;
    for (const i of items) {
      const t = tabs.find((x) => x.kinds?.includes(i.kind));
      if (t) c[t.value]++;
    }
    return c;
  }, [items]);

  const current = shown.find((t) => t.value === tab) ?? shown[0];
  const kinds = current.kinds;
  const visible = useMemo(() => (kinds ? items.filter((i) => kinds.includes(i.kind)) : items), [items, kinds]);

  const href = useCallback(
    (next: { tab?: QueueTab; area?: string | null; item?: string | null }) => {
      const p = new URLSearchParams();
      const t = next.tab ?? tab;
      const a = next.area === undefined ? area : next.area;
      const i = next.item === undefined ? openKey : next.item;
      if (t !== "all") p.set("tab", t);
      if (a) p.set("area", a);
      if (i) p.set("item", i);
      const qs = p.toString();
      return qs ? `${pathname}?${qs}` : pathname;
    },
    [pathname, tab, area, openKey],
  );

  const close = useCallback(() => router.push(href({ item: null }), { scroll: false }), [router, href]);

  const done = useCallback(
    (message: string) => {
      setToast(message);
      // Move on to the next row (or the one before, at the end of the list).
      const at = visible.findIndex((i) => i.key === openKey);
      const next = at === -1 ? null : (visible[at + 1] ?? visible[at - 1] ?? null);
      router.replace(href({ item: next?.key ?? null }), { scroll: false });
    },
    [visible, openKey, router, href],
  );

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "?" && !typingOrDialog(event)) {
        event.preventDefault();
        setHelp(true);
        return;
      }
      if (typingOrDialog(event)) return;
      if (event.key === "Escape" && openKey) {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "j" && event.key !== "k") return;
      if (!visible.length) return;
      event.preventDefault();
      const focusedKey = [...rowRefs.current.entries()].find(([, el]) => el === document.activeElement)?.[0];
      const from = visible.findIndex((i) => i.key === (focusedKey ?? openKey));
      const to =
        from === -1 ? 0 : Math.min(visible.length - 1, Math.max(0, from + (event.key === "j" ? 1 : -1)));
      rowRefs.current.get(visible[to].key)?.focus();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, openKey, close]);

  const actions = useMemo(() => ({ done, close }), [done, close]);
  const paneOpen = !!openKey;

  return (
    <QueueContext value={actions}>
      <Tabs.Root
        value={current.value}
        onValueChange={(value) => router.replace(href({ tab: value as QueueTab }), { scroll: false })}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b-2 border-gl-border px-6 pt-4">
          <Tabs.List aria-label="Queue type" className="flex gap-6 overflow-x-auto">
            {shown.map((t) => (
              <Tabs.Tab
                key={t.value}
                value={t.value}
                className={cn(
                  "-mx-1 -mb-0.5 h-control shrink-0 border-b-[3px] border-transparent px-1 whitespace-nowrap type-body-sm font-medium text-gl-text-secondary",
                  "hover:text-gl-text focus-ring focus-visible:outline-offset-[-2px]",
                  "data-active:border-gl-text data-active:font-bold data-active:text-gl-text",
                )}
              >
                {t.label} · {counts[t.value]}
              </Tabs.Tab>
            ))}
          </Tabs.List>
          <div className="flex items-center gap-2 pb-3">
            {areas.length > 1 && (
              <>
                <label htmlFor="area" className="type-label text-gl-text-secondary">
                  Area
                </label>
                <select
                  id="area"
                  value={area ?? ""}
                  onChange={(e) => router.replace(href({ area: e.target.value || null, item: null }), { scroll: false })}
                  className="h-control min-w-44 border-2 border-gl-border bg-gl-surface-sunk px-2.5 type-body-sm text-gl-text focus-ring"
                >
                  <option value="">All metro areas</option>
                  {areas.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </>
            )}
            <Button
              variant="outline"
              size="icon"
              aria-label="Keyboard shortcuts"
              title="Keyboard shortcuts (?)"
              onClick={() => setHelp(true)}
            >
              <Icon name="keyboard" />
            </Button>
          </div>
        </div>

        {(current.note || headerAction) && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gl-border-subtle px-6 py-3">
            {current.note && (
              <p className="flex items-center gap-1.5 type-body-sm text-gl-text-secondary">
                <Icon name="lock" size={18} />
                {current.note}
              </p>
            )}
            {headerAction}
          </div>
        )}

        {shown.map((t) => (
          <Tabs.Panel key={t.value} value={t.value} className="flex min-h-0 flex-1 focus-ring focus-visible:outline-offset-[-2px]">
            <section
              aria-label="Waiting"
              className={cn("min-w-0 flex-1 flex-col", paneOpen ? "hidden lg:flex" : "flex")}
            >
              {visible.length ? (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse type-body-sm">
                      <thead>
                        <tr className="border-b-2 border-gl-border text-left">
                          <Th className="pl-6">What</Th>
                          <Th>Where</Th>
                          <Th>State</Th>
                          <Th className="pr-6 text-right">Waiting</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {visible.map((item) => {
                          const { title, sub } = rowTitle(item);
                          const where = whereCell(item);
                          const open = item.key === openKey;
                          return (
                            <tr
                              key={item.key}
                              className={cn(
                                "relative border-b border-gl-border-subtle hover:bg-gl-surface-raised",
                                open && "bg-gl-surface-raised outline-2 -outline-offset-2 outline-gl-border",
                              )}
                            >
                              <td className="py-2.5 pr-3 pl-6">
                                <Link
                                  ref={(el) => {
                                    if (el) rowRefs.current.set(item.key, el);
                                    else rowRefs.current.delete(item.key);
                                  }}
                                  href={href({ item: item.key })}
                                  scroll={false}
                                  aria-current={open ? "true" : undefined}
                                  className="flex flex-col font-semibold text-gl-text no-underline after:absolute after:inset-0 focus-ring"
                                >
                                  {title}
                                  <span className="font-normal text-gl-text-secondary">{sub}</span>
                                </Link>
                              </td>
                              <td className="p-3">
                                {where.main}
                                {where.sub && <div className="text-gl-text-secondary">{where.sub}</div>}
                              </td>
                              <td className="p-3">
                                <StateChip state={item.state} />
                              </td>
                              <td className="p-3 pr-6 text-right tabular-nums">
                                <time dateTime={item.latestAt}>{item.ago}</time>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <p className="px-6 py-4 type-caption text-gl-text-secondary">
                    j / k to move · Enter to open · ? for all shortcuts
                  </p>
                </>
              ) : (
                <p className="max-w-[60ch] px-6 py-6 type-body">
                  {area ? "Nothing waiting in this area." : t.empty}
                </p>
              )}
            </section>

            {paneOpen && (
              <aside
                aria-label="Details"
                className="flex w-full min-w-0 flex-col border-gl-border lg:w-detail lg:shrink-0 lg:border-l-2"
              >
                <div className="flex items-center gap-2 border-b border-gl-border-subtle px-6 py-2 lg:hidden">
                  <Link href={href({ item: null })} className="inline-flex h-control items-center gap-1.5 type-body-sm font-semibold focus-ring">
                    <Icon name="arrow_back" />
                    Back to the queue
                  </Link>
                </div>
                {detailMissing ? (
                  <div className="flex flex-col gap-4 p-6">
                    <p className="type-body">Someone already handled this, or it&apos;s no longer in your queue.</p>
                    <Button variant="outline" className="self-start" onClick={close}>
                      Close
                    </Button>
                  </div>
                ) : (
                  detail
                )}
              </aside>
            )}
          </Tabs.Panel>
        ))}
      </Tabs.Root>

      <Dialog open={help} onOpenChange={setHelp} title="Keyboard shortcuts">
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 type-body-sm">
          {(
            [
              ["j / k", "Next and previous row"],
              ["Enter", "Open the row"],
              ["Esc", "Close the details"],
              ["d", "Dismiss (reports)"],
              ["h", "Keep hidden (reports)"],
              ["e", "Escalate to Rachel (reports, city and park admins)"],
              ["a", "Approve (fixes, obstacles, claims and suggestions)"],
              ["x", "Decline (fixes, obstacles, claims and suggestions)"],
              ["?", "This list"],
            ] as const
          ).map(([key, what]) => (
            <div key={key} className="contents">
              <dt>
                <kbd className="border-2 border-gl-border px-1.5 font-mono font-semibold">{key}</kbd>
              </dt>
              <dd>{what}</dd>
            </div>
          ))}
        </dl>
        <p className="type-caption text-gl-text-secondary">
          Action shortcuts open their confirmation first, so a stray key never acts on its own.
        </p>
      </Dialog>

      <div aria-live="polite" className="pointer-events-none fixed right-6 bottom-6 z-50">
        {toast && (
          <div className="pointer-events-auto flex items-center gap-4 border-2 border-gl-border bg-gl-surface-raised px-4 py-3 type-body-sm">
            <span>{toast}</span>
            <Button variant="outline" size="icon" aria-label="Close" title="Close" onClick={() => setToast(null)}>
              <Icon name="close" />
            </Button>
          </div>
        )}
      </div>
    </QueueContext>
  );
}

export function StateChip({ state }: { state: string }) {
  return (
    <span
      className={cn(
        "inline-block border-2 px-1.5 py-px text-[11px] leading-[14px] font-semibold tracking-[0.06em] whitespace-nowrap uppercase",
        state === "auto_hidden" ? "border-gl-danger text-gl-danger" : "border-gl-border",
        state === "sent_to_you" && "bg-gl-accent text-gl-on-accent",
      )}
    >
      {stateLabel[state] ?? state}
    </span>
  );
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <th scope="col" className={cn("h-control px-3 type-label text-gl-text-secondary", className)}>
      {children}
    </th>
  );
}
