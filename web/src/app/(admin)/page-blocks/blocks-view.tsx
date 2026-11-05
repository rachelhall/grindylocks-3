"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";

import { PageCard, PageTile, pageType, WarningNote } from "@/components/page-card";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import type { PageBlock, PageBlockDetail } from "@/lib/brands";
import { cn } from "@/lib/utils";

import { liftBlock } from "./actions";

function typingOrDialog(event: KeyboardEvent): boolean {
  const el = event.target as HTMLElement | null;
  if (event.metaKey || event.ctrlKey || event.altKey) return true;
  if (el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName))) return true;
  return !!document.querySelector('[role="dialog"], [role="alertdialog"]');
}

function when(iso: string): string {
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" });
}

/**
 * The Page blocks list and detail (mockup: Admin · page blocks). Flagged pages
 * (more than 5 blocks in 7 days) sit in a pink band at the top, the rest
 * newest first. Lift block is the only action, and nobody is told.
 */
export function BlocksView({
  blocks,
  counts,
  lifted,
  page,
  pages,
  openId,
  detail,
  detailMissing,
}: {
  blocks: PageBlock[];
  counts: { all: number; lifted: number };
  lifted: boolean;
  page: string | null;
  pages: { id: string; name: string }[];
  openId: string | null;
  detail: PageBlockDetail | null;
  detailMissing: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const rowRefs = useRef(new Map<string, HTMLAnchorElement>());
  const [toast, setToast] = useState<string | null>(null);

  const href = useCallback(
    (next: { lifted?: boolean; page?: string | null; block?: string | null }) => {
      const p = new URLSearchParams();
      if (next.lifted ?? lifted) p.set("view", "lifted");
      const pg = next.page === undefined ? page : next.page;
      if (pg) p.set("page", pg);
      const b = next.block === undefined ? openId : next.block;
      if (b) p.set("block", b);
      const qs = p.toString();
      return qs ? `${pathname}?${qs}` : pathname;
    },
    [pathname, lifted, page, openId],
  );

  const { flagged, rest, ordered } = useMemo(() => {
    const f = lifted ? [] : blocks.filter((b) => b.flagged);
    const r = lifted ? blocks : blocks.filter((b) => !b.flagged);
    return { flagged: f, rest: r, ordered: [...f, ...r] };
  }, [blocks, lifted]);
  const flaggedPages = [...new Set(flagged.map((b) => b.page.id))];

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
        router.push(href({ block: null }), { scroll: false });
        return;
      }
      if (event.key !== "j" && event.key !== "k") return;
      if (!ordered.length) return;
      event.preventDefault();
      const focused = [...rowRefs.current.entries()].find(([, el]) => el === document.activeElement)?.[0];
      const from = ordered.findIndex((b) => b.id === (focused ?? openId));
      const to = from === -1 ? 0 : Math.min(ordered.length - 1, Math.max(0, from + (event.key === "j" ? 1 : -1)));
      rowRefs.current.get(ordered[to].id)?.focus();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ordered, openId, router, href]);

  function table(rows: PageBlock[], label: string) {
    return (
      <table className="w-full border-collapse type-body-sm" aria-label={label}>
        <thead>
          <tr className="border-b-2 border-gl-border text-left">
            <th scope="col" className="h-control pr-3 pl-6 type-label text-gl-text-secondary">Page</th>
            <th scope="col" className="h-control px-3 type-label text-gl-text-secondary">Skater</th>
            <th scope="col" className="h-control px-3 type-label text-gl-text-secondary">{lifted ? "Lifted by" : "Blocked by"}</th>
            <th scope="col" className="h-control px-3 pr-6 text-right type-label text-gl-text-secondary">When</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((b, i) => {
            const open = b.id === openId;
            const firstOfPage = b.flagged && rows.findIndex((x) => x.page.id === b.page.id) === i;
            return (
              <tr
                key={b.id}
                className={cn(
                  "relative border-b border-gl-border-subtle hover:bg-gl-surface-raised",
                  open && "bg-gl-surface-raised outline-2 -outline-offset-2 outline-gl-border",
                )}
              >
                <td className="py-2.5 pr-3 pl-6">
                  <Link
                    ref={(el) => {
                      if (el) rowRefs.current.set(b.id, el);
                      else rowRefs.current.delete(b.id);
                    }}
                    href={href({ block: b.id })}
                    scroll={false}
                    aria-current={open ? "true" : undefined}
                    className="flex items-center gap-2.5 font-semibold text-gl-text no-underline after:absolute after:inset-0 focus-ring"
                  >
                    <PageTile name={b.page.name} className="size-8 text-sm" />
                    <span className="flex flex-col">
                      <span>
                        {b.page.name}
                        {firstOfPage && (
                          <span className="ml-2 border-2 border-gl-border bg-gl-accent px-1 text-[11px] leading-[14px] font-semibold tracking-[0.06em] text-gl-on-accent uppercase">
                            {b.weekCount} this week
                          </span>
                        )}
                      </span>
                      <span className="font-normal text-gl-text-secondary">{[pageType(b.page.roles), b.page.place].filter(Boolean).join(" · ")}</span>
                    </span>
                  </Link>
                </td>
                <td className="p-3">{b.skater ? `@${b.skater}` : <span className="text-gl-text-secondary">deleted user</span>}</td>
                <td className="p-3">
                  {lifted ? (
                    b.liftedBy ? `@${b.liftedBy}` : "You"
                  ) : (
                    <>
                      {b.blockedBy ? `@${b.blockedBy}` : <span className="text-gl-text-secondary">deleted user</span>}
                      {b.blockedByRole && <div className="text-gl-text-secondary capitalize">{b.blockedByRole}</div>}
                    </>
                  )}
                </td>
                <td className="p-3 pr-6 text-right tabular-nums">
                  <time dateTime={b.createdAt}>{b.ago}</time>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b-2 border-gl-border px-6 pt-4">
        <nav aria-label="Which blocks" className="flex gap-6">
          {(
            [
              [false, `All · ${counts.all}`],
              [true, `Lifted · ${counts.lifted}`],
            ] as const
          ).map(([l, text]) => (
            <Link
              key={String(l)}
              href={href({ lifted: l, block: null })}
              aria-current={lifted === l ? "page" : undefined}
              className={cn(
                "-mx-1 -mb-0.5 flex h-control items-center border-b-[3px] px-1 type-body-sm font-medium no-underline focus-ring",
                lifted === l ? "border-gl-text font-bold text-gl-text" : "border-transparent text-gl-text-secondary hover:text-gl-text",
              )}
            >
              {text}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2 pb-3">
          <label htmlFor="page-filter" className="type-label text-gl-text-secondary">
            Page
          </label>
          <select
            id="page-filter"
            value={page ?? ""}
            onChange={(e) => router.replace(href({ page: e.target.value || null, block: null }), { scroll: false })}
            className="h-control min-w-44 border-2 border-gl-border bg-gl-surface-sunk px-2.5 type-body-sm text-gl-text focus-ring"
          >
            <option value="">All pages</option>
            {pages.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <section aria-label="Blocks" className={cn("min-w-0 flex-1 flex-col", openId ? "hidden lg:flex" : "flex")}>
          {ordered.length ? (
            <div className="overflow-x-auto">
              {flagged.length > 0 && (
                <div className="border-b-2 border-gl-border bg-gl-accent-subtle text-gl-on-accent-subtle">
                  <p className="flex items-center gap-2 px-6 py-2.5 type-body-sm font-semibold">
                    <Icon name="flag" size={18} />
                    Flagged: more than 5 blocks in 7 days · {flaggedPages.length} {flaggedPages.length === 1 ? "page" : "pages"}
                  </p>
                  {table(flagged, "Flagged pages")}
                </div>
              )}
              {flagged.length > 0 && rest.length > 0 && (
                <p className="px-6 pt-4 pb-1 type-label text-gl-text-secondary">Everything else · newest first</p>
              )}
              {rest.length > 0 && table(rest, lifted ? "Lifted blocks" : "Other blocks")}
              <p className="px-6 py-4 type-caption text-gl-text-secondary">j / k to move · Enter to open · Esc to close</p>
            </div>
          ) : (
            <p className="max-w-[60ch] px-6 py-6 type-body">
              {lifted ? "No lifted blocks." : page ? "This page hasn't blocked anyone." : "No page has blocked anyone. When a brand or shop blocks a skater, it shows up here."}
            </p>
          )}
        </section>

        {openId && (
          <aside aria-label="Details" className="flex w-full min-w-0 flex-col border-gl-border lg:w-detail lg:shrink-0 lg:border-l-2">
            <div className="flex items-center gap-2 border-b border-gl-border-subtle px-6 py-2 lg:hidden">
              <Link href={href({ block: null })} className="inline-flex h-control items-center gap-1.5 type-body-sm font-semibold focus-ring">
                <Icon name="arrow_back" />
                Back to page blocks
              </Link>
            </div>
            {detailMissing || !detail ? (
              <div className="flex flex-col gap-4 p-6">
                <p className="type-body">This block isn&apos;t here any more.</p>
              </div>
            ) : (
              <BlockDetail
                key={detail.id}
                d={detail}
                onlyPageHref={href({ page: detail.page.id, block: null })}
                onClose={() => router.push(href({ block: null }), { scroll: false })}
                onLifted={(msg) => {
                  setToast(msg);
                  router.replace(href({ block: null }), { scroll: false });
                }}
              />
            )}
          </aside>
        )}
      </div>

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
    </>
  );
}

function BlockDetail({
  d,
  onlyPageHref,
  onClose,
  onLifted,
}: {
  d: PageBlockDetail;
  onlyPageHref: string;
  onClose: () => void;
  onLifted: (message: string) => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const skater = d.skater ? `@${d.skater}` : "this skater";
  const by = d.week.by.reduce<Record<string, number>>((acc, name) => {
    const k = name ? `@${name}` : "a deleted user";
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});

  function lift() {
    startTransition(async () => {
      const result = await liftBlock(d.id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setConfirm(false);
      onLifted(`Block lifted. ${skater} can comment on, follow and mention ${d.page.name} again. Nobody is told.`);
    });
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1.5">
          <span className="self-start border-2 border-gl-border px-1.5 py-px text-[11px] leading-[14px] font-semibold tracking-[0.06em] uppercase">
            {d.liftedAt ? "Lifted" : "Blocked"}
          </span>
          <h2 className="type-headline">
            {d.page.name} blocked {skater}
          </h2>
          <p className="type-body-sm text-gl-text-secondary">
            By {d.blockedBy ? `@${d.blockedBy}` : "a deleted user"}
            {d.blockedByRole && ` (${d.blockedByRole})`}, {when(d.createdAt)} UTC
            {d.liftedAt && ` · lifted ${when(d.liftedAt)} UTC${d.liftedBy ? ` by @${d.liftedBy}` : ""}`}
          </p>
        </div>
        <Button variant="outline" size="icon" aria-label="Close details" title="Close (Esc)" onClick={onClose}>
          <Icon name="close" />
        </Button>
      </div>

      {d.week.count > 5 && (
        <WarningNote>
          {d.page.name} blocked {d.week.count} people in the last 7 days.{" "}
          {Object.entries(by)
            .map(([name, n]) => `${n} by ${name}`)
            .join(", ")}
          .{" "}
          <Link href={onlyPageHref} className="font-semibold underline focus-ring">
            Show only {d.page.name}
          </Link>
        </WarningNote>
      )}

      <section className="flex flex-col gap-2">
        <h3 className="type-label text-gl-text-secondary">
          {skater} about {d.page.name} · last 30 days
        </h3>
        {d.mentions.length ? (
          <ul className="flex flex-col border-2 border-gl-border">
            {d.mentions.map((m, i) => (
              <li key={i} className="flex flex-col gap-1 border-t border-gl-border-subtle p-3 first:border-t-0">
                <span className="type-caption text-gl-text-secondary">
                  {new Date(m.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })} ·{" "}
                  {m.where === "post"
                    ? `commented on ${d.page.name}'s post`
                    : m.where === "reply"
                      ? `replied to ${d.page.name}`
                      : m.where === "caption"
                        ? "mentioned it in a caption"
                        : m.where === "meetup_comment"
                          ? "mentioned it in a meetup comment"
                          : "mentioned it in a comment"}
                </span>
                {m.deleted ? (
                  <span className="type-body-sm text-gl-text-secondary italic">Deleted</span>
                ) : (
                  <span className="type-body whitespace-pre-wrap">{m.text}</span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="type-body-sm text-gl-text-secondary">No comments to or mentions of {d.page.name}.</p>
        )}
        <p className="type-caption text-gl-text-secondary">
          Comments on the page&apos;s posts, replies to its comments, and captions and comments that @mention it.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="type-label text-gl-text-secondary">The page</h3>
        <PageCard page={d.page} />
      </section>

      {!d.liftedAt && (
        <div className="flex flex-col gap-3 border-t-2 border-gl-border pt-4">
          <Button variant="outline" className="self-start" onClick={() => setConfirm(true)}>
            Lift block
          </Button>
          <p className="type-caption text-gl-text-secondary">
            Lifting it lets {skater} comment on, follow and mention {d.page.name} again. Nobody is told.
          </p>
        </div>
      )}

      <Dialog
        open={confirm}
        onOpenChange={(o) => !o && !pending && setConfirm(false)}
        title={`Lift ${d.page.name}'s block on ${skater}?`}
        description="Nobody is told, the page or the skater."
      >
        {error && (
          <p role="alert" className="type-body-sm text-gl-danger">
            {error}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" disabled={pending} onClick={() => setConfirm(false)}>
            Cancel
          </Button>
          <Button disabled={pending} onClick={lift}>
            Lift block
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
