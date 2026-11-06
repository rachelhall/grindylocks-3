"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { PageLogo } from "@/components/page-logo";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import type { CarriedBrand, ManagedPage } from "@/lib/page-tools";
import { cn } from "@/lib/utils";

import { type BrandOption, findBrands, saveBrands } from "./actions";
import { SaveBar } from "./save-bar";
import { Block, Hint } from "./section-shell";

const SHOWN_ON_PAGE = 6;
const MAX_BRANDS = 60;

/**
 * Brands we carry (mockup: Web · page brands): an ordered list, moved by
 * dragging or with the arrows, and search to add. Only brands with a page,
 * and retired brands left out. Saved in this order through
 * set_page_brands_carried.
 */
export function BrandsSection({ page }: { page: ManagedPage }) {
  const router = useRouter();
  const [list, setList] = useState<CarriedBrand[]>(page.brandsCarried);
  const [q, setQ] = useState("");
  const [options, setOptions] = useState<BrandOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [dragging, setDragging] = useState<number | null>(null);
  const [announce, setAnnounce] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [lastMove, setLastMove] = useState<string | null>(null);

  // Search waits for a pause in typing; it goes to our own server, which asks search_pages.
  useEffect(() => {
    const query = q.trim();
    if (!query) return;
    let live = true;
    const timer = setTimeout(async () => {
      const found = await findBrands(page.handle, query);
      if (live) {
        setOptions(found);
        setSearching(false);
      }
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [q, page.handle]);

  const ids = list.map((b) => b.id);
  const startIds = page.brandsCarried.map((b) => b.id);
  const changes: string[] = [];
  const added = list.filter((b) => !startIds.includes(b.id));
  const removed = page.brandsCarried.filter((b) => !ids.includes(b.id));
  if (added.length) changes.push(added.length === 1 ? `${added[0].name} added` : `${added.length} brands added`);
  if (removed.length) changes.push(removed.length === 1 ? `${removed[0].name} removed` : `${removed.length} brands removed`);
  const kept = ids.filter((id) => startIds.includes(id));
  if (kept.join() !== startIds.filter((id) => ids.includes(id)).join()) changes.push(lastMove ?? "order changed");

  function move(from: number, to: number) {
    if (to < 0 || to >= list.length || from === to) return;
    const name = list[from].name;
    setLastMove(`${name} moved ${to > from ? "down" : "up"}`);
    setList((l) => {
      const next = [...l];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
    setAnnounce(`${name}, ${to + 1} of ${list.length}`);
  }

  function add(b: BrandOption) {
    if (ids.includes(b.id) || list.length >= MAX_BRANDS) return;
    setList((l) => [...l, b]);
    setAnnounce(`${b.name} added, ${list.length + 1} of ${list.length + 1}`);
  }

  function discard() {
    setList(page.brandsCarried);
    setLastMove(null);
    setError(null);
  }

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await saveBrands(page.handle, ids);
      if (!result.ok) return setError(result.error);
      setLastMove(null);
      setSaved("Saved.");
      router.refresh();
    });
  }

  return (
    <>
      <form className="flex max-w-[720px] flex-col px-6 pb-6" onSubmit={(e) => e.preventDefault()}>
        <Block
          id="carried-h"
          title={`On your page · ${list.length}`}
          aside={list.length > 1 ? <span className="type-body-sm text-gl-text-secondary">Drag, or use the arrows</span> : undefined}
          first
        >
          {list.length === 0 ? (
            <p className="type-body">No brands yet. Search below to add the ones you carry.</p>
          ) : (
            <ol className="flex flex-col border-2 border-gl-border">
              {list.map((b, i) => (
                <li
                  key={b.id}
                  draggable
                  onDragStart={(e) => {
                    setDragging(i);
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    if (dragging !== null && dragging !== i) {
                      move(dragging, i);
                      setDragging(i);
                    }
                  }}
                  onDragEnd={() => setDragging(null)}
                  className={cn(
                    "flex min-h-row items-center gap-3 border-t border-gl-border-subtle px-3 py-1.5 first:border-t-0",
                    dragging === i ? "bg-gl-accent-subtle text-gl-on-accent-subtle" : "bg-gl-surface",
                    i === SHOWN_ON_PAGE && "border-t-2 border-t-gl-border",
                  )}
                >
                  <span className="cursor-grab text-gl-text-secondary" aria-hidden="true">
                    <Icon name="drag_indicator" />
                  </span>
                  <span className="w-5 text-right type-body-sm text-gl-text-secondary tabular-nums">{i + 1}</span>
                  <PageLogo name={b.name} path={b.logoPath} className="size-8 text-sm" />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate type-body-sm font-bold">{b.name}</span>
                    <span className="truncate type-caption text-gl-text-secondary">{brandLine(b)}</span>
                  </span>
                  <Button variant="outline" size="icon" aria-label={`Move ${b.name} up`} title="Move up" disabled={i === 0} onClick={() => move(i, i - 1)}>
                    <Icon name="arrow_upward" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label={`Move ${b.name} down`}
                    title="Move down"
                    disabled={i === list.length - 1}
                    onClick={() => move(i, i + 1)}
                  >
                    <Icon name="arrow_downward" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label={`Remove ${b.name}`}
                    title="Remove"
                    onClick={() => {
                      setList((l) => l.filter((x) => x.id !== b.id));
                      setAnnounce(`${b.name} removed`);
                    }}
                  >
                    <Icon name="close" />
                  </Button>
                </li>
              ))}
            </ol>
          )}
          <p aria-live="polite" className="sr-only">
            {announce}
          </p>
          {list.length > SHOWN_ON_PAGE && (
            <Hint>
              Your page shows the first {SHOWN_ON_PAGE}, then &ldquo;+{list.length - SHOWN_ON_PAGE} more&rdquo;. Retired brands
              don&apos;t show.
            </Hint>
          )}
        </Block>

        <Block id="add-h" title="Add a brand">
          <label htmlFor="brand-search" className="sr-only">
            Search brands
          </label>
          <div className="relative">
            <Icon name="search" className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-gl-text-secondary" />
            <Input
              id="brand-search"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setSearching(Boolean(e.target.value.trim()));
              }} placeholder="Search brands" className="pl-9 type-body-sm" autoComplete="off" />
          </div>
          {q.trim() && (
            <ul className="flex flex-col border-2 border-gl-border" aria-busy={searching}>
              {options.length === 0 && !searching && <li className="px-3 py-3 type-body-sm text-gl-text-secondary">No brand pages match &ldquo;{q.trim()}&rdquo;.</li>}
              {options.map((b) => {
                const on = ids.includes(b.id);
                return (
                  <li key={b.id} className="flex min-h-row items-center gap-3 border-t border-gl-border-subtle px-3 py-1.5 first:border-t-0">
                    <PageLogo name={b.name} path={b.logoPath} className="size-8 text-sm" />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate type-body-sm font-bold">{b.name}</span>
                      <span className="truncate type-caption text-gl-text-secondary">{brandLine(b)}</span>
                    </span>
                    <Button variant="outline" onClick={() => add(b)} disabled={on || list.length >= MAX_BRANDS}>
                      {on ? "Added" : "Add"}
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
          <Hint>
            Only brands with a page on Grindylocks are listed. Missing one? Suggest it from Search in the app, and it shows up
            here once it&apos;s added.
          </Hint>
        </Block>
      </form>
      <SaveBar changes={changes} pending={pending} error={error} saved={saved && !changes.length ? saved : null} onDiscard={discard} onSave={save} />
    </>
  );
}

function brandLine(b: { city: string | null; country: string | null }) {
  const where = b.city ?? b.country;
  return where ? `Brand · ${where}` : "Brand";
}
