"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef } from "react";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import type { InboxContext, InboxItem, ManagedPage } from "@/lib/page-tools";
import { cn } from "@/lib/utils";

import { markInboxSeen } from "./actions";

/**
 * The Inbox, read-only on web (mockup: Web · page inbox): the follower
 * number, New and Earlier, and a detail pane with the comment in context.
 * Replying and blocking stay in the app; no post thumbnails (Rachel, Nov 6).
 * Opening it marks the inbox seen, as the app does, so what's here now is
 * Earlier next time. j / k move, Enter opens, Esc closes.
 */
export function InboxSection({
  page,
  items,
  followers,
  openId,
  context,
}: {
  page: ManagedPage;
  items: InboxItem[];
  followers: number;
  openId: string | null;
  context: InboxContext | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const marked = useRef(false);
  const fresh = useMemo(() => items.filter((i) => i.unread), [items]);
  const earlier = useMemo(() => items.filter((i) => !i.unread), [items]);
  const ordered = useMemo(() => [...fresh, ...earlier], [fresh, earlier]);
  const open = items.find((i) => i.id === openId) ?? null;

  useEffect(() => {
    if (marked.current || !fresh.length) return;
    marked.current = true;
    // The sidebar count goes on the next navigation; this view keeps its New list.
    void markInboxSeen(page.handle);
  }, [fresh.length, page.handle]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (t && (t.closest("input,textarea,select,[contenteditable]") || t.closest("[role=dialog]"))) return;
      const at = open ? ordered.indexOf(open) : -1;
      const go = (i: number) => {
        const item = ordered[Math.max(0, Math.min(ordered.length - 1, i))];
        if (item) router.replace(`${pathname}?item=${item.id}`, { scroll: false });
      };
      if (e.key === "j") go(at + 1);
      else if (e.key === "k") go(at <= 0 ? 0 : at - 1);
      else if (e.key === "Enter" && !open && ordered[0]) go(0);
      else if (e.key === "Escape" && open) router.replace(pathname, { scroll: false });
      else return;
      e.preventDefault();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, ordered, pathname, router]);

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col gap-1 px-6 pb-6">
        <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-4">
          <span className="type-headline tabular-nums">
            {followers.toLocaleString("en-US")} {followers === 1 ? "person follows" : "people follow"} {page.name}
          </span>
          <span className="type-body-sm text-gl-text-secondary">Only your team sees this number. Nobody sees who.</span>
        </p>

        {items.length === 0 ? (
          <p className="type-body">
            Nothing yet. Comments on {page.name}&apos;s posts and mentions of @{page.handle} show up here.
          </p>
        ) : (
          <>
            {fresh.length > 0 && <List title={`New · ${fresh.length}`} pageName={page.name} items={fresh} openId={openId} pathname={pathname} />}
            {earlier.length > 0 && <List title="Earlier" pageName={page.name} items={earlier} openId={openId} pathname={pathname} />}
            <p className="pt-3 type-caption text-gl-text-secondary">j / k to move · Enter to open · Esc to close</p>
          </>
        )}
      </div>

      {open && (
        <aside
          aria-labelledby="inbox-pane-h"
          className="sticky top-0 hidden max-h-dvh w-detail shrink-0 flex-col gap-4 overflow-y-auto border-l-2 border-gl-border p-6 lg:flex"
        >
          <Pane page={page} item={open} context={context} closeHref={pathname} />
        </aside>
      )}
      {open && (
        // Narrow screens: the detail as its own layer, as the queue does under split-min.
        <div className="fixed inset-0 z-30 flex flex-col gap-4 overflow-y-auto bg-gl-surface p-6 lg:hidden">
          <Pane page={page} item={open} context={context} closeHref={pathname} />
        </div>
      )}
    </div>
  );
}

function List({ title, pageName, items, openId, pathname }: { title: string; pageName: string; items: InboxItem[]; openId: string | null; pathname: string }) {
  return (
    <section className="flex flex-col">
      <h2 className="border-b-2 border-gl-border pt-4 pb-2 type-label text-gl-text-secondary">{title}</h2>
      <ul className="flex flex-col">
        {items.map((i) => (
          <li key={i.id}>
            <Link
              href={`${pathname}?item=${i.id}`}
              scroll={false}
              replace
              aria-current={i.id === openId ? "true" : undefined}
              className={cn(
                "flex min-h-row items-start gap-3 border-t border-gl-border-subtle px-2 py-2.5 focus-ring hover:bg-gl-surface-raised",
                i.id === openId && "outline-2 -outline-offset-2 outline-gl-border",
              )}
            >
              <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center bg-gl-text font-display text-sm text-gl-accent">
                {initials(i.author)}
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="type-body-sm">
                  <span className="font-semibold">{i.author.replace(/^@/, "")}</span> {verb(i, pageName)}
                  {i.body && <span className="text-gl-text">: &ldquo;{clip(i.body)}&rdquo;</span>}
                </span>
                <span className="type-caption text-gl-text-secondary">
                  {ago(i.createdAt)} · {where(i)}
                </span>
              </span>
              <Icon name={i.kind === "caption" || i.kind === "comment" ? "alternate_email" : "chat_bubble"} size={18} className="mt-0.5 text-gl-text-secondary" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Pane({ page, item, context, closeHref }: { page: ManagedPage; item: InboxItem; context: InboxContext | null; closeHref: string }) {
  const router = useRouter();
  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <h2 id="inbox-pane-h" className="type-headline">
          {context?.title ?? (item.eventTitle || "Comment")}
        </h2>
        <Button variant="outline" size="icon" aria-label="Close" title="Close (Esc)" onClick={() => router.replace(closeHref, { scroll: false })}>
          <Icon name="close" />
        </Button>
      </div>
      {context ? (
        <>
          {context.byline && <span className="type-label text-gl-text-secondary">{context.byline}</span>}
          {context.caption && <p className="type-body whitespace-pre-wrap">{context.caption}</p>}
          <span className="type-body-sm text-gl-text-secondary">
            {context.commentCount} {context.commentCount === 1 ? "comment" : "comments"}
            {context.commentCount > context.comments.length && ` · the last ${context.comments.length}`}
          </span>
          <ul className="flex flex-col gap-2">
            {context.comments.map((c) => (
              <li
                key={c.id}
                className={cn(
                  "flex flex-col gap-0.5 border-2 px-3 py-2",
                  c.highlighted ? "border-gl-border bg-gl-accent-subtle text-gl-on-accent-subtle" : "border-transparent",
                )}
              >
                <span className="flex items-center gap-2 type-body-sm font-semibold">
                  {c.author}
                  {c.isPoster && <span className="border-2 border-current px-1 text-[10px] leading-3 font-bold tracking-[0.08em]">POSTER</span>}
                  <span className="font-normal text-gl-text-secondary">· {ago(c.createdAt)}</span>
                </span>
                <span className="type-body whitespace-pre-wrap">{c.body ?? "Comment removed"}</span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <>
          {item.body && <p className="type-body whitespace-pre-wrap">{item.body}</p>}
          <p className="type-body-sm text-gl-text-secondary">This isn&apos;t visible to the page any more.</p>
        </>
      )}
      <p className="mt-auto flex items-start gap-2 border-t border-gl-border-subtle pt-4 type-body-sm text-gl-text-secondary">
        <Icon name="smartphone" size={18} className="mt-px shrink-0" />
        Reply as {page.name} from the app: Pages you manage › {page.name} › Inbox. Blocking someone is there too.
      </p>
    </>
  );
}

function verb(i: InboxItem, name: string) {
  switch (i.kind) {
    case "caption":
      return `mentioned ${name}`;
    case "comment":
      return `mentioned ${name} in a comment`;
    case "post_comment":
      return `commented on ${name}'s post`;
    case "reply":
      return `replied to ${name}`;
    case "meetup_comment":
      return `commented on ${name}'s meetup`;
  }
}

function where(i: InboxItem) {
  if (i.eventTitle) return i.eventTitle;
  return i.kind === "caption" ? "in a caption" : "on a post";
}

function initials(name: string) {
  return name.replace(/^@/, "").slice(0, 2).toUpperCase();
}

function clip(body: string) {
  const one = body.replace(/\s+/g, " ").trim();
  return one.length > 90 ? `${one.slice(0, 88)}…` : one;
}

function ago(iso: string) {
  const minutes = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h`;
  return `${Math.floor(hours / 24)} d`;
}
